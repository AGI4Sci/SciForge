import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
  type BrowserHostSessionManager,
} from './browser-host-session.js';
import {
  browserHostSearchInputFromRequest,
  tryRunBrowserHostSearchRuntime,
} from './browser-host-search-runtime.js';
import type { GatewayRequest } from './runtime-types.js';

test('browser_host_search_runtime turns browser_search intent into refs-first BrowserHostSession payload', async () => {
  const calls: Array<{ workspacePath: string; input: BrowserHostSearchInput }> = [];
  const output: BrowserHostSearchOutput = {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: 'host owned browser',
    engine: 'bing',
    searchUrl: 'https://www.bing.com/search?q=host+owned+browser',
    finalUrl: 'https://www.bing.com/search?q=host+owned+browser',
    results: [
      { title: 'Host browser sessions', url: 'https://example.org/browser-host', snippet: 'Host owns live navigation.' },
      { title: 'Browser evidence refs', url: 'https://example.org/browser-refs', snippet: 'Screenshots, DOM, AX, console, and network refs.' },
    ],
    session: {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: 'search-session',
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'ready',
      workspacePath: '/tmp/sciforge-work',
      requestedUrl: 'https://www.bing.com/search?q=host+owned+browser',
      url: 'https://www.bing.com/search?q=host+owned+browser',
      title: 'Search results',
      startedAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:01.000Z',
      viewport: { width: 1365, height: 900 },
      canGoBack: false,
      canGoForward: false,
      frameRef: 'browser-host-session:search-session/frame.png',
      screenshotRef: 'browser-host-session:search-session/screenshot.png',
      domSnapshotRef: 'browser-host-session:search-session/dom.html',
      axSnapshotRef: 'browser-host-session:search-session/ax.json',
      consoleLogRef: 'browser-host-session:search-session/console.jsonl',
      networkLogRef: 'browser-host-session:search-session/network.jsonl',
      searchResultRef: 'browser-host-session:search-session/search-results.json',
      diagnostics: [],
    },
    searchResultRef: 'browser-host-session:search-session/search-results.json',
    screenshotRef: 'browser-host-session:search-session/screenshot.png',
    domSnapshotRef: 'browser-host-session:search-session/dom.html',
    axSnapshotRef: 'browser-host-session:search-session/ax.json',
    consoleLogRef: 'browser-host-session:search-session/console.jsonl',
    networkLogRef: 'browser-host-session:search-session/network.jsonl',
  };
  const manager = {
    async search(workspacePath: string, input: BrowserHostSearchInput) {
      calls.push({ workspacePath, input });
      return output;
    },
  } as unknown as BrowserHostSessionManager;
  const events: string[] = [];

  const payload = await tryRunBrowserHostSearchRuntime(browserSearchRequest(), {
    onEvent: (event) => events.push(`${event.type}:${event.status}`),
  }, manager);

  assert.ok(payload);
  assert.deepEqual(calls, [{
    workspacePath: '/tmp/sciforge-work',
    input: {
      query: 'host owned browser',
      limit: 2,
      engine: 'bing',
      timeoutMs: 45_000,
    },
  }]);
  assert.match(payload.message, /BrowserHostSession search: host owned browser/);
  assert.match(payload.message, /https:\/\/example\.org\/browser-host/);
  assert.equal(payload.uiManifest?.[0]?.componentId, 'browser-workbench');
  assert.equal(payload.executionUnits?.[0]?.environment, BROWSER_HOST_SESSION_PROVIDER_ID);
  assert.deepEqual(events, [
    'browser-host-search-runtime:running',
    'browser-host-search-runtime:satisfied',
  ]);

  const searchArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-search-results-'));
  const projectionArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-host-projection-'));
  const searchData = searchArtifact?.data as Record<string, any> | undefined;
  const projectionData = projectionArtifact?.data as Record<string, any> | undefined;
  assert.equal(searchArtifact?.schemaVersion, BROWSER_HOST_SEARCH_SCHEMA);
  assert.equal(searchData?.searchResultRef, 'browser-host-session:search-session/search-results.json');
  assert.equal(searchData?.browserSessionRef, 'browser-host-session:search-session');
  assert.equal(searchData?.projectionRef, `artifact:${projectionArtifact?.id}`);
  assert.equal(projectionData?.hostSession?.id, 'search-session');
  assert.equal(projectionData?.snapshot?.searchResultRef, 'browser-host-session:search-session/search-results.json');
  assert.match(JSON.stringify(projectionData?.traceRefs), /browser-frame/);
  const projectionReference = payload.objectReferences?.find((reference) => reference.ref === `artifact:${projectionArtifact?.id}`);
  assert.equal(projectionReference?.artifactType, 'browser-runtime-projection');
  assert.equal(projectionReference?.preferredView, 'browser-workbench');
  const projectionReferenceProvenance = projectionReference?.provenance as Record<string, unknown> | undefined;
  assert.equal(projectionReferenceProvenance?.browserSessionRef, 'browser-host-session:search-session');
  assert.equal(projectionReferenceProvenance?.projectionRef, `artifact:${projectionArtifact?.id}`);
});

