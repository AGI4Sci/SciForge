import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
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
    searchedAt: '2026-06-01T00:00:01.000Z',
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
  assert.match(payload.message, /candidate sources/i);
  assert.match(payload.message, /have not opened and read/i);
  assert.match(payload.message, /Host browser sessions/);
  assert.match(payload.message, /https:\/\/example\.org\/browser-host/);
  assert.doesNotMatch(payload.message, /^BrowserHostSession search:/);
  assert.equal(payload.displayIntent?.taskOutcome, 'needs-human');
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.uiManifest?.[0]?.componentId, 'browser-workbench');
  assert.equal(payload.executionUnits?.[0]?.environment, BROWSER_HOST_SESSION_PROVIDER_ID);
  assert.equal(payload.executionUnits?.[0]?.status, 'needs-human');
  assert.deepEqual(events, [
    'browser-host-search-runtime:running',
    'browser-host-search-runtime:needs-human',
  ]);

  const searchArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-search-results-'));
  const projectionArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-host-projection-'));
  const searchMetadata = searchArtifact?.metadata as Record<string, any> | undefined;
  const searchData = searchArtifact?.data as Record<string, any> | undefined;
  const projectionData = projectionArtifact?.data as Record<string, any> | undefined;
  assert.equal(searchArtifact?.schemaVersion, BROWSER_HOST_SEARCH_SCHEMA);
  assert.equal(searchMetadata?.searchedAt, '2026-06-01T00:00:01.000Z');
  assert.equal(searchData?.searchedAt, '2026-06-01T00:00:01.000Z');
  assert.equal(searchData?.answerEvidenceState, 'candidate-only');
  assert.match(String(searchData?.browserHostSearchSummary), /BrowserHostSession search: host owned browser/);
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

test('browser_host_search_runtime marks opened source page answers satisfied with source refs', async () => {
  const output: BrowserHostSearchOutput = {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: 'Hugging Face Daily Papers today hot papers',
    engine: 'bing',
    searchedAt: '2026-06-06T00:00:01.000Z',
    searchUrl: 'https://www.bing.com/search?q=huggingface+papers',
    finalUrl: 'https://huggingface.co/papers',
    results: [
      { title: 'Hugging Face Daily Papers', url: 'https://huggingface.co/papers', snippet: 'Wrong snippet should not be used.' },
    ],
    sourcePages: [{
      resultIndex: 0,
      title: 'Hugging Face Daily Papers',
      url: 'https://huggingface.co/papers',
      finalUrl: 'https://huggingface.co/papers',
      openedAt: '2026-06-06T00:00:02.000Z',
      status: 'read',
      textRef: 'browser-host-session:search-session/source-pages/source-1.txt',
      textPreview: 'Daily Papers currently highlights Reasoning Models for Agents and Efficient Vision-Language Adaptation.',
      textCharCount: 98,
      textSha1: 'source-page-sha',
    }],
    session: {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: 'search-session',
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'ready',
      workspacePath: '/tmp/sciforge-work',
      requestedUrl: 'https://www.bing.com/search?q=huggingface+papers',
      url: 'https://huggingface.co/papers',
      title: 'Hugging Face Daily Papers',
      startedAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:02.000Z',
      viewport: { width: 1365, height: 900 },
      canGoBack: true,
      canGoForward: false,
      frameRef: 'browser-host-session:search-session/frame.png',
      screenshotRef: 'browser-host-session:search-session/screenshot.png',
      domSnapshotRef: 'browser-host-session:search-session/dom.html',
      axSnapshotRef: 'browser-host-session:search-session/ax.json',
      searchResultRef: 'browser-host-session:search-session/search-results.json',
      diagnostics: [],
    },
    searchResultRef: 'browser-host-session:search-session/search-results.json',
    screenshotRef: 'browser-host-session:search-session/screenshot.png',
    domSnapshotRef: 'browser-host-session:search-session/dom.html',
    axSnapshotRef: 'browser-host-session:search-session/ax.json',
  };
  const manager = {
    async search() {
      return output;
    },
  } as unknown as BrowserHostSessionManager;
  const events: string[] = [];

  const payload = await tryRunBrowserHostSearchRuntime(browserSearchRequest(), {
    onEvent: (event) => events.push(`${event.type}:${event.status}`),
  }, manager);

  assert.ok(payload);
  assert.match(payload.message, /opened|read/i);
  assert.match(payload.message, /Reasoning Models for Agents/);
  assert.doesNotMatch(payload.message, /Wrong snippet|have not opened and read/i);
  assert.equal(payload.displayIntent?.taskOutcome, 'satisfied');
  assert.equal(payload.displayIntent?.status, 'done');
  assert.equal(payload.executionUnits?.[0]?.status, 'done');
  assert.deepEqual(events, [
    'browser-host-search-runtime:running',
    'browser-host-search-runtime:satisfied',
  ]);
  assert.match(JSON.stringify(payload.claims?.[0]?.supportingRefs), /source-pages\/source-1\.txt/);
  const searchArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-search-results-'));
  const projectionArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-host-projection-'));
  const searchData = searchArtifact?.data as Record<string, any> | undefined;
  const projectionData = projectionArtifact?.data as Record<string, any> | undefined;
  assert.equal(searchData?.answerEvidenceState, 'source-pages-read');
  assert.equal(searchData?.sourcePages?.[0]?.textRef, 'browser-host-session:search-session/source-pages/source-1.txt');
  const sourcePageTraceRefs = ((projectionData?.traceRefs ?? []) as Array<{ kind?: unknown; ref?: unknown }>)
    .filter((ref) => ref.ref === 'browser-host-session:search-session/source-pages/source-1.txt');
  assert.deepEqual(sourcePageTraceRefs.map((ref) => ref.kind), ['source-page']);
  assert.equal(((projectionData?.traceRefs ?? []) as Array<{ kind?: unknown; ref?: unknown }>)
    .some((ref) => ref.kind === 'search-result' && ref.ref === 'browser-host-session:search-session/source-pages/source-1.txt'), false);
});

