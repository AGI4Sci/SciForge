import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostSessionActionInput,
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import {
  browserHostSearchInputFromRequest,
  tryRunBrowserHostSearchRuntime,
} from '../../src/runtime/browser-host-search-runtime.js';
import type { GatewayRequest, ToolPayload } from '../../src/runtime/runtime-types.js';
import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../src/ui/src/domain';
import { focusResultPaneRouteForObjectReference } from '../../src/ui/src/app/results/resultPaneContract';
import { RightPaneActiveSurface, type RightPaneActiveSurfaceProps } from '../../src/ui/src/app/results/rightPaneSurfaceAdapter';
import type { ResultsRendererViewModel } from '../../src/ui/src/app/results-renderer-view-model';

const VISIBLE_SESSION_ID = 'visible-browser-host-session';
const FINAL_URL = 'https://search.example.test/results?q=refs+first+visible+handoff';
const CLICKED_RESULT_URL = 'https://example.org/browser/refs-first';
const WORKSPACE_PATH = '/tmp/sciforge-browser-search-visible-session-handoff';

test('browser_search reuses the visible BrowserHostSession refs and focused projection keeps one right-pane owner', async () => {
  const request = browserSearchRequest();
  assert.deepEqual(browserHostSearchInputFromRequest(request), {
    query: 'refs first visible handoff',
    limit: 3,
    engine: 'bing',
    timeoutMs: 45_000,
    sessionId: VISIBLE_SESSION_ID,
  });

  const calls: Array<{ workspacePath: string; input: BrowserHostSearchInput }> = [];
  const manager = {
    async search(workspacePath: string, input: BrowserHostSearchInput) {
      calls.push({ workspacePath, input });
      assert.equal(input.sessionId, VISIBLE_SESSION_ID, 'browser_search must reuse the visible BrowserHostSession id');
      return browserSearchOutput();
    },
  } as unknown as BrowserHostSessionManager;

  const payload = await tryRunBrowserHostSearchRuntime(request, {}, manager);
  assert.ok(payload, 'browser_search should produce a payload for explicit browser_search input');
  assert.deepEqual(calls, [{
    workspacePath: WORKSPACE_PATH,
    input: {
      query: 'refs first visible handoff',
      limit: 3,
      engine: 'bing',
      timeoutMs: 45_000,
      sessionId: VISIBLE_SESSION_ID,
    },
  }]);

  const searchArtifact = artifactByType(payload, 'browser-search-results');
  const projectionArtifact = artifactByType(payload, 'browser-runtime-projection');
  assert.equal(searchArtifact?.schemaVersion, BROWSER_HOST_SEARCH_SCHEMA);
  assert.equal(recordValue(searchArtifact?.data)?.browserSessionRef, `browser-host-session:${VISIBLE_SESSION_ID}`);
  assert.equal(recordValue(searchArtifact?.data)?.projectionRef, `artifact:${projectionArtifact?.id}`);
  assert.equal(recordValue(recordValue(projectionArtifact?.data)?.hostSession)?.id, VISIBLE_SESSION_ID);

  const focusedObjectReference = (payload.objectReferences ?? []).find((reference) => {
    const record = recordValue(reference);
    return record?.kind === 'artifact'
      && record.artifactType === 'browser-runtime-projection'
      && record.preferredView === 'browser-workbench';
  }) as ObjectReference | undefined;
  assert.ok(focusedObjectReference, 'payload should expose a browser-workbench projection object reference');
  assert.equal(focusResultPaneRouteForObjectReference(focusedObjectReference).pane, 'browser');
  assert.equal(recordValue(focusedObjectReference.provenance)?.browserSessionRef, `browser-host-session:${VISIBLE_SESSION_ID}`);

  const html = renderToStaticMarkup(createElement(RightPaneActiveSurface, {
    ...baseProps(),
    resultTab: 'browser',
    focusedObjectReference,
    session: sessionFixture(payload),
    browserAddressDraft: FINAL_URL,
  }));

  assert.match(html, /data-testid="right-pane-browser-tool"/);
  assert.match(html, /data-component-id="browser-workbench"/);
  assert.match(html, /data-browser-state="ready"/);
  assert.match(html, /data-browser-host-surface="browser-host-session"/);
  assert.match(html, /data-browser-live-surface-ref="browser-host-session:visible-browser-host-session\/live-surface"/);
  assert.match(html, /data-browser-frame-stream-ref="browser-host-session:visible-browser-host-session\/frame-stream"/);
  assert.match(html, /data-browser-single-interactive-truth="true"/);
  assert.deepEqual(uniqueBrowserHostSessionIds(html), [VISIBLE_SESSION_ID]);
  assert.equal(countMatches(html, /data-browser-object-type="host-browser"/g), 1);

  const report = {
    contract: 'sciforge.browser-search.visible-session-handoff.v1',
    runtime: {
      reusedSessionId: calls[0]?.input.sessionId,
      browserSessionRef: recordValue(searchArtifact?.data)?.browserSessionRef,
      projectionRef: recordValue(searchArtifact?.data)?.projectionRef,
      projectionHostSessionId: recordValue(recordValue(projectionArtifact?.data)?.hostSession)?.id,
    },
    rightPane: boundedRightPaneReport(html),
  };
  assert.equal(report.runtime.reusedSessionId, VISIBLE_SESSION_ID);
  assert.equal(report.rightPane.secondTruthSource, false);
  assert.equal(report.rightPane.inlinePayloadsCaptured, false);
  assertRefsFirstAndNoSecondTruth(payload, html, report);
  console.log(`[ok] Browser search visible session handoff ${JSON.stringify(report)}`);
});

