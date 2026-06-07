import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  type BrowserDownloadOutput,
  type BrowserExtractOutput,
  type BrowserNavigateOutput,
  type BrowserObserveOutput,
  type BrowserPrimitiveEnvelope,
  type BrowserPrimitivePorts,
  type BrowserReadOutput,
  type BrowserSearchOutput,
} from '../../../packages/actions/browser-runtime/index.js';
import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  browserHostSessionDir,
  type BrowserHostSessionState,
} from '../browser-host-session.js';
import { createBrowserRuntimeModuleHandler } from './bounded-operation-module-handlers.js';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from './dispatcher.js';

test('browser primitives complete a local search-to-download user acceptance flow', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-runtime-ua-'));
  const server = await startBrowserAcceptanceFixtureServer();
  try {
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      browser: createBrowserRuntimeModuleHandler({
        workspacePath,
        primitivePorts: createLocalPrimitivePorts({
          baseUrl: server.baseUrl,
          workspacePath,
        }),
      }),
    }));

    const search = await invokeBrowser<BrowserSearchOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
      query: 'Browser primitives atlas deterministic paper',
      engine: 'duckduckgo',
      limit: 1,
      budget: { maxTimeMs: 5000 },
    });
    assert.equal(search.status, 'completed');
    assert.equal(search.output?.results[0]?.title, 'Browser Primitives Atlas');
    assert.match(search.output?.searchResultRef ?? '', /^browser:search-result:local-/);

    const paperUrl = search.output?.results[0]?.url;
    assert.ok(paperUrl);
    const navigate = await invokeBrowser<BrowserNavigateOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.navigate, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.navigate,
      url: paperUrl,
      capture: 'none',
    });
    assert.equal(navigate.status, 'completed');
    assert.equal(navigate.output?.finalUrl, `${server.baseUrl}/paper/browser-primitives-atlas`);
    assert.equal(navigate.output?.title, 'Browser Primitives Atlas');

    const sessionId = navigate.output?.sessionId;
    assert.ok(sessionId);
    const observe = await invokeBrowser<BrowserObserveOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.observe, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId,
      capture: 'none',
    });
    assert.equal(observe.status, 'completed');
    assert.equal(observe.output?.stateRef, `browser-host-session:${sessionId}/session.json`);
    assert.equal(observe.output?.title, 'Browser Primitives Atlas');

    const read = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      sessionId,
      includeText: true,
      maxTextChars: 20_000,
    });
    assert.equal(read.status, 'completed');
    assert.match(read.output?.textPreview ?? '', /SCI-2026-BR/);
    assert.match(read.output?.textPreview ?? '', /normalized observation delta is 42/);
    assert.ok(read.output?.pageTextRef);

    const extract = await invokeBrowser<BrowserExtractOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.extract, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.extract,
      ref: read.output.pageTextRef,
      extract: ['links', 'metadata'],
      maxItems: 10,
    });
    assert.equal(extract.status, 'completed');
    const csvLink = extract.output?.links?.find((link) => link.text === 'Download CSV dataset');
    assert.equal(csvLink?.url, `${server.baseUrl}/downloads/browser-primitives-atlas.csv`);
    assert.equal(extract.output?.metadata?.citation, 'SciForge Browser Runtime Acceptance Fixture');

    const download = await invokeBrowser<BrowserDownloadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: csvLink?.url,
      sessionId,
      saveScope: 'session-artifacts',
      maxBytes: 4096,
      filenameHint: 'browser-primitives-atlas.csv',
    });
    assert.equal(download.status, 'completed');
    assert.equal(download.output?.mimeType, 'text/csv');
    assert.equal(download.output?.byteLength, Buffer.byteLength(FIXTURE_CSV, 'utf8'));
    assert.match(download.output?.artifactRef ?? '', new RegExp(`^browser-host-session:${sessionId}/downloads/[a-f0-9]{12}-browser-primitives-atlas\\.csv$`));

    const artifactPath = join(browserHostSessionDir(workspacePath, sessionId), 'downloads', download.output.artifactRef.split('/').at(-1) ?? '');
    assert.equal(await readFile(artifactPath, 'utf8'), FIXTURE_CSV);

    const finalAnswer = [
      `我找到了《${read.output.title}》：页面记录的论文编号是 SCI-2026-BR，normalized observation delta 为 42，cohort size 为 7。`,
      `页面还提供了“${csvLink?.text}”链接，CSV 已下载为 ${download.output.artifactRef}。`,
    ].join('\n');
    assert.match(finalAnswer, /我找到了《Browser Primitives Atlas》/);
    assert.match(finalAnswer, /论文编号是 SCI-2026-BR/);
    assert.match(finalAnswer, /normalized observation delta 为 42/);
    assert.match(finalAnswer, /cohort size 为 7/);
    assert.match(finalAnswer, new RegExp(escapeRegExp(download.output.artifactRef)));

    assert.deepEqual(dispatcher.trace().map((step) => step.intent), [
      'browser.search',
      'browser.navigate',
      'browser.observe',
      'browser.read',
      'browser.extract',
      'browser.download',
    ]);
    assert.doesNotMatch(JSON.stringify(dispatcher.trace()), /browser\.(?:search_read|open_read)|executeBoundedOperation/);
    assert.ok(server.requests.some((path) => path.startsWith('/search.json?')));
    assert.ok(server.requests.filter((path) => path === '/paper/browser-primitives-atlas').length >= 2);
    assert.ok(server.requests.includes('/downloads/browser-primitives-atlas.csv'));
  } finally {
    await closeServer(server.httpServer);
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function createLocalPrimitivePorts(input: {
  baseUrl: string;
  workspacePath: string;
}): BrowserPrimitivePorts {
  const sessions = new Map<string, BrowserHostSessionState>();
  return {
    search: async (request) => {
      const response = await fetch(`${input.baseUrl}/search.json?q=${encodeURIComponent(request.query)}`);
      if (!response.ok) throw new Error(`search fixture failed: ${response.status}`);
      const payload = await response.json() as {
        query: string;
        results: Array<{ title: string; url: string; snippet: string }>;
      };
      const searchResultRef = `browser:search-result:local-${sha1(request.query).slice(0, 12)}`;
      return {
        status: 'completed',
        refs: [searchResultRef],
        output: {
          query: request.query,
          queryUsed: payload.query,
          engine: request.engine,
          searchUrl: `${input.baseUrl}/search.json`,
          searchedAt: FIXTURE_TIME,
          results: payload.results.slice(0, request.limit ?? payload.results.length).map((result, index) => ({
            rank: index + 1,
            ...result,
          })),
          searchResultRef,
        },
      };
    },
    navigate: async (request) => {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`navigate fixture failed: ${response.status}`);
      const html = await response.text();
      const sessionId = request.sessionId ?? 'ua-browser-session';
      const title = titleFromHtml(html) ?? 'Untitled';
      const session = sessionState({
        workspacePath: input.workspacePath,
        sessionId,
        url: response.url,
        title,
        frameRef: `browser-host-session:${sessionId}/frame.html`,
      });
      sessions.set(sessionId, session);
      const dir = browserHostSessionDir(input.workspacePath, sessionId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
      await writeFile(join(dir, 'frame.html'), html, 'utf8');
      return {
        status: 'completed',
        refs: [`browser-host-session:${sessionId}`, `browser-host-session:${sessionId}/session.json`, session.frameRef ?? ''],
        output: {
          sessionId,
          sessionRef: `browser-host-session:${sessionId}`,
          requestedUrl: request.url,
          finalUrl: response.url,
          title,
          openedAt: FIXTURE_TIME,
          navigation: { redirected: response.url !== request.url },
          frameRef: session.frameRef,
        },
      };
    },
    observe: async (request) => {
      const session = sessions.get(request.sessionId);
      if (!session) {
        return {
          status: 'blocked',
          blockedReason: 'browser_session_not_found',
          refs: [],
        };
      }
      return {
        status: 'completed',
        refs: [`browser-host-session:${session.id}`, `browser-host-session:${session.id}/session.json`, session.frameRef ?? ''],
        output: {
          sessionId: session.id,
          url: session.url,
          title: session.title,
          status: session.status,
          stateRef: `browser-host-session:${session.id}/session.json`,
          frameRef: session.frameRef,
          diagnostics: session.diagnostics,
        },
      };
    },
    read: async (request) => {
      const session = request.sessionId ? sessions.get(request.sessionId) : undefined;
      const url = request.url ?? session?.url;
      if (!url) {
        return {
          status: 'blocked',
          blockedReason: 'missing_read_url',
          refs: [],
        };
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`read fixture failed: ${response.status}`);
      const html = await response.text();
      const sessionId = request.sessionId ?? 'ua-browser-ephemeral-read';
      const title = titleFromHtml(html) ?? session?.title ?? 'Untitled';
      const textPreview = textFromHtml(html).slice(0, request.maxTextChars ?? 1600);
      const dir = join(browserHostSessionDir(input.workspacePath, sessionId), 'source-pages');
      await mkdir(dir, { recursive: true });
      const textRef = `browser-host-session:${sessionId}/source-pages/source-1-paper.txt`;
      const sourcePageRef = `browser-host-session:${sessionId}/source-pages/source-1-paper.source.json`;
      await writeFile(join(dir, 'source-1-paper.txt'), html, 'utf8');
      await writeFile(join(dir, 'source-1-paper.source.json'), JSON.stringify({
        schemaVersion: 'sciforge.browser-host-session.source-page.v1',
        resultIndex: 0,
        title,
        url,
        finalUrl: response.url,
        openedAt: FIXTURE_TIME,
        status: 'read',
        textRef,
        textSha1: sha1(html),
      }, null, 2), 'utf8');
      return {
        status: 'completed',
        refs: [sourcePageRef, textRef, `browser-host-session:${sessionId}/session.json`],
        output: {
          sessionId,
          url,
          finalUrl: response.url,
          title,
          contentType: response.headers.get('content-type') ?? undefined,
          sourcePageRef,
          pageTextRef: textRef,
          textPreview,
          textCharCount: textPreview.length,
          textSha1: sha1(html),
        },
      };
    },
  };
}

function sessionState(input: {
  workspacePath: string;
  sessionId: string;
  url: string;
  title: string;
  frameRef: string;
}): BrowserHostSessionState {
  return {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: input.sessionId,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: input.workspacePath,
    requestedUrl: input.url,
    url: input.url,
    title: input.title,
    startedAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    viewport: { width: 1024, height: 768 },
    canGoBack: false,
    canGoForward: false,
    frameRef: input.frameRef,
    diagnostics: [],
  };
}

async function invokeBrowser<T>(
  dispatcher: ReturnType<typeof createRuntimeModuleDispatcher>,
  intent: string,
  input: Record<string, unknown>,
): Promise<BrowserPrimitiveEnvelope<T>> {
  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent,
    input,
  });
  assert.equal(result.ok, true, result.error);
  const value = result.value as BrowserPrimitiveEnvelope<T>;
  assert.equal(value.moduleId, 'browser');
  return value;
}

