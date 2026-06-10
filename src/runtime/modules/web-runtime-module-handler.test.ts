import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModuleResultEnvelope } from '../../../packages/contracts/runtime/modules.js';
import {
  WEB_READ_INPUT_SCHEMA_VERSION,
  WEB_READ_INTENT,
  WEB_RUNTIME_RESULT_SCHEMA_VERSION,
  WEB_SEARCH_INPUT_SCHEMA_VERSION,
  WEB_SEARCH_INTENT,
  createStaticFetchReadProvider,
  createWebRuntimeModuleHandler,
  type WebRuntimeToolResult,
} from './web-runtime-module-handler.js';

test('Web Runtime module exposes only web_search/web_read resource and intent surface', async () => {
  const handler = createWebRuntimeModuleHandler({ workspacePath: await tempWorkspace() });
  const description = await handler.describe();

  assert.equal(description.moduleId, 'web');
  assert.equal(description.functions.invoke, true);
  assert.deepEqual(description.intents?.map((intent) => intent.name), [WEB_SEARCH_INTENT, WEB_READ_INTENT]);
  assert.deepEqual(
    description.resources?.map((resource) => resource.refPrefix),
    ['web-search:', 'web-page:', 'web-source:', 'web-text:'],
  );
});

test('web.search normalizes candidates as refs-first non-evidence results', async () => {
  const workspace = await tempWorkspace();
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    searchProvider: async () => ({
      provider: 'fixture-search',
      results: [
        {
          title: 'Example article',
          url: 'https://example.com/news?id=1&utm_source=ignored',
          snippet: 'A short candidate snippet.',
          publishedAt: '2026-06-10T00:00:00.000Z',
          source: 'Example',
        },
        {
          title: 'Duplicate article',
          url: 'https://example.com/news?id=1',
          snippet: 'Duplicate URL should be removed.',
        },
      ],
      timings: { providerMs: 12 },
    }),
  });

  const result = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'example news',
      limit: 5,
    },
  }) as ModuleResultEnvelope | undefined;
  assert.ok(result?.ok);
  const value = result.value as WebRuntimeToolResult;

  assert.equal(value.schemaVersion, WEB_RUNTIME_RESULT_SCHEMA_VERSION);
  assert.equal(value.tool, 'web_search');
  assert.equal(value.status, 'completed');
  assert.equal(value.data.evidenceState, 'candidate_only');
  assert.match(value.data.evidenceBoundary, /not source evidence/i);
  assert.equal(value.data.results.length, 1);
  assert.equal(value.data.results[0].rank, 1);
  assert.equal(value.data.results[0].url, 'https://example.com/news?id=1');
  assert.ok(value.refs.some((ref) => ref.startsWith('web-search:')));
  assert.ok(value.refs.some((ref) => ref.startsWith('web-page:')));
  assert.equal(value.refs.some((ref) => ref.startsWith('web-source:') || ref.startsWith('web-text:')), false);
  assert.deepEqual(result.refs, value.refs);

  const searchArtifacts = await readdir(join(workspace, '.sciforge', 'web-search', 'searches'));
  assert.equal(searchArtifacts.length, 1);
});