test('browser_search result click and typing stay on the visible owner while summary evidence is refs-first bounded', async () => {
  const searchDeferred = createDeferred<BrowserHostSearchOutput>();
  const summaryOrder: string[] = [];
  const calls: Array<
    | { kind: 'search'; workspacePath: string; input: BrowserHostSearchInput }
    | { kind: 'act'; workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }
  > = [];
  const state = visibleHostSession();
  const manager = {
    async search(workspacePath: string, input: BrowserHostSearchInput) {
      summaryOrder.push('summary-started');
      calls.push({ kind: 'search', workspacePath, input });
      return searchDeferred.promise;
    },
    async act(workspacePath: string, sessionId: string, input: BrowserHostSessionActionInput) {
      calls.push({ kind: 'act', workspacePath, sessionId, input });
      assert.equal(sessionId, VISIBLE_SESSION_ID, 'visible BrowserHostSession owner must handle post-search user actions');
      if (input.action === 'navigate') {
        state.requestedUrl = input.url ?? state.url;
        state.url = input.url ?? state.url;
        state.title = 'Clicked result still in visible BrowserHostSession';
      }
      state.updatedAt = '2026-06-02T00:00:02.000Z';
      return { ...state };
    },
  } as unknown as BrowserHostSessionManager & {
    act(workspacePath: string, sessionId: string, input: BrowserHostSessionActionInput): Promise<BrowserHostSessionState>;
  };
  const events: string[] = [];
  let runtimeSettled = false;
  const runtimePromise = tryRunBrowserHostSearchRuntime(browserSearchRequest(), {
    onEvent: (event) => events.push(`${event.type}:${event.status}`),
  }, manager).finally(() => {
    runtimeSettled = true;
  });

  await Promise.resolve();
  assert.equal(calls[0]?.kind, 'search');
  assert.equal(calls[0]?.input.sessionId, VISIBLE_SESSION_ID);

  summaryOrder.push('user-input-before-summary-start');
  const typedWhileSummaryPending = await manager.act(WORKSPACE_PATH, VISIBLE_SESSION_ID, {
    action: 'type',
    text: 'continue browsing while refs-first summary is pending',
    capture: 'none',
    actionId: 'user-type-while-browser-search-summary-pending',
  });
  summaryOrder.push('user-input-before-summary-accepted');
  assert.equal(typedWhileSummaryPending.id, VISIBLE_SESSION_ID);
  assert.equal(runtimeSettled, false, 'summary generation must not be required before user input continues');

  summaryOrder.push('summary-resolved');
  searchDeferred.resolve(browserSearchOutput());
  const payload = await runtimePromise;
  summaryOrder.push('summary-payload-returned');
  assert.ok(payload);
  assert.equal(runtimeSettled, true);

  const searchArtifact = artifactByType(payload, 'browser-search-results');
  const projectionArtifact = artifactByType(payload, 'browser-runtime-projection');
  assert.equal(recordValue(searchArtifact?.data)?.browserSessionRef, `browser-host-session:${VISIBLE_SESSION_ID}`);
  assert.equal(recordValue(searchArtifact?.data)?.projectionRef, `artifact:${projectionArtifact?.id}`);
  assert.equal(recordValue(recordValue(projectionArtifact?.data)?.hostSession)?.owner, 'host');
  assert.equal(recordValue(recordValue(projectionArtifact?.data)?.hostSession)?.id, VISIBLE_SESSION_ID);

  const clickedResultState = await manager.act(WORKSPACE_PATH, VISIBLE_SESSION_ID, {
    action: 'navigate',
    url: CLICKED_RESULT_URL,
    capture: 'frame',
    timeoutMs: 45_000,
    actionId: 'user-click-search-result-after-summary',
  });
  summaryOrder.push('result-click-after-summary-navigated');
  const typedAfterClickState = await manager.act(WORKSPACE_PATH, VISIBLE_SESSION_ID, {
    action: 'type',
    text: 'annotate clicked result in the live page',
    capture: 'none',
    actionId: 'user-type-after-search-result-click',
  });
  summaryOrder.push('user-input-after-summary-accepted');
  assert.equal(clickedResultState.id, VISIBLE_SESSION_ID);
  assert.equal(typedAfterClickState.id, VISIBLE_SESSION_ID);

  const actionCalls = calls.filter((call): call is Extract<typeof calls[number], { kind: 'act' }> => call.kind === 'act');
  assert.deepEqual(actionCalls.map((call) => call.sessionId), [
    VISIBLE_SESSION_ID,
    VISIBLE_SESSION_ID,
    VISIBLE_SESSION_ID,
  ]);
  assert.deepEqual(actionCalls.map((call) => call.input.action), ['type', 'navigate', 'type']);
  assert.deepEqual(events, [
    'browser-host-search-runtime:running',
    'browser-host-search-runtime:satisfied',
  ]);

  const report = {
    contract: 'sciforge.browser-search.visible-session-owner-and-nonblocking-summary.v1',
    refsFirst: {
      browserSessionRef: recordValue(searchArtifact?.data)?.browserSessionRef,
      projectionRef: recordValue(searchArtifact?.data)?.projectionRef,
      searchResultRef: recordValue(searchArtifact?.data)?.searchResultRef,
      screenshotRef: recordValue(searchArtifact?.data)?.screenshotRef,
      domSnapshotRef: recordValue(searchArtifact?.data)?.domSnapshotRef,
      axSnapshotRef: recordValue(searchArtifact?.data)?.axSnapshotRef,
      consoleLogRef: recordValue(searchArtifact?.data)?.consoleLogRef,
      networkLogRef: recordValue(searchArtifact?.data)?.networkLogRef,
    },
    userContinuation: {
      inputAcceptedBeforeSummaryPayload: true,
      runtimeSettledAfterInput: false,
      postSummaryActionOwners: actionCalls.map((call) => `browser-host-session:${call.sessionId}`),
      postSummaryActions: actionCalls.map((call) => call.input.action),
      clickedResultUrlHash: hashBoundedUrl(CLICKED_RESULT_URL),
    },
    summaryNonblockingEvidence: {
      boundedOrder: summaryOrder,
      inputAcceptedBeforeSummaryPayload: indexOfRequired(summaryOrder, 'user-input-before-summary-accepted')
        < indexOfRequired(summaryOrder, 'summary-payload-returned'),
      summaryResolvedBeforePayload: indexOfRequired(summaryOrder, 'summary-resolved')
        < indexOfRequired(summaryOrder, 'summary-payload-returned'),
      runtimeEvents: events,
      rawSummaryPayloadCaptured: false,
    },
    payloadPolicy: {
      refsFirst: true,
      inlineDomPayloadCaptured: false,
      inlineEncodedImageCaptured: false,
      inlineRasterCaptured: false,
    },
  };
  assert.equal(report.userContinuation.runtimeSettledAfterInput, false);
  assert.equal(report.summaryNonblockingEvidence.inputAcceptedBeforeSummaryPayload, true);
  assert.equal(report.summaryNonblockingEvidence.summaryResolvedBeforePayload, true);
  assert.deepEqual(report.summaryNonblockingEvidence.boundedOrder, [
    'summary-started',
    'user-input-before-summary-start',
    'user-input-before-summary-accepted',
    'summary-resolved',
    'summary-payload-returned',
    'result-click-after-summary-navigated',
    'user-input-after-summary-accepted',
  ]);
  assert.equal(report.payloadPolicy.refsFirst, true);
  assertRefsFirstAndNoSecondTruth(payload, '', report);
  console.log(`[ok] Browser search visible session owner continuation ${JSON.stringify(report)}`);
});