test('browser_host_search_runtime only claims explicit browser search intents', () => {
  assert.equal(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'Summarize the current file without web search.',
    selectedToolIds: [],
  }), undefined);

  assert.deepEqual(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: '/browser search "refs first browser"',
    selectedToolIds: [],
  }), {
    query: 'refs first browser',
    limit: 5,
    engine: 'bing',
    timeoutMs: 45_000,
  });
});

test('browser_host_search_runtime defaults current external and citation requests to BrowserHostSession search', () => {
  assert.deepEqual(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'Find the latest OpenAI API model guidance and cite source URLs.',
    selectedToolIds: [],
  }), {
    query: 'Find the latest OpenAI API model guidance and cite source URLs.',
    limit: 5,
    engine: 'bing',
    timeoutMs: 45_000,
  });

  assert.deepEqual(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'Open https://example.com/ and summarize the current page with sources.',
    selectedToolIds: [],
  }), {
    query: 'https://example.com/',
    limit: 5,
    engine: 'bing',
    timeoutMs: 45_000,
  });
});

test('browser_host_search_runtime respects local-only and no-network constraints', () => {
  assert.equal(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'Use only local context. Find the latest browser architecture note and cite sources.',
    selectedToolIds: [],
  }), undefined);

  assert.equal(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'Do not browse the web; summarize https://example.com/ only from provided refs.',
    selectedToolIds: ['browser_search'],
  }), undefined);
});

test('browser_host_search_runtime reuses browser-specific current session refs from request context', () => {
  assert.deepEqual(browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: '/browser search "visible session reuse"',
    selectedToolIds: [],
    uiState: {
      sessionId: 'sciforge-chat-session-should-not-be-used',
      currentReferences: [{
        ref: 'artifact:browser-host-projection-visible',
        artifactType: 'browser-runtime-projection',
        provenance: {
          browserSessionRef: 'browser-host-session:visible-search-session',
          projectionRef: 'artifact:browser-host-projection-visible',
        },
      }],
    },
  }), {
    query: 'visible session reuse',
    limit: 5,
    engine: 'bing',
    timeoutMs: 45_000,
    sessionId: 'visible-search-session',
  });
});

function browserSearchRequest(): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'browser_search("host owned browser") limit: 2',
    workspacePath: '/tmp/sciforge-work',
    selectedToolIds: ['browser_search'],
    artifacts: [],
  };
}

interface BrowserHostRuntimeArtifact extends Record<string, unknown> {
  id: string;
  schemaVersion?: unknown;
  data?: unknown;
}

function artifactIdStartsWith(value: unknown, prefix: string): value is BrowserHostRuntimeArtifact {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && (value as { id: string }).id.startsWith(prefix);
}