test('browser_host_search_runtime surfaces unavailable BrowserHostSession diagnostics as a visible needs-human answer', async () => {
  const output = failedBrowserSearchOutput();
  const manager = {
    async search() {
      return output;
    },
  } as unknown as BrowserHostSessionManager;
  const events: string[] = [];

  const payload = await tryRunBrowserHostSearchRuntime({
    ...browserSearchRequest(),
    prompt: '通过内置浏览器搜索伊朗局势',
  }, {
    onEvent: (event) => events.push(`${event.type}:${event.status}`),
  }, manager);

  assert.ok(payload);
  assert.match(payload.message, /内置浏览器.*没有成功打开搜索页/);
  assert.match(payload.message, /原生适配器|适配器/);
  assert.doesNotMatch(payload.message, /没有为“伊朗局势”找到可用搜索结果/);
  assert.equal(payload.displayIntent?.reason, 'browser-host-session-unavailable');
  assert.equal(payload.displayIntent?.taskOutcome, 'needs-human');
  assert.equal(payload.displayIntent?.status, 'needs-human');
  assert.equal(payload.executionUnits?.[0]?.status, 'needs-human');
  assert.match(String(payload.executionUnits?.[0]?.failureReason ?? ''), /BrowserHostSession|适配器|adapter/i);
  assert.deepEqual(events, [
    'browser-host-search-runtime:running',
    'browser-host-search-runtime:needs-human',
  ]);

  const searchArtifact = payload.artifacts?.find((artifact): artifact is BrowserHostRuntimeArtifact => artifactIdStartsWith(artifact, 'browser-search-results-'));
  const searchData = searchArtifact?.data as Record<string, any> | undefined;
  assert.equal(searchData?.answerEvidenceState, 'browser-unavailable');
  assert.ok(Array.isArray(searchData?.browserHostSessionDiagnostics));
  assert.match(JSON.stringify(searchData?.browserHostSessionDiagnostics), /Native embedded BrowserHostSession adapter/);
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
    query: 'latest OpenAI API model guidance',
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

test('browser_host_search_runtime prefers official surfaces for clear platform ranking pages', () => {
  const input = browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: '搜索 Hugging Face Daily Papers 今天热门论文',
    selectedToolIds: [],
  });
  const today = localIsoDateForTest(new Date());
  const yesterday = localIsoDateForTest(new Date(Date.now() - 24 * 60 * 60 * 1000));

  assert.equal(input?.query, 'Hugging Face Daily Papers 今天热门论文');
  assert.equal(input?.preferredResults?.[0]?.title, `Hugging Face Daily Papers API (${today})`);
  assert.equal(input?.preferredResults?.[0]?.url, `https://huggingface.co/api/daily_papers?date=${today}`);
  assert.equal(input?.preferredResults?.[1]?.url, `https://huggingface.co/api/daily_papers?date=${yesterday}`);
  assert.equal(input?.preferredResults?.[2]?.url, 'https://huggingface.co/papers');

  const generalInput = browserHostSearchInputFromRequest({
    ...browserSearchRequest(),
    prompt: 'browser_search("Hugging Face Daily Papers trending papers")',
    selectedToolIds: [],
  });
  assert.equal(generalInput?.preferredResults?.[0]?.url, 'https://huggingface.co/api/daily_papers?sort=trending');
  assert.equal(generalInput?.preferredResults?.[1]?.url, 'https://huggingface.co/papers');
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

function localIsoDateForTest(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function failedBrowserSearchOutput(): BrowserHostSearchOutput {
  return {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: '伊朗局势',
    engine: 'bing',
    searchedAt: '2026-06-06T00:00:01.000Z',
    searchUrl: 'https://cn.bing.com/search?q=%E4%BC%8A%E6%9C%97%E5%B1%80%E5%8A%BF',
    finalUrl: 'about:blank',
    results: [],
    session: {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: 'search-session',
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'failed',
      workspacePath: '/tmp/sciforge-work',
      requestedUrl: 'https://cn.bing.com/search?q=%E4%BC%8A%E6%9C%97%E5%B1%80%E5%8A%BF',
      url: 'about:blank',
      startedAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:01.000Z',
      viewport: { width: 1365, height: 900 },
      canGoBack: false,
      canGoForward: false,
      loadingProgress: {
        schemaVersion: BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
        state: 'handoff',
        reason: 'host-error',
        source: 'host-error',
        status: 'failed',
        updatedAt: '2026-06-06T00:00:01.000Z',
        refs: {},
        blocked: true,
        requiresHandoff: true,
      },
      diagnostics: [
        'Native embedded BrowserHostSession adapter is required; set SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL to a loopback native adapter. Legacy host-stream fallback is disabled.',
      ],
    },
    searchResultRef: 'browser-host-session:search-session/search-results.json',
  };
}