async function startBrowserAcceptanceFixtureServer(): Promise<{
  baseUrl: string;
  httpServer: Server;
  requests: string[];
}> {
  const requests: string[] = [];
  let baseUrl = '';
  const httpServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', baseUrl || 'http://127.0.0.1');
    requests.push(url.pathname + url.search);
    if (url.pathname === '/search.json') {
      writeJson(response, {
        query: url.searchParams.get('q') ?? '',
        results: [{
          title: 'Browser Primitives Atlas',
          url: `${baseUrl}/paper/browser-primitives-atlas`,
          snippet: 'SCI-2026-BR reports normalized observation delta 42 and cohort size 7.',
        }],
      });
      return;
    }
    if (url.pathname === '/paper/browser-primitives-atlas') {
      writeText(response, paperHtml(baseUrl), 'text/html');
      return;
    }
    if (url.pathname === '/downloads/browser-primitives-atlas.csv') {
      writeText(response, FIXTURE_CSV, 'text/csv');
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl, httpServer, requests };
}

function paperHtml(baseUrl: string) {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="citation" content="SciForge Browser Runtime Acceptance Fixture">',
    '<title>Browser Primitives Atlas</title>',
    '</head>',
    '<body>',
    '<article>',
    '<h1>Browser Primitives Atlas</h1>',
    '<p>Paper identifier SCI-2026-BR describes a deterministic browser primitive acceptance fixture.</p>',
    '<p>The normalized observation delta is 42, and the cohort size is 7.</p>',
    `<a rel="supplement" href="${baseUrl}/downloads/browser-primitives-atlas.csv">Download CSV dataset</a>`,
    '<time datetime="2026-06-07">June 7, 2026</time>',
    '</article>',
    '</body>',
    '</html>',
  ].join('\n');
}

function writeJson(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function writeText(response: ServerResponse, text: string, contentType: string) {
  response.writeHead(200, { 'Content-Type': contentType });
  response.end(text);
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function titleFromHtml(html: string) {
  return /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.replace(/\s+/gu, ' ').trim();
}

function textFromHtml(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FIXTURE_TIME = '2026-06-07T00:00:00.000Z';
const FIXTURE_CSV = [
  'sample,normalized_observation_delta,cohort_size',
  'local-a,42,7',
  'local-b,42,7',
  '',
].join('\n');