test('web.search default provider accepts shared SearXNG env names used by live diagnostics', async () => {
  const workspace = await tempWorkspace();
  const fetchedUrls: string[] = [];
  const fetchedHeaders: Headers[] = [];
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    env: {
      SCIFORGE_SEARXNG_BASE_URL: 'https://search.local',
      SCIFORGE_SEARXNG_CATEGORIES: 'it',
      SCIFORGE_SEARXNG_ENGINES: 'mdn',
      SCIFORGE_SEARXNG_DISABLED_ENGINES: 'google,duckduckgo',
      SCIFORGE_SEARXNG_SEARCH_PARAMS: 'q=env-should-not-win&format=html&time_range=year',
      SCIFORGE_SEARXNG_HEADERS: 'X-SciForge-Live=yes&X-Bad=bad%0Avalue',
    } as NodeJS.ProcessEnv,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      fetchedUrls.push(String(url));
      fetchedHeaders.push(new Headers(init?.headers));
      return new Response(JSON.stringify({
        results: [{
          title: 'Shared env result',
          url: 'https://example.com/shared-env',
          content: 'SearXNG result from shared env.',
          engine: 'fixture',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'shared env query',
      limit: 1,
    },
  }) as ModuleResultEnvelope | undefined;

  assert.equal(result?.ok, true);
  assert.equal((result?.value as WebRuntimeToolResult).provider, 'searxng');
  assert.equal((result?.value as WebRuntimeToolResult).data.results[0]?.url, 'https://example.com/shared-env');
  assert.match(fetchedUrls[0] ?? '', /^https:\/\/search\.local\/search\?/);
  const fetchedUrl = new URL(fetchedUrls[0] ?? '');
  assert.equal(fetchedUrl.searchParams.get('q'), 'shared env query');
  assert.equal(fetchedUrl.searchParams.get('format'), 'json');
  assert.equal(fetchedUrl.searchParams.get('categories'), 'it');
  assert.equal(fetchedUrl.searchParams.get('engines'), 'mdn');
  assert.equal(fetchedUrl.searchParams.get('disabled_engines'), 'google,duckduckgo');
  assert.equal(fetchedUrl.searchParams.get('time_range'), 'year');
  assert.equal(fetchedHeaders[0]?.get('accept'), 'application/json');
  assert.equal(fetchedHeaders[0]?.get('x-sciforge-live'), 'yes');
  assert.equal(fetchedHeaders[0]?.get('x-bad'), null);
  const value = result?.value as WebRuntimeToolResult;
  assert.equal(typeof value.timings.parseMs, 'number');
});

test('web.search SearXNG docs preset avoids default general SERP engines unless explicitly overridden', async () => {
  const workspace = await tempWorkspace();
  const fetchedUrls: string[] = [];
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    env: {
      SCIFORGE_SEARXNG_BASE_URL: 'https://search.local',
      SCIFORGE_SEARXNG_PRESET: 'docs',
    } as NodeJS.ProcessEnv,
    fetchImpl: (async (url: string | URL) => {
      fetchedUrls.push(String(url));
      return new Response(JSON.stringify({
        results: [{
          title: 'Fetch API',
          url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
          content: 'The Fetch API provides an interface for fetching resources.',
          engine: 'mdn',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'Fetch API',
      limit: 1,
    },
  }) as ModuleResultEnvelope | undefined;

  assert.equal(result?.ok, true);
  const fetchedUrl = new URL(fetchedUrls[0] ?? '');
  assert.equal(fetchedUrl.searchParams.get('engines'), 'mdn,github');
  assert.equal(fetchedUrl.searchParams.get('q'), 'Fetch API');
  assert.equal(fetchedUrl.searchParams.get('format'), 'json');
});

test('web.search OpenSERP default provider is env-gated and uses the text adapter', async () => {
  const workspace = await tempWorkspace();
  const fetchedUrls: string[] = [];
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    env: {
      SCIFORGE_OPENSERP_ENABLED: '1',
      SCIFORGE_OPENSERP_BASE_URL: 'https://openserp.local/api',
    } as NodeJS.ProcessEnv,
    fetchImpl: (async (url: string | URL) => {
      fetchedUrls.push(String(url));
      return new Response(JSON.stringify({
        results: [{
          title: 'OpenSERP module result',
          link: 'https://example.com/openserp-module',
          snippet: 'OpenSERP result from the dedicated text adapter.',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  const result = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'openserp module query',
      limit: 1,
    },
  }) as ModuleResultEnvelope | undefined;

  assert.equal(result?.ok, true);
  const value = result?.value as WebRuntimeToolResult;
  assert.equal(value.provider, 'openserp');
  assert.equal(value.data.results[0]?.url, 'https://example.com/openserp-module');
  assert.equal(typeof value.timings.parseMs, 'number');
  const fetchedUrl = new URL(fetchedUrls[0] ?? '');
  assert.equal(fetchedUrl.pathname, '/api/search');
  assert.equal(fetchedUrl.searchParams.get('text'), 'openserp module query');
  assert.equal(fetchedUrl.searchParams.get('q'), null);
  assert.equal(fetchedUrl.searchParams.get('format'), 'json');
});

test('web.read default static provider uses Readability extraction before deterministic fallback', async () => {
  const provider = createStaticFetchReadProvider({
    fetchImpl: (async () => new Response(`<!doctype html>
      <html>
        <head><title>Ocean Instrument Update - Research Portal</title></head>
        <body>
          <div class="site-shell">
            <div class="global-links">
              <a href="/home">Homepage</a>
              <a href="/funding">Funding calls</a>
              <a href="/jobs">Careers</a>
            </div>
            <div class="feature-frame">
              <h1>Ocean Instrument Update</h1>
              <p>The calibration group published a field note about the new salinity instrument.</p>
              <p>The report compares repeated casts, sensor drift, and the control samples used during recovery.</p>
              <p>Those details are the durable page evidence that should survive static HTML extraction.</p>
            </div>
            <div class="link-cluster">
              <a href="/share">Share this page</a>
              <a href="/print">Print page</a>
            </div>
          </div>
        </body>
      </html>`, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof fetch,
  });

  const result = await provider({
    url: 'https://example.com/ocean-instrument-update',
    format: 'markdown',
    render: 'static',
    maxChars: 5000,
    timeoutMs: 10_000,
  });

  assert.equal(result.title, 'Ocean Instrument Update');
  assert.match(result.text ?? '', /new salinity instrument/);
  assert.match(result.text ?? '', /durable page evidence/);
  assert.doesNotMatch(result.text ?? '', /Homepage|Funding calls|Careers|Share this page/);
});

test('web.read resolves web-page refs and materializes source evidence refs', async () => {
  const workspace = await tempWorkspace();
  let readUrl = '';
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    searchProvider: async () => ({
      provider: 'fixture-search',
      results: [{ title: 'Example article', url: 'https://example.com/article', snippet: 'Candidate.' }],
      timings: { providerMs: 4 },
    }),
    readProvider: async (input) => {
      readUrl = input.url;
      return {
        provider: 'fixture-read',
        requestedUrl: input.url,
        finalUrl: input.url,
        title: 'Example article',
        contentType: 'text/html; charset=utf-8',
        markdown: '# Example article\n\nArticle body with enough detail.',
        text: 'Example article\n\nArticle body with enough detail.',
        timings: { fetchMs: 5, extractMs: 2 },
      };
    },
  });
  const searchResult = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'example article',
      limit: 1,
    },
  }) as ModuleResultEnvelope | undefined;
  const searchValue = searchResult?.value as WebRuntimeToolResult;
  const pageRef = searchValue.refs.find((ref) => ref.startsWith('web-page:'));
  assert.ok(pageRef);

  const readResult = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_READ_INTENT,
    input: {
      schemaVersion: WEB_READ_INPUT_SCHEMA_VERSION,
      resourceRef: pageRef,
      format: 'markdown',
      maxChars: 5000,
    },
  }) as ModuleResultEnvelope | undefined;
  assert.ok(readResult?.ok);
  const value = readResult.value as WebRuntimeToolResult;

  assert.equal(readUrl, 'https://example.com/article');
  assert.equal(value.tool, 'web_read');
  assert.equal(value.status, 'completed');
  assert.equal(value.data.evidenceState, 'source_read');
  assert.match(value.data.evidenceBoundary, /page text refs are source evidence/i);
  assert.equal(value.data.source.finalUrl, 'https://example.com/article');
  assert.match(value.data.content.preview, /Article body/);
  assert.ok(value.refs.some((ref) => ref.startsWith('web-source:')));
  const textRef = value.refs.find((ref) => ref.startsWith('web-text:'));
  assert.ok(textRef);

  const textArtifacts = await readdir(join(workspace, '.sciforge', 'web-search', 'texts'));
  assert.equal(textArtifacts.length, 1);
  const text = await readFile(join(workspace, '.sciforge', 'web-search', 'texts', textArtifacts[0]), 'utf8');
  assert.match(text, /Article body/);
});

test('web.read browser render fallback stays inside the web_read envelope', async () => {
  const workspace = await tempWorkspace();
  const calls: string[] = [];
  const handler = createWebRuntimeModuleHandler({
    workspacePath: workspace,
    browserFallbackAdapter: {
      provider: 'playwright',
      async render(input) {
        calls.push(input.url);
        return {
          status: 'read',
          finalUrl: `${input.url}?rendered=1`,
          title: 'Rendered page',
          contentType: 'text/html',
          textCharCount: 120,
          refs: {
            sourcePageRef: 'web-source:rendered-page',
            pageTextRef: 'web-text:rendered-page',
          },
          trace: {
            navigationUrl: input.url,
            finalUrl: `${input.url}?rendered=1`,
            waitReason: 'network-quiet',
            extractMethod: 'browser-rendered-text',
          },
        };
      },
    },
  });

  const result = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_READ_INTENT,
    input: {
      schemaVersion: WEB_READ_INPUT_SCHEMA_VERSION,
      url: 'https://example.com/js-heavy',
      render: 'browser',
    },
  }) as ModuleResultEnvelope | undefined;
  assert.equal(result?.ok, true);
  const value = result.value as WebRuntimeToolResult;

  assert.equal(value.tool, 'web_read');
  assert.equal(value.status, 'completed');
  assert.equal(value.provider, 'playwright');
  assert.equal(value.data.fallbackUsed, true);
  assert.equal(value.data.evidenceState, 'source_read');
  assert.deepEqual(value.refs, ['web-source:rendered-page', 'web-text:rendered-page']);
  assert.deepEqual(calls, ['https://example.com/js-heavy']);
});

test('web.search and web.read fail closed on invalid input', async () => {
  const handler = createWebRuntimeModuleHandler({ workspacePath: await tempWorkspace() });

  const invalidSearch = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_SEARCH_INTENT,
    input: {
      schemaVersion: WEB_SEARCH_INPUT_SCHEMA_VERSION,
      query: 'x',
      limit: 0,
    },
  }) as ModuleResultEnvelope | undefined;
  assert.equal(invalidSearch?.ok, false);
  assert.equal(invalidSearch?.error, 'invalid_input');

  const unsafeRead = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_READ_INTENT,
    input: {
      schemaVersion: WEB_READ_INPUT_SCHEMA_VERSION,
      url: 'http://127.0.0.1/admin',
    },
  }) as ModuleResultEnvelope | undefined;
  assert.equal(unsafeRead?.ok, false);
  assert.equal(unsafeRead?.error, 'unsafe_url');

  const unknownRef = await handler.invoke?.({
    moduleId: 'web',
    intent: WEB_READ_INTENT,
    input: {
      schemaVersion: WEB_READ_INPUT_SCHEMA_VERSION,
      resourceRef: 'web-page:missing',
    },
  }) as ModuleResultEnvelope | undefined;
  assert.equal(unknownRef?.ok, false);
  assert.equal(unknownRef?.error, 'invalid_input');
});

async function tempWorkspace() {
  return mkdtemp(join(tmpdir(), 'sciforge-web-runtime-'));
}
