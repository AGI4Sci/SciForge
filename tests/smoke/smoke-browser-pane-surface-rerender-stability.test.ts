import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BrowserHostSessionState } from '../../src/ui/src/api/workspaceClient';
import type { ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../src/ui/src/domain';
import { RightPaneBrowserTool } from '../../src/ui/src/app/results/browserPaneHostAdapter';
import { rightPaneBrowserProjectionForUrl } from '../../src/ui/src/app/results/browserPaneModel';

const SESSION_ID = 'surface-rerender-stability';
const TARGET_URL = 'https://external.example/browser-surface';
const WORKSPACE_PATH = '/tmp/sciforge-browser-surface-rerender-stability';
const WRITER_URL = 'http://127.0.0.1:61234';

test('Browser pane rerenders preserve one host-stream BrowserHostSession owner across right-pane refreshes', () => {
  const currentObjectUrl = 'blob:http://127.0.0.1/browser-host-current-frame';
  const phases = [
    {
      phase: 'initial',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: hostStreamSession({ frameUrl: currentObjectUrl }),
    },
    {
      phase: 'react-rerender',
      addressDraft: `${TARGET_URL}`,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: hostStreamSession({ frameUrl: currentObjectUrl, updatedAt: '2026-06-02T00:00:02.000Z' }),
    },
    {
      phase: 'config-refresh',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: `${WRITER_URL}/` }),
      hostSession: hostStreamSession({ frameUrl: currentObjectUrl, updatedAt: '2026-06-02T00:00:03.000Z' }),
    },
    {
      phase: 'focused-object-refresh',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: hostStreamSession({
        frameUrl: currentObjectUrl,
        updatedAt: '2026-06-02T00:00:04.000Z',
        searchResultRef: `browser-host-session:${SESSION_ID}/search-results-v2.json`,
        diagnostics: ['refs refreshed without remount'],
      }),
    },
    {
      phase: 'loading-busy',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: hostStreamSession({
        status: 'loading',
        frameUrl: currentObjectUrl,
        updatedAt: '2026-06-02T00:00:05.000Z',
      }),
      hostBusy: true,
    },
  ];

  const busyProjection = rightPaneBrowserProjectionForUrl(TARGET_URL, {
    hostExternalBrowserAvailable: true,
    hostSurface: 'browser-host-session',
    hostBusy: true,
    hostSession: hostStreamSession({ frameUrl: currentObjectUrl }),
  });
  assert.equal(busyProjection.status, 'loading');
  assert.equal(busyProjection.hostSurface, 'browser-host-session');

  const evidence = phases.map((phase) => {
    const html = renderBrowserPanePhase(phase);
    assertStableBrowserHostSurface(html, {
      phase: phase.phase,
      sessionId: SESSION_ID,
      expectedTransport: 'host-stream',
      expectedFrameTransport: 'websocket-binary',
      expectedSurface: 'canvas',
      expectedStatus: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
    });
    return boundedSurfaceEvidence(phase.phase, html);
  });

  assert.equal(new Set(evidence.map((item) => item.liveSurfaceRef)).size, 1);
  assert.deepEqual([...new Set(evidence.flatMap((item) => item.sessionIds))], [SESSION_ID]);
  assert.ok(evidence.every((item) => item.secondTruthSource === false));
  assertRefsOnlyReport(evidence);
  console.log(`[ok] Browser pane host-stream rerender stability ${JSON.stringify(evidence)}`);
});