function browserSearchRequest(): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'browser_search("refs first visible handoff") limit: 3',
    workspacePath: WORKSPACE_PATH,
    selectedToolIds: ['browser_search'],
    uiState: {
      sessionId: 'chat-session-not-browser-session',
      currentReferences: [{
        id: 'obj-current-visible-browser',
        kind: 'artifact',
        title: 'Visible BrowserHostSession',
        ref: 'artifact:visible-browser-host-projection',
        artifactType: 'browser-runtime-projection',
        preferredView: 'browser-workbench',
        status: 'available',
        provenance: {
          producer: BROWSER_HOST_SESSION_PROVIDER_ID,
          dataRef: `browser-host-session:${VISIBLE_SESSION_ID}`,
          browserSessionRef: `browser-host-session:${VISIBLE_SESSION_ID}`,
          projectionRef: 'artifact:visible-browser-host-projection',
        },
      }],
    },
    references: [{
      ref: `browser-host-session:${VISIBLE_SESSION_ID}`,
      browserSessionRef: `browser-host-session:${VISIBLE_SESSION_ID}`,
    }],
    artifacts: [],
  };
}

function browserSearchOutput(): BrowserHostSearchOutput {
  return {
    schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
    query: 'refs first visible handoff',
    engine: 'bing',
    searchUrl: 'https://www.bing.com/search?q=refs+first+visible+handoff',
    finalUrl: FINAL_URL,
    results: [
      {
        title: 'Refs-first browser evidence',
        url: 'https://example.org/browser/refs-first',
        snippet: 'Bounded result text with search, screenshot, DOM, AX, console, and network evidence behind refs.',
      },
      {
        title: 'Visible BrowserHostSession reuse',
        url: 'https://example.org/browser/session-reuse',
        snippet: 'The visible host-owned browser session remains the only interactive owner.',
      },
    ],
    session: visibleHostSession(),
    searchResultRef: `browser-host-session:${VISIBLE_SESSION_ID}/search-results.json`,
    screenshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/screenshot.png`,
    domSnapshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/dom.html`,
    axSnapshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/ax.json`,
    consoleLogRef: `browser-host-session:${VISIBLE_SESSION_ID}/console.jsonl`,
    networkLogRef: `browser-host-session:${VISIBLE_SESSION_ID}/network.jsonl`,
  };
}

function visibleHostSession(): BrowserHostSessionState {
  return {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: VISIBLE_SESSION_ID,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: WORKSPACE_PATH,
    requestedUrl: FINAL_URL,
    url: FINAL_URL,
    title: 'Visible browser search results',
    startedAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:01.000Z',
    viewport: { width: 1365, height: 900 },
    canGoBack: true,
    canGoForward: false,
    liveSurfaceRef: `browser-host-session:${VISIBLE_SESSION_ID}/live-surface`,
    liveSurfaceTransport: 'host-stream',
    singleInteractiveTruth: true,
    frameStreamRef: `browser-host-session:${VISIBLE_SESSION_ID}/frame-stream`,
    frameRef: `browser-host-session:${VISIBLE_SESSION_ID}/frame.png`,
    screenshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/screenshot.png`,
    domSnapshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/dom.html`,
    axSnapshotRef: `browser-host-session:${VISIBLE_SESSION_ID}/ax.json`,
    consoleLogRef: `browser-host-session:${VISIBLE_SESSION_ID}/console.jsonl`,
    networkLogRef: `browser-host-session:${VISIBLE_SESSION_ID}/network.jsonl`,
    searchResultRef: `browser-host-session:${VISIBLE_SESSION_ID}/search-results.json`,
    diagnostics: [],
  };
}

function sessionFixture(payload: ToolPayload): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'browser-search-visible-session-handoff',
    scenarioId: 'literature-evidence-review',
    title: 'Browser search visible session handoff',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:01.000Z',
    messages: [],
    runs: [],
    uiManifest: payload.uiManifest ?? [],
    claims: payload.claims ?? [],
    executionUnits: payload.executionUnits ?? [],
    artifacts: (payload.artifacts ?? []) as unknown as RuntimeArtifact[],
    notebook: [],
    versions: [],
  } as unknown as SciForgeSession;
}

function baseProps(): RightPaneActiveSurfaceProps {
  return {
    hasOpenRightPaneTabs: true,
    resultTab: 'browser',
    activeResultTabId: 'browser:visible-session-handoff',
    scenarioId: 'literature-evidence-review',
    config: configFixture(),
    workspaceFileConfig: configFixture(),
    session: sessionFixture({} as ToolPayload),
    focusMode: 'all',
    executionFocus: false,
    model: {} as ResultsRendererViewModel,
    locale: 'en-US',
    pinnedObjectReferences: [],
    objectActionError: '',
    objectActionNotice: '',
    workspaceFileEditor: null,
    activeFilesWorkspaceFileEditor: null,
    workspaceFileOpenTabs: [],
    onBrowserAddressDraftChange: () => undefined,
    onCommandRequest: () => undefined,
    onObjectAction: () => undefined,
    onClearFocusedObject: () => undefined,
    onObjectReferenceFocus: () => undefined,
    onWorkspaceFileEditorChange: () => undefined,
    onCloseWorkspaceFileEditor: () => undefined,
    onTerminalSessionChange: () => undefined,
    onSelectOpenFile: () => undefined,
    onCloseOpenFile: () => undefined,
    onOpenFileEditor: () => undefined,
    onCloseFileView: () => undefined,
    onActiveFileEditorChange: () => undefined,
    onArtifactHandoff: () => undefined,
    onInspectArtifact: () => undefined,
    onWorkbenchToolSelect: () => undefined,
  };
}

function configFixture(): SciForgeConfig {
  return {
    workspacePath: WORKSPACE_PATH,
    workspaceWriterBaseUrl: 'http://127.0.0.1:61234',
    locale: 'en-US',
  } as SciForgeConfig;
}

function artifactByType(payload: ToolPayload, type: string): RuntimeArtifact | undefined {
  return (payload.artifacts ?? []).find((artifact) => recordValue(artifact)?.type === type) as RuntimeArtifact | undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedRightPaneReport(html: string) {
  return {
    sessionIds: uniqueBrowserHostSessionIds(html),
    liveSurfaceRefs: uniqueAttrValues(html, 'data-browser-live-surface-ref'),
    frameStreamRefs: uniqueAttrValues(html, 'data-browser-frame-stream-ref'),
    frameRefs: uniqueAttrValues(html, 'data-browser-frame-ref'),
    transports: uniqueAttrValues(html, 'data-browser-live-surface-transport'),
    hostBrowserObjects: countMatches(html, /data-browser-object-type="host-browser"/g),
    iframeSurfaces: countMatches(html, /<iframe\b/g),
    proxyFallbacks: countMatches(html, /\/api\/sciforge\/browser\/proxy/g),
    systemPopupSurfaces: countMatches(html, /system-browser-window/g),
    secondTruthSource: /<iframe|<webview|data-browser-object-type="browser-embedded-frame"|\/api\/sciforge\/browser\/proxy|system-browser-window/i.test(html),
    inlinePayloadsCaptured: /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b/i.test(html),
  };
}

function assertRefsFirstAndNoSecondTruth(payload: ToolPayload, html: string, report: unknown) {
  const serialized = JSON.stringify({ payload, html, report });
  assert.doesNotMatch(serialized, /data:image|base64|screenshotBase64|raw(?:Dom|DOM|Html|HTML|Screenshot|Payload)|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(serialized, /\/api\/sciforge\/browser\/proxy|system-browser-window|data-browser-object-type="browser-embedded-frame"|<webview\b/i);
}

function uniqueBrowserHostSessionIds(html: string) {
  return [...new Set([...html.matchAll(/browser-host-session:([^/"<\s]+)/g)]
    .map((match) => match[1]?.split('/')[0])
    .filter((id): id is string => Boolean(id)))
  ].sort();
}

function uniqueAttrValues(html: string, attr: string) {
  return [...new Set([...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value)))
  ].sort();
}

function countMatches(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].length;
}

function indexOfRequired(values: string[], value: string): number {
  const index = values.indexOf(value);
  assert.notEqual(index, -1, `missing ordered evidence step: ${value}`);
  return index;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function hashBoundedUrl(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}
