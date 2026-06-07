import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolClient } from '../../../contracts/tool-worker/src/index';
import { startWebWorkerServer } from './server';
import { setBrowserAutomationForTests, setPdfTextExtractionAvailableForTests, setPdfTextExtractionForTests, webFetch, webSearch } from './web-tools';
import { createWebWorker } from './worker';

test('web worker manifest exposes unified web search/fetch and browser-rendered fetch tools only', () => {
  const worker = createWebWorker();
  assert.deepEqual(
    worker.manifest.tools.map((tool) => tool.id),
    ['web_search', 'web_fetch', 'browser_fetch', 'pdf_extract'],
  );
  assert.equal((worker.manifest.capabilities ?? []).includes('browser_search'), false);
  assert.equal((worker.manifest.providers ?? []).some((provider) => provider.capabilityId === 'browser_search'), false);
});

test('web worker validates unknown tools through invoke', async () => {
  const response = await createWebWorker().invoke({ toolId: 'missing', input: {} });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'tool_not_found');
  }
});

test('legacy browser_search is not exposed as a worker tool', async () => {
  const response = await createWebWorker().invoke({ toolId: 'browser_search', input: { query: 'dynamic page' } });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'tool_not_found');
  }
});

test('browser_fetch routes through the browser automation provider', async () => {
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
  setPdfTextExtractionAvailableForTests(true);
  const server = await startWebWorkerServer();
  try {
    const client = createToolClient(server.url);
    assert.equal((await client.manifest()).workerId, 'sciforge.web-worker');
    assert.equal((await client.health()).status, 'ok');
  } finally {
    await server.close();
    setPdfTextExtractionAvailableForTests(undefined);
  }
});

test('web worker health reports degraded pdf_extract when pdftotext is unavailable', async () => {
  setPdfTextExtractionAvailableForTests(false);
  try {
    const health = await createWebWorker().health();
    assert.equal(health.status, 'degraded');
    const details = health.details as Record<string, any>;
    assert.equal(details.toolStatus.pdf_extract, 'unavailable');
    assert.equal(details.pdf_extract.status, 'unavailable');
  } finally {
    setPdfTextExtractionAvailableForTests(undefined);
  }
});