test('Browser pane rerenders preserve canvas-binary and native surface attrs for the same BrowserHostSession', () => {
  const canvasPhases = [
    {
      phase: 'canvas-initial',
      addressDraft: TARGET_URL,
      config: configFixture(),
      hostSession: hostStreamSession({ frameUrl: undefined, viewport: { width: 1280, height: 720 } }),
    },
    {
      phase: 'canvas-focused-object-refresh',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: `${WRITER_URL}/refresh` }),
      hostSession: hostStreamSession({
        frameUrl: undefined,
        updatedAt: '2026-06-02T00:01:00.000Z',
        viewport: { width: 1280, height: 720 },
        screenshotRef: `browser-host-session:${SESSION_ID}/screenshot-v2.png`,
      }),
    },
    {
      phase: 'canvas-loading',
      addressDraft: TARGET_URL,
      config: configFixture(),
      hostSession: hostStreamSession({
        status: 'loading',
        frameUrl: undefined,
        updatedAt: '2026-06-02T00:01:01.000Z',
        viewport: { width: 1280, height: 720 },
      }),
      hostBusy: true,
    },
  ];
  const canvasEvidence = canvasPhases.map((phase) => {
    const html = renderBrowserPanePhase(phase);
    assertStableBrowserHostSurface(html, {
      phase: phase.phase,
      sessionId: SESSION_ID,
      expectedTransport: 'host-stream',
      expectedFrameTransport: 'websocket-binary',
      expectedSurface: 'canvas',
      expectedStatus: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
    });
    assert.match(html, /data-browser-frame-renderer="canvas-binary"/);
    assert.match(html, /data-browser-frame-source="browser-host-session-frame-stream-binary"/);
    assert.match(html, /data-browser-frame-session-id="surface-rerender-stability"/);
    return boundedSurfaceEvidence(phase.phase, html);
  });

  const nativePhases = [
    {
      phase: 'native-initial',
      addressDraft: TARGET_URL,
      config: configFixture(),
      hostSession: nativeSession(),
    },
    {
      phase: 'native-config-refresh',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: `${WRITER_URL}/native-refresh` }),
      hostSession: nativeSession({ updatedAt: '2026-06-02T00:02:00.000Z' }),
    },
    {
      phase: 'native-loading',
      addressDraft: TARGET_URL,
      config: configFixture(),
      hostSession: nativeSession({ status: 'loading', updatedAt: '2026-06-02T00:02:01.000Z' }),
      hostBusy: true,
    },
  ];
  const nativeEvidence = nativePhases.map((phase) => {
    const html = renderBrowserPanePhase(phase);
    assertStableBrowserHostSurface(html, {
      phase: phase.phase,
      sessionId: SESSION_ID,
      expectedTransport: 'native-embedded',
      expectedFrameTransport: 'native-embedded',
      expectedSurface: 'native',
      expectedStatus: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
    });
    assert.match(html, /data-browser-native-surface="true"/);
    assert.match(html, /browser-workbench-host-frame-native/);
    return boundedSurfaceEvidence(phase.phase, html);
  });

  const evidence = [...canvasEvidence, ...nativeEvidence];
  assert.deepEqual([...new Set(evidence.flatMap((item) => item.sessionIds))], [SESSION_ID]);
  assert.ok(evidence.every((item) => item.secondTruthSource === false));
  assertRefsOnlyReport(evidence);
  console.log(`[ok] Browser pane canvas/native rerender stability ${JSON.stringify(evidence)}`);
});

test('Browser pane adapter keeps session start attach and object URL revoke guards session-scoped', () => {
  const adapterSource = readFileSync(new URL('../../src/ui/src/app/results/browserPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /const initialHostSession = browserHostSessionForFocusedObjectReference\(focusedObjectReference, session\) as BrowserHostSessionState \| undefined;/);
  assert.match(adapterSource, /useState<BrowserHostSessionState \| undefined>\(\(\) => \{[\s\S]*browserHostSessionMatchesTarget\(initialHostSession, normalizedUrl\)[\s\S]*initialHostSession[\s\S]*cachedRightPaneBrowserHostSession\(hostSessionCacheKey, normalizedUrl\)/);
  assert.match(adapterSource, /setHostSession\(\(current\) => current && current\.id === focusedHostSession\.id && current\.updatedAt === focusedHostSession\.updatedAt \? current : focusedHostSession\)/);
  assert.match(adapterSource, /if \(browserHostSessionMatchesTarget\(hostSession, normalizedUrl\)\) return;[\s\S]*startBrowserHostSession\(config, \{ url: normalizedUrl, \.\.\.viewportRef\.current \}\)/);
  assert.match(adapterSource, /frameUrl: hostSession && !browserHostSessionUsesNativeSurface\(hostSession\) && hostFrameObjectSessionRef\.current === hostSession\.id \? hostFrameObjectUrl : undefined/);
  assert.match(adapterSource, /frameTransport:[\s\S]*hostFrameObjectSessionRef\.current === hostSession\?\.id && hostFrameObjectUrl \? 'websocket-binary' : undefined/);
  assert.match(adapterSource, /if \(pendingBinaryFrameSessionRef\.current !== sessionId \|\| hostSessionRef\.current\?\.id !== sessionId\) return true;/);
  assert.match(adapterSource, /const previousObjectUrl = hostFrameObjectUrlRef\.current;[\s\S]*hostFrameObjectUrlRef\.current = objectUrl;[\s\S]*hostFrameObjectSessionRef\.current = sessionId;[\s\S]*setHostFrameObjectUrl\(objectUrl\);[\s\S]*if \(previousObjectUrl && previousObjectUrl !== objectUrl && typeof URL\.revokeObjectURL === 'function'\) URL\.revokeObjectURL\(previousObjectUrl\)/);
  assert.match(adapterSource, /focus: nativeSurfaceSessionRef\.current !== sessionState\.id/);
  assert.match(adapterSource, /nativeSurfaceSessionRef\.current = sessionState\.id/);
  assert.match(adapterSource, /}, \[hostSession\?\.id, hostSession\?\.liveSurfaceTransport, hostSession\?\.status, needsBrowserHost\]\);/);
  assert.doesNotMatch(adapterSource, /window\.open\(|system-browser-window|\/api\/sciforge\/browser\/proxy|<iframe|<webview/);
});

function renderBrowserPanePhase(phase: {
  phase: string;
  addressDraft: string;
  config: SciForgeConfig;
  hostSession: BrowserHostSessionState;
  hostBusy?: boolean;
}) {
  const focusedObjectReference = focusedBrowserObjectReference(phase.hostSession.id);
  const session = sessionFixture(phase.hostSession);
  return renderToStaticMarkup(createElement(RightPaneBrowserTool, {
    tabId: `browser-${phase.phase}`,
    config: phase.config,
    session,
    locale: 'en-US',
    focusedObjectReference,
    addressDraft: phase.addressDraft,
    onAddressDraftChange: () => undefined,
    onCommandRequest: () => undefined,
    onConfigChange: () => undefined,
    onOpenSettings: () => undefined,
  }));
}

function assertStableBrowserHostSurface(
  html: string,
  expected: {
    phase: string;
    sessionId: string;
    expectedTransport: 'host-stream' | 'native-embedded';
    expectedFrameTransport: 'websocket-binary' | 'native-embedded';
    expectedSurface: 'image' | 'canvas' | 'native';
    expectedStatus: 'ready' | 'loading';
    expectedFrameUrl?: string;
  },
) {
  assert.equal(countMatches(html, /data-browser-object-type="host-browser"/g), 1, `${expected.phase}: one host-browser object`);
  assert.deepEqual(uniqueBrowserHostSessionIds(html), [expected.sessionId], `${expected.phase}: one BrowserHostSession id`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-live-surface-ref'), [`browser-host-session:${expected.sessionId}/live-surface`], `${expected.phase}: stable live surface ref`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-live-surface-transport'), [expected.expectedTransport], `${expected.phase}: stable transport`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-single-interactive-truth'), ['true'], `${expected.phase}: single truth attr`);
  assert.match(html, new RegExp(`data-status="${expected.expectedStatus}"`), `${expected.phase}: status`);
  assert.match(html, new RegExp(`data-browser-state="${expected.expectedStatus}"`), `${expected.phase}: browser state`);
  assert.doesNotMatch(html, /<iframe|<webview|data-browser-object-type="browser-embedded-frame"|data-browser-state-action="proxy-fallback"|\/api\/sciforge\/browser\/proxy|system-browser-window|data:image|base64/i, `${expected.phase}: no live fallback or raw payload`);

  if (expected.expectedSurface === 'image') {
    assert.equal(countMatches(html, /<img\b/g), 1, `${expected.phase}: one image host stream surface`);
    assert.equal(countMatches(html, /<canvas\b/g), 0, `${expected.phase}: no canvas fallback`);
    assert.equal(countMatches(html, /data-browser-native-surface="true"/g), 0, `${expected.phase}: no native fallback`);
    assert.deepEqual(uniqueAttrValues(html, 'data-browser-frame-transport'), [expected.expectedFrameTransport], `${expected.phase}: frame transport`);
    assert.match(html, new RegExp(`src="${escapeRegExp(expected.expectedFrameUrl ?? '')}"`), `${expected.phase}: current object URL is retained`);
  } else if (expected.expectedSurface === 'canvas') {
    assert.equal(countMatches(html, /<canvas\b/g), 1, `${expected.phase}: one canvas surface`);
    assert.equal(countMatches(html, /<img\b/g), 0, `${expected.phase}: no object URL image fallback`);
    assert.equal(countMatches(html, /data-browser-native-surface="true"/g), 0, `${expected.phase}: no native fallback`);
    assert.deepEqual(uniqueAttrValues(html, 'data-browser-frame-stream-ref'), [`browser-host-session:${expected.sessionId}/frame-stream`], `${expected.phase}: stable stream ref`);
    assert.deepEqual(uniqueAttrValues(html, 'data-browser-frame-transport'), [expected.expectedFrameTransport], `${expected.phase}: frame transport`);
  } else {
    assert.equal(countMatches(html, /data-browser-native-surface="true"/g), 1, `${expected.phase}: one native mount`);
    assert.equal(countMatches(html, /<img\b/g), 0, `${expected.phase}: no image fallback`);
    assert.equal(countMatches(html, /<canvas\b/g), 0, `${expected.phase}: no canvas fallback`);
    assert.deepEqual(uniqueAttrValues(html, 'data-browser-frame-transport'), [expected.expectedFrameTransport], `${expected.phase}: native frame transport`);
  }
}

function boundedSurfaceEvidence(phase: string, html: string) {
  const sessionIds = uniqueBrowserHostSessionIds(html);
  const liveSurfaceRefs = uniqueAttrValues(html, 'data-browser-live-surface-ref');
  const frameStreamRefs = uniqueAttrValues(html, 'data-browser-frame-stream-ref');
  const frameRefs = uniqueAttrValues(html, 'data-browser-frame-ref');
  const transports = uniqueAttrValues(html, 'data-browser-live-surface-transport');
  return {
    phase,
    sessionIds,
    liveSurfaceRef: liveSurfaceRefs[0],
    frameStreamRef: frameStreamRefs[0],
    frameRef: frameRefs[0],
    transport: transports[0],
    hostBrowserObjects: countMatches(html, /data-browser-object-type="host-browser"/g),
    imageSurfaces: countMatches(html, /<img\b/g),
    canvasSurfaces: countMatches(html, /<canvas\b/g),
    nativeSurfaces: countMatches(html, /data-browser-native-surface="true"/g),
    secondTruthSource: /<iframe|<webview|data-browser-object-type="browser-embedded-frame"|\/api\/sciforge\/browser\/proxy|system-browser-window/i.test(html),
    rawPayloadsCaptured: /data:image|base64|<\s*(?:!doctype|html|body)\b/i.test(html),
  };
}

function assertRefsOnlyReport(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b|\/api\/sciforge\/browser\/proxy|system-browser-window/i);
}

function hostStreamSession(overrides: Partial<BrowserHostSessionState> = {}): BrowserHostSessionState {
  return hostSessionFixture({
    liveSurfaceTransport: 'host-stream',
    frameStreamRef: `browser-host-session:${SESSION_ID}/frame-stream`,
    frameRef: `browser-host-session:${SESSION_ID}/frame.png`,
    frameUrl: 'blob:http://127.0.0.1/browser-host-current-frame',
    ...overrides,
  });
}

function nativeSession(overrides: Partial<BrowserHostSessionState> = {}): BrowserHostSessionState {
  return hostSessionFixture({
    liveSurfaceTransport: 'native-embedded',
    frameStreamRef: undefined,
    frameRef: undefined,
    frameUrl: undefined,
    ...overrides,
  });
}

function hostSessionFixture(overrides: Partial<BrowserHostSessionState> = {}): BrowserHostSessionState {
  return {
    schemaVersion: 'sciforge.browser-host-session.state.v1',
    id: SESSION_ID,
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    requestedUrl: TARGET_URL,
    url: TARGET_URL,
    title: 'Surface rerender target',
    workspacePath: WORKSPACE_PATH,
    workspaceWriterBaseUrl: WRITER_URL,
    startedAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:01.000Z',
    viewport: { width: 1365, height: 900 },
    canGoBack: true,
    canGoForward: false,
    liveSurfaceRef: `browser-host-session:${SESSION_ID}/live-surface`,
    liveSurfaceTransport: 'host-stream',
    singleInteractiveTruth: true,
    frameStreamRef: `browser-host-session:${SESSION_ID}/frame-stream`,
    frameRef: `browser-host-session:${SESSION_ID}/frame.png`,
    screenshotRef: `browser-host-session:${SESSION_ID}/screenshot.png`,
    domSnapshotRef: `browser-host-session:${SESSION_ID}/dom.html`,
    axSnapshotRef: `browser-host-session:${SESSION_ID}/ax.json`,
    consoleLogRef: `browser-host-session:${SESSION_ID}/console.jsonl`,
    networkLogRef: `browser-host-session:${SESSION_ID}/network.jsonl`,
    diagnostics: [],
    ...overrides,
  } as BrowserHostSessionState;
}

function focusedBrowserObjectReference(sessionId: string): ObjectReference {
  return {
    id: 'obj-browser-surface-rerender-stability',
    kind: 'artifact',
    title: 'BrowserHostSession surface rerender projection',
    ref: 'artifact:browser-surface-rerender-stability',
    artifactType: 'browser-runtime-projection',
    preferredView: 'browser-workbench',
    status: 'available',
    provenance: {
      producer: 'sciforge.browser-host-session',
      dataRef: `browser-host-session:${sessionId}`,
    },
  };
}

function sessionFixture(hostSession: BrowserHostSessionState): SciForgeSession {
  return {
    id: 'surface-rerender-stability-session',
    title: 'Surface rerender stability session',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: hostSession.updatedAt ?? '2026-06-02T00:00:00.000Z',
    messages: [],
    runs: [],
    artifacts: [browserProjectionArtifact(hostSession)],
    references: [],
    objectReferences: [],
  } as unknown as SciForgeSession;
}

function browserProjectionArtifact(hostSession: BrowserHostSessionState): RuntimeArtifact {
  return {
    id: 'browser-surface-rerender-stability',
    type: 'browser-runtime-projection',
    producerScenario: 'browser-runtime',
    schemaVersion: 'sciforge.browser-runtime.projection.v1',
    metadata: {
      source: 'browser_surface_rerender_stability_smoke',
      browserSessionRef: `browser-host-session:${hostSession.id}`,
      finalUrl: hostSession.url,
    },
    data: {
      session: {
        id: hostSession.id,
        mode: 'agent-headless',
        providerId: 'sciforge.browser-host-session',
        activeTabId: `${hostSession.id}:tab`,
        tabs: [{
          id: `${hostSession.id}:tab`,
          url: hostSession.url,
          title: hostSession.title,
          status: hostSession.status === 'loading' ? 'loading' : 'ready',
        }],
      },
      hostSession,
      snapshot: {
        schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
        url: hostSession.url,
        title: hostSession.title,
        searchResultRef: hostSession.searchResultRef,
        screenshotRef: hostSession.screenshotRef,
        domSnapshotRef: hostSession.domSnapshotRef,
        axSnapshotRef: hostSession.axSnapshotRef,
        consoleLogRef: hostSession.consoleLogRef,
        networkLogRef: hostSession.networkLogRef,
      },
    },
  } as RuntimeArtifact;
}

function configFixture(overrides: Partial<SciForgeConfig> = {}): SciForgeConfig {
  return {
    workspacePath: WORKSPACE_PATH,
    workspaceWriterBaseUrl: WRITER_URL,
    ...overrides,
  } as SciForgeConfig;
}

function uniqueBrowserHostSessionIds(html: string) {
  return [...new Set([...html.matchAll(/browser-host-session:([^/"<\s]+)/g)].map((match) => match[1]).sort())];
}

function uniqueAttrValues(html: string, attr: string) {
  return [...new Set([...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((match) => match[1]).sort())];
}

function countMatches(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].length;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