test('web_fetch extracts bounded text from PDF responses with page evidence', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href === 'https://example.test/paper.pdf') {
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setPdfTextExtractionForTests({
    async extract(input) {
      assert.equal(input.url, 'https://example.test/paper.pdf');
      assert.equal(input.maxPages, 3);
      return {
        status: 'extracted',
        extractor: 'test-pdf',
        pageRange: '1-3',
        sourceUrl: input.url,
        evidenceLocations: [`${input.url}#page=1`, `${input.url}#page=3`],
        text: 'Page 1 introduction\nPage 2 method\nPage 3 conclusion',
        truncated: false,
      };
    },
  });
  try {
    const result = await webFetch({ url: 'https://example.test/paper.pdf', maxPages: 3, maxChars: 5000 });
    assert.equal(result.mediaType, 'application/pdf');
    assert.match(String(result.text), /Page 2 method/);
    const extraction = result.pdfExtraction as Record<string, unknown>;
    assert.equal(extraction.status, 'extracted');
    assert.deepEqual(extraction.evidenceLocations, [
      'https://example.test/paper.pdf#page=1',
      'https://example.test/paper.pdf#page=3',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    setPdfTextExtractionForTests(undefined);
  }
});

test('web_search uses the arXiv API directly for explicit arXiv queries', async () => {
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
    assert.equal(result.fallbackFrom, undefined);
    assert.equal(calls.some((href) => href.includes('duckduckgo.com/html/')), false);
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

test('web_search normalizes arXiv literature task prompts to topic terms', async () => {
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
            <id>http://arxiv.org/abs/2605.17777v1</id>
            <updated>2026-05-18T10:00:00Z</updated>
            <published>2026-05-18T10:00:00Z</published>
            <title>Computer Use Agents for Scientific Workflows</title>
            <summary>We study agent computer use in research workflows.</summary>
            <author><name>Ada Lovelace</name></author>
            <link href="https://arxiv.org/abs/2605.17777v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.17777v1" rel="related" type="application/pdf"/>
          </entry>
        </feed>`, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;

  try {
    await webSearch({
      query: 'Research today arxiv papers about agent computer use. Read full text or PDF as much as possible. Write a Chinese summary report artifact.',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.match(arxivQuery, /all:agent/);
    assert.match(arxivQuery, /all:computer/);
    assert.match(arxivQuery, /all:use/);
    assert.match(arxivQuery, /submittedDate:\[202605180000 TO 202605182359\]/);
    assert.doesNotMatch(arxivQuery, /Research|Read|Write|summary|artifact/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search keeps mixed-language arXiv prompts from polluting topic terms with report requirements', async () => {
  const originalFetch = globalThis.fetch;
  let arxivQuery = '';
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('export.arxiv.org/api/query')) {
      arxivQuery = new URL(href).searchParams.get('search_query') ?? '';
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.15777v1</id>
            <updated>2026-05-15T10:00:00Z</updated>
            <published>2026-05-15T10:00:00Z</published>
            <title>SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS?</title>
            <summary>Computer-use agents operate SaaS workflows.</summary>
            <link href="https://arxiv.org/abs/2605.15777v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.15777v1" rel="related" type="application/pdf"/>
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
      query: '帮我调研一下今天arxiv上agent computer use的文章，并阅读全文，写一份中文总结报告。hard requirements: 最新论文列表；全文/PDF或不可得说明；证据位置；中文报告artifact；关键结论；局限性；debug audit raw默认折叠；fallback不能误导',
      limit: 2,
    });
    assert.equal(result.provider, 'arxiv-api');
    assert.match(arxivQuery, /all:agent/);
    assert.match(arxivQuery, /all:computer/);
    assert.match(arxivQuery, /all:use/);
    assert.doesNotMatch(arxivQuery, /中文|报告|证据|局限性|全文|debug|audit|raw|fallback|requirements/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search tries arXiv API before generic web results for dated arXiv prompts', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('<a class="result__a" href="https://example.com/today">today dictionary</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.19999v1</id>
            <updated>2026-05-18T10:00:00Z</updated>
            <published>2026-05-18T10:00:00Z</published>
            <title>Agents for Computer Use on Scientific Desktops</title>
            <summary>Computer-use agent benchmark.</summary>
            <author><name>Alan Turing</name></author>
            <link href="https://arxiv.org/abs/2605.19999v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.19999v1" rel="related" type="application/pdf"/>
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
      query: 'today arxiv papers about agent computer use',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-api');
    assert.equal(calls[0]?.includes('export.arxiv.org/api/query'), true);
    assert.equal(calls.some((href) => href.includes('duckduckgo.com/html/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search relaxes empty arXiv date windows to latest matching records with an audit note', async () => {
  const originalFetch = globalThis.fetch;
  const arxivQueries: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('duckduckgo.com/html/')) {
      return new Response('temporary search failure', { status: 503 });
    }
    if (href.includes('export.arxiv.org/api/query')) {
      const query = new URL(href).searchParams.get('search_query') ?? '';
      arxivQueries.push(query);
      if (query.includes('submittedDate:')) {
        return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2605.18888v1</id>
            <updated>2026-05-17T10:00:00Z</updated>
            <published>2026-05-17T10:00:00Z</published>
            <title>Agent Computer Use Beyond the Browser</title>
            <summary>Recent systems for agent computer use.</summary>
            <author><name>Grace Hopper</name></author>
            <link href="https://arxiv.org/abs/2605.18888v1" rel="alternate" type="text/html"/>
            <link title="pdf" href="https://arxiv.org/pdf/2605.18888v1" rel="related" type="application/pdf"/>
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
      query: 'today arxiv papers about agent computer use',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-api');
    assert.equal(arxivQueries.length, 2);
    assert.match(arxivQueries[0] ?? '', /submittedDate:\[202605180000 TO 202605182359\]/);
    assert.doesNotMatch(arxivQueries[1] ?? '', /submittedDate/);
    assert.ok(result.dateFallback);
    assert.match(String((result.dateFallback as Record<string, unknown>).reason), /relaxed to latest matching arXiv records/);
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.arxivId, '2605.18888v1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search falls back to browser arXiv pages when the arXiv API is rate limited', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const browserQueries: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('rate limited', { status: 429 });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setBrowserAutomationForTests({
    async search(input) {
      browserQueries.push(String(input.query));
      assert.match(String(input.query), /^site:arxiv\.org\/abs /);
      assert.match(String(input.query), /agent/);
      assert.match(String(input.query), /computer/);
      assert.doesNotMatch(String(input.query), /submitted|2026|05|18|utc/i);
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [
          {
            title: 'Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search',
            url: 'https://arxiv.org/abs/2605.16191v1',
            snippet: 'generic LLM search result',
          },
          {
            title: 'Computer Use Agents for Scientific Workflows',
            url: 'https://arxiv.org/abs/2605.17777v1',
            snippet: 'arXiv browser result',
          },
        ],
      };
    },
    async fetch(input) {
      if (input.url === 'https://arxiv.org/abs/2605.16191v1') {
        return {
          url: input.url,
          finalUrl: input.url,
          status: 200,
          ok: true,
          provider: 'test-browser',
          rendered: true,
          title: '[2605.16191v1] Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search',
          text: 'Title: Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search Authors: Ada Lovelace Abstract: We optimize photovoltaic structures. Submitted on 18 May 2026',
          links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.16191v1' }],
        };
      }
      assert.equal(input.url, 'https://arxiv.org/abs/2605.17777v1');
      return {
        url: input.url,
        finalUrl: input.url,
        status: 200,
        ok: true,
        provider: 'test-browser',
        rendered: true,
        title: '[2605.17777v1] Computer Use Agents for Scientific Workflows',
        text: 'Title: Computer Use Agents for Scientific Workflows Authors: Ada Lovelace, Grace Hopper Abstract: We study agent computer use in research workflows. Submitted on 18 May 2026',
        links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.17777v1' }],
      };
    },
  });

  try {
    const result = await webSearch({
      query: 'arxiv agent computer use submitted on 2026 05 18 utc',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-browser');
    assert.equal(result.fallbackFrom, 'arxiv-api');
    assert.deepEqual(result.dateRange, {
      from: '202605180000',
      to: '202605182359',
      fromDate: '2026-05-18',
      toDate: '2026-05-18',
    });
    assert.equal(result.dateFallback, undefined);
    assert.equal(calls.length, 1);
    assert.deepEqual(browserQueries, ['site:arxiv.org/abs agent computer use']);
    assert.ok(calls[0]?.includes('export.arxiv.org/api/query'));
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, 'Computer Use Agents for Scientific Workflows');
    assert.equal(rows[0]?.url, 'https://arxiv.org/abs/2605.17777v1');
    assert.equal(rows[0]?.arxivId, '2605.17777v1');
    assert.equal(rows[0]?.published, '2026-05-18');
    assert.equal(rows[0]?.pdfUrl, 'https://arxiv.org/pdf/2605.17777v1');
    assert.deepEqual(rows[0]?.authors, ['Ada Lovelace', 'Grace Hopper']);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('web_search rejects browser arXiv fallback candidates that only match broad tokens', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('rate limited', { status: 429 });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setBrowserAutomationForTests({
    async search(input) {
      assert.equal(input.query, 'site:arxiv.org/abs agent computer use');
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [
          {
            title: 'Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search',
            url: 'https://arxiv.org/abs/2605.16191v1',
            snippet: 'A coding agent can be used for computer-aided scientific design.',
          },
          {
            title: 'Agent Memory Systems for Scientific Workflows',
            url: 'https://arxiv.org/abs/2605.16233v1',
            snippet: 'Computer science methods for agent memory are discussed.',
          },
        ],
      };
    },
    async fetch(input) {
      if (input.url === 'https://arxiv.org/abs/2605.16191v1') {
        return {
          url: input.url,
          finalUrl: input.url,
          status: 200,
          ok: true,
          provider: 'test-browser',
          rendered: true,
          title: '[2605.16191v1] Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search',
          text: 'Title: Optimized Three-Dimensional Photovoltaic Structures with LLM guided Tree Search Authors: Ada Lovelace Abstract: A coding agent can be used for computer-aided scientific design. Submitted on 15 May 2026',
          links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.16191v1' }],
        };
      }
      if (input.url === 'https://arxiv.org/abs/2605.16233v1') {
        return {
          url: input.url,
          finalUrl: input.url,
          status: 200,
          ok: true,
          provider: 'test-browser',
          rendered: true,
          title: '[2605.16233v1] Agent Memory Systems for Scientific Workflows',
          text: 'Title: Agent Memory Systems for Scientific Workflows Authors: Grace Hopper Abstract: Computer science methods for agent memory. Submitted on 15 May 2026',
          links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.16233v1' }],
        };
      }
      throw new Error(`unexpected browser fetch ${input.url}`);
    },
  });

  try {
    await assert.rejects(
      () => webSearch({
        query: 'arxiv agent computer use submitted on 2026 05 18 utc',
        limit: 2,
        now: '2026-05-18T00:00:00Z',
      }),
      /arxiv providers could not satisfy explicit arXiv query/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('web_search tries a phrase-preserving arXiv browser query before direct site search', async () => {
  const originalFetch = globalThis.fetch;
  const browserQueries: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('rate limited', { status: 429 });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setBrowserAutomationForTests({
    async search(input) {
      browserQueries.push(String(input.query));
      if (input.query === 'site:arxiv.org/abs agent computer use') {
        return {
          query: input.query,
          rawQuery: input.rawQuery,
          provider: 'test-browser',
          rendered: true,
          results: [],
        };
      }
      assert.equal(input.query, 'site:arxiv.org/abs "computer use" agent');
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [
          {
            title: 'SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS?',
            url: 'https://arxiv.org/abs/2605.15777',
            snippet: 'A benchmark for computer-use agents.',
          },
        ],
      };
    },
    async fetch(input) {
      assert.equal(input.url, 'https://arxiv.org/abs/2605.15777');
      return {
        url: input.url,
        finalUrl: input.url,
        status: 200,
        ok: true,
        provider: 'test-browser',
        rendered: true,
        title: '[2605.15777] SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS?',
        text: 'Title: SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS? Authors: Kean Shi Abstract: Computer-use agents operate SaaS workflows. Submitted on 18 May 2026',
        links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.15777' }],
      };
    },
  });

  try {
    const result = await webSearch({
      query: 'arxiv agent computer use submitted on 2026 05 18 utc',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-browser');
    assert.deepEqual(browserQueries, [
      'site:arxiv.org/abs agent computer use',
      'site:arxiv.org/abs agent computer use',
      'site:arxiv.org/abs "computer use" agent',
    ]);
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.arxivId, '2605.15777');
    assert.match(String(rows[0]?.title), /SaaS-Bench/);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('web_search falls back to arXiv recent category lists when API and rendered search are unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    fetchedUrls.push(href);
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('rate limited', { status: 429 });
    }
    if (href.includes('arxiv.org/list/cs.AI/recent')) {
      return new Response(`
        <dt><a href ="/abs/2605.16024" title="Abstract" id="2605.16024">arXiv:2605.16024</a></dt>
        <dd><div class='meta'>
          <div class='list-title mathjax'><span class='descriptor'>Title:</span> ScreenSearch: Uncertainty-Aware OS Exploration</div>
          <div class='list-subjects'><span class='descriptor'>Subjects:</span> Artificial Intelligence (cs.AI)</div>
        </div></dd>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (href.includes('arxiv.org/list/')) {
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  setBrowserAutomationForTests({
    async search() {
      return {
        provider: 'test-browser',
        rendered: true,
        results: [],
      };
    },
    async fetch(input) {
      assert.equal(input.url, 'https://arxiv.org/abs/2605.16024');
      return {
        url: input.url,
        finalUrl: input.url,
        status: 200,
        ok: true,
        provider: 'test-browser',
        rendered: true,
        title: '[2605.16024] ScreenSearch: Uncertainty-Aware OS Exploration',
        text: 'Title: ScreenSearch: Uncertainty-Aware OS Exploration Authors: Ada Lovelace Abstract: We study operating system exploration for computer-use agents. Submitted on 15 May 2026',
        links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.16024' }],
      };
    },
  });

  try {
    const result = await webSearch({
      query: 'arxiv agent computer use submitted on 2026 05 18 utc',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-browser');
    assert.ok(fetchedUrls.some((url) => url.includes('arxiv.org/list/cs.AI/recent')));
    assert.ok(result.dateFallback);
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.arxivId, '2605.16024');
    assert.match(String(rows[0]?.title), /ScreenSearch/);
    assert.equal(rows[0]?.published, '2026-05-15');
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});

test('web_search falls back to direct arXiv rendered search when web search finds no arXiv pages', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL | RequestInfo) => {
    const href = String(url);
    if (href.includes('export.arxiv.org/api/query')) {
      return new Response('rate limited', { status: 429 });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  const fetchedUrls: string[] = [];
  setBrowserAutomationForTests({
    async search(input) {
      assert.match(String(input.query), /^site:arxiv\.org\/abs /);
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [],
      };
    },
    async fetch(input) {
      const url = String(input.url);
      fetchedUrls.push(url);
      if (url.includes('arxiv.org/search/')) {
        return {
          url,
          finalUrl: url,
          status: 200,
          ok: true,
          provider: 'test-browser',
          rendered: true,
          title: 'Search | arXiv e-print repository',
          text: 'Showing results for all: agent computer use arXiv:2605.15777 Submitted 18 May, 2026',
          links: [{ text: 'arXiv:2605.15777', url: 'https://arxiv.org/abs/2605.15777' }],
        };
      }
      if (url === 'https://arxiv.org/abs/2605.15777') {
        return {
          url,
          finalUrl: url,
          status: 200,
          ok: true,
          provider: 'test-browser',
          rendered: true,
          title: '[2605.15777] SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS to Solve Professional Workflows?',
          text: 'Title: SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS to Solve Professional Workflows? Authors: Kean Shi, Zihang Li Abstract: Computer-use agents are evaluated on SaaS workflows. Submitted on 18 May 2026',
          links: [{ text: 'PDF', url: 'https://arxiv.org/pdf/2605.15777' }],
        };
      }
      throw new Error(`unexpected browser fetch ${url}`);
    },
  });

  try {
    const result = await webSearch({
      query: 'today arxiv papers about agent computer use',
      limit: 2,
      now: '2026-05-18T00:00:00Z',
    });
    assert.equal(result.provider, 'arxiv-browser');
    assert.equal(fetchedUrls.some((url) => url.includes('arxiv.org/search/')), true);
    const rows = result.results as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.arxivId, '2605.15777');
    assert.equal(rows[0]?.published, '2026-05-18');
    assert.match(String(rows[0]?.title), /SaaS-Bench/);
    assert.equal(rows[0]?.pdfUrl, 'https://arxiv.org/pdf/2605.15777');
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
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
  setBrowserAutomationForTests({
    async search(input) {
      assert.match(String(input.query), /^site:arxiv\.org\/abs /);
      return {
        query: input.query,
        rawQuery: input.rawQuery,
        provider: 'test-browser',
        rendered: true,
        results: [],
      };
    },
    async fetch() {
      throw new Error('browser fetch should not run without arXiv abs candidates');
    },
  });

  try {
    await assert.rejects(
      () => webSearch({ query: 'arxiv multi-agent reinforcement learning credit assignment', limit: 2 }),
      /arxiv providers could not satisfy explicit arXiv query/,
    );
    assert.equal(calls.some((href) => href.includes('duckduckgo.com/html/')), false);
    assert.ok(calls.some((href) => href.includes('export.arxiv.org/api/query')));
    assert.equal(calls.some((href) => href.includes('api.crossref.org') || href.includes('europepmc')), false);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserAutomationForTests(undefined);
  }
});
