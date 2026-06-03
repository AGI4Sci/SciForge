import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
const STABILITY_SCHEMA = 'sciforge.browser-pane-surface-rerender-stability.v1';
const ARTIFACT_DIR = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-surface-rerender-stability');
const MANIFEST_PATH = join(ARTIFACT_DIR, 'manifest.json');
const DESKTOP_NATIVE_LIVE_MANIFEST_PATH = resolve(process.cwd(), 'docs', 'test-artifacts', 'desktop-browser-native-live-acceptance', 'manifest.json');
const VERIFICATION_COMMAND = 'node --import tsx --test tests/smoke/smoke-browser-pane-surface-rerender-stability.test.ts';
const MAX_MANIFEST_BYTES = 48_000;

type SurfacePhaseTrigger =
  | 'initial'
  | 'topbar-address-draft'
  | 'tab-state'
  | 'refs-update'
  | 'diagnostic-expanded'
  | 'loading-state';

type SurfaceRenderPhase = {
  phase: string;
  trigger: SurfacePhaseTrigger;
  addressDraft: string;
  config: SciForgeConfig;
  hostSession: BrowserHostSessionState;
  hostBusy?: boolean;
};

type SurfacePhaseEvidence = ReturnType<typeof boundedSurfaceEvidence> & {
  trigger: SurfacePhaseTrigger;
  status: 'ready' | 'loading';
  stabilityKey?: string;
  stabilityKeyHash?: string;
  frameTransport?: string;
  refsRenderedCount: number;
};

type ConsumedNativeDesktopEvidence = {
  sourceRef: 'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json';
  schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1';
  status: 'passed';
  claimScope: 'desktop-native-embedded-browser-pane-live';
  browserHostSessionRef: string;
  liveSurfaceRef: string;
  nativeAttachRef: string;
  nativeSurfaceStateRef: string;
  lifecycleResultRef?: string;
  inputCompletenessResultRef?: string;
  verificationCommand?: string;
  rawPayloadRecorded: false;
};

type SurfaceRerenderStabilityManifest = {
  schemaVersion: typeof STABILITY_SCHEMA;
  status: 'passed' | 'blocked';
  claimScope: 'right-pane-native-surface-rerender-stability' | 'contract-diagnostic-only';
  passClaim: boolean;
  runId: string;
  observedAt: string;
  refsFirst: true;
  targetUrlDigest: {
    length: number;
    hash: string;
    rawUrlCaptured: false;
  };
  required: {
    owner: 'BrowserHostSession';
    liveSurfaceTransport: 'native-embedded';
    frameTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
    sameSessionId: true;
    sameLiveSurfaceRef: true;
    sameNativeSurfaceStabilityKey: true;
    inferredNativeRemountCount: 0;
    repeatedFocusRequestsAcrossSameSession: 0;
  };
  observed: {
    owner: 'BrowserHostSession';
    liveSurfaceTransport: string;
    frameTransport: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    sameSessionId: boolean;
    sameLiveSurfaceRef: boolean;
    sameNativeSurfaceStabilityKey: boolean;
    phaseCount: number;
    identityChangeCount: number;
    liveSurfaceRefChangeCount: number;
    stabilityKeyChangeCount: number;
    inferredNativeRemountCount: number;
    realNativeRemountCount: number | null;
    repeatedFocusRequestsAcrossSameSession: number;
    realNativeFocusLossCount: number | null;
    maxHostBrowserObjectsPerPhase: number;
    maxNativeSurfaceMountsPerPhase: number;
    blockedReason?: string;
  };
  consumedNativeDesktopEvidence?: ConsumedNativeDesktopEvidence;
  coverageGaps: string[];
  updateCounts: {
    topbarAddressDraftChanges: number;
    tabStateChanges: number;
    refsUpdates: number;
    diagnosticUpdates: number;
    loadingStateChanges: number;
    totalRerenderUpdates: number;
  };
  nativeAttach: {
    state: 'attached' | 'blocked' | 'handoff';
    observed: 'native-embedded' | 'missing-native-attach';
    proofRef?: string;
    canRetry: boolean;
    handoffRequired: boolean;
    blockedReason?: string;
  };
  contractEvidence: {
    source: 'react-static-render-contract';
    sourceGuardRefs: string[];
    phases: SurfacePhaseEvidence[];
  };
  refs: {
    liveSurfaceRef?: string;
    surfaceIdentityTraceRef: string;
    adapterFocusPolicyRef: string;
  };
  forbiddenEvidence: {
    secondViewer: false;
    legacyStreamSurface: false;
    frameStreamRef: false;
    canvasSurface: false;
    httpFrameImage: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    rawDom: false;
    rawLogs: false;
    base64: false;
  };
  verificationCommand: typeof VERIFICATION_COMMAND;
};

test('Browser pane rerenders preserve one native-embedded BrowserHostSession owner across loading refs diagnostics and topbar changes', () => {
  const busyProjection = rightPaneBrowserProjectionForUrl(TARGET_URL, {
    hostExternalBrowserAvailable: true,
    hostSurface: 'browser-host-session',
    hostBusy: true,
    hostSession: nativeSession(),
  });
  assert.equal(busyProjection.status, 'loading');
  assert.equal(busyProjection.hostSurface, 'browser-host-session');

  const evidence = nativeSurfaceContractEvidence();

  assert.equal(new Set(evidence.map((item) => item.liveSurfaceRef)).size, 1);
  assert.equal(new Set(evidence.map((item) => item.stabilityKey)).size, 1);
  assert.deepEqual([...new Set(evidence.flatMap((item) => item.sessionIds))], [SESSION_ID]);
  assert.ok(evidence.every((item) => item.secondTruthSource === false));
  assert.equal(countValueChanges(evidence.map((item) => item.stabilityKey)), 0);
  assert.equal(countValueChanges(evidence.map((item) => item.liveSurfaceRef)), 0);
  assert.equal(Math.max(...evidence.map((item) => item.nativeSurfaces)), 1);
  assertRefsOnlyReport(evidence);
  console.log(`[ok] Browser pane native rerender stability ${JSON.stringify(evidence)}`);
});

test('Browser pane rejects legacy stream/canvas fixtures while preserving native surface attrs for the same BrowserHostSession', () => {
  const legacyPhases = [
    {
      phase: 'legacy-frame-url',
      addressDraft: TARGET_URL,
      config: configFixture(),
      hostSession: hostStreamSession({ viewport: { width: 1280, height: 720 } }),
    },
    {
      phase: 'legacy-frame-stream-only',
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
      phase: 'legacy-loading',
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
  const legacyEvidence = legacyPhases.map((phase) => {
    const html = renderBrowserPanePhase(phase);
    assertLegacyBrowserSurfaceRefOnly(html, phase.phase);
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
      expectedStatus: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
    });
    assert.match(html, /data-browser-native-surface="true"/);
    assert.match(html, /browser-workbench-host-frame-native/);
    return boundedSurfaceEvidence(phase.phase, html);
  });

  const evidence = [...legacyEvidence, ...nativeEvidence];
  assert.deepEqual([...new Set(nativeEvidence.flatMap((item) => item.sessionIds))], [SESSION_ID]);
  assert.ok(legacyEvidence.every((item) => item.hostBrowserObjects === 0));
  assert.ok(legacyEvidence.every((item) => item.legacyLiveSurfaceCount === 0));
  assert.ok(evidence.every((item) => item.secondTruthSource === false));
  assertRefsOnlyReport(evidence);
  console.log(`[ok] Browser pane legacy-refusal/native rerender stability ${JSON.stringify(evidence)}`);
});

test('Browser pane adapter keeps native session start and attach guards session-scoped', () => {
  const adapterSource = readFileSync(new URL('../../src/ui/src/app/results/browserPaneHostAdapter.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /const initialHostSession = browserHostSessionForFocusedObjectReference\(focusedObjectReference, session\) as BrowserHostSessionState \| undefined;/);
  assert.match(adapterSource, /useState<BrowserHostSessionState \| undefined>\(\(\) => \{[\s\S]*browserHostSessionMatchesTarget\(initialHostSession, normalizedUrl\)[\s\S]*initialHostSession[\s\S]*cachedRightPaneBrowserHostSession\(hostSessionCacheKey, normalizedUrl\)/);
  assert.match(adapterSource, /setHostSession\(\(current\) => current && current\.id === focusedHostSession\.id && current\.updatedAt === focusedHostSession\.updatedAt \? current : focusedHostSession\)/);
  assert.match(adapterSource, /if \(browserHostSessionMatchesTarget\(hostSession, normalizedUrl\) && browserHostSessionHasUsableLiveSurface\(hostSession\)\) return;/);
  assert.match(adapterSource, /startBrowserHostSession\(operationConfig, \{ url: normalizedUrl, sessionId: pendingSessionId, \.\.\.viewportRef\.current \}\)/);
  assert.match(adapterSource, /function browserHostSessionHasUsableLiveSurface\(session: BrowserHostSessionState \| undefined\) \{\s*return browserHostSessionUsesNativeSurface\(session\)[\s\S]*&& session\?\.singleInteractiveTruth === true[\s\S]*&& Boolean\(session\.liveSurfaceRef\);[\s\S]*\}/);
  assert.match(adapterSource, /frameTransport: browserHostSessionHasUsableLiveSurface\(hostSession\) \? 'native-embedded' : undefined/);
  assert.match(adapterSource, /focus: nativeSurfaceSessionRef\.current !== sessionState\.id/);
  assert.match(adapterSource, /nativeSurfaceSessionRef\.current = sessionState\.id/);
  assert.match(adapterSource, /if \(hostError \|\| !needsBrowserHost \|\| !hostSession \|\| !browserHostSessionHasUsableLiveSurface\(hostSession\)/);
  assert.match(adapterSource, /void attachNativeBrowserSurface\(hostSession\)/);
  assert.match(adapterSource, /}, \[hostError, hostSession\?\.id, hostSession\?\.liveSurfaceRef, hostSession\?\.liveSurfaceTransport, hostSession\?\.singleInteractiveTruth, hostSession\?\.status, needsBrowserHost\]\);/);
  assert.doesNotMatch(adapterSource, /browserHostSessionFrameStreamUrl|hostFrameObjectUrl|pendingBinaryFrame|frameRenderer|canvas-binary|websocket-binary|webrtc-data-channel|window\.open\(|system-browser-window|\/api\/sciforge\/browser\/proxy|<iframe|<webview/);
});

test('Browser pane surface stability manifest stays typed blocked/handoff without real native attach proof', async () => {
  const evidence = nativeSurfaceContractEvidence();
  const consumed = await readConsumedNativeDesktopEvidence();
  const manifest = buildSurfaceRerenderStabilityManifest(
    evidence,
    consumed
      ? nativeAttachFromConsumedDesktopEvidence(consumed)
      : {
          state: 'handoff',
          observed: 'missing-native-attach',
          canRetry: true,
          handoffRequired: true,
          blockedReason: 'Real right-pane native attach/remount/focus dogfood proof is unavailable in this smoke; contract evidence is diagnostic only.',
        },
    consumed
      ? {
          consumedNativeDesktopEvidence: consumed,
          coverageGaps: [
            'missing-real-right-pane-rerender-remount-proof',
            'missing-real-right-pane-rerender-focus-retention-proof',
          ],
          blockedReason: 'Desktop native live acceptance supplied real attach/resize/minimize/restore refs, but surface rerender stability still lacks real rerender remount and focus retention proof.',
        }
      : {
          coverageGaps: [
            'missing-real-right-pane-native-evidence',
            'missing-real-right-pane-rerender-remount-proof',
            'missing-real-right-pane-rerender-focus-retention-proof',
          ],
        },
  );

  assertSurfaceRerenderStabilityManifest(manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.claimScope, 'contract-diagnostic-only');
  assert.equal(manifest.passClaim, false);
  assert.ok(manifest.coverageGaps.length > 0);

  const forgedPassWithoutAttach = {
    ...manifest,
    status: 'passed',
    claimScope: 'right-pane-native-surface-rerender-stability',
    passClaim: true,
  } satisfies SurfaceRerenderStabilityManifest;
  assert.throws(
    () => assertSurfaceRerenderStabilityManifest(forgedPassWithoutAttach),
    /attached|real native attach proof|coverage gaps/,
  );

  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
});

test('Browser pane surface stability consumes desktop native evidence without claiming missing real rerender focus proof', () => {
  const consumed = consumedNativeDesktopEvidenceFrom(desktopNativeLiveEvidenceFixture());
  assert.ok(consumed, 'fixture should expose pass-grade desktop native evidence');

  const manifest = buildSurfaceRerenderStabilityManifest(
    nativeSurfaceContractEvidence(),
    nativeAttachFromConsumedDesktopEvidence(consumed),
    {
      consumedNativeDesktopEvidence: consumed,
      coverageGaps: [
        'missing-real-right-pane-rerender-remount-proof',
        'missing-real-right-pane-rerender-focus-retention-proof',
      ],
    },
  );

  assertSurfaceRerenderStabilityManifest(manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.nativeAttach.state, 'attached');
  assert.equal(manifest.nativeAttach.observed, 'native-embedded');
  assert.match(manifest.nativeAttach.proofRef ?? '', /^browser-host-session:browser-host-real-native-live\//);
  assert.equal(manifest.consumedNativeDesktopEvidence?.rawPayloadRecorded, false);
  assert.deepEqual(manifest.coverageGaps, [
    'missing-real-right-pane-rerender-remount-proof',
    'missing-real-right-pane-rerender-focus-retention-proof',
  ]);
});

async function readConsumedNativeDesktopEvidence(): Promise<ConsumedNativeDesktopEvidence | undefined> {
  try {
    const text = await readFile(DESKTOP_NATIVE_LIVE_MANIFEST_PATH, 'utf8');
    return consumedNativeDesktopEvidenceFrom(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function consumedNativeDesktopEvidenceFrom(value: unknown): ConsumedNativeDesktopEvidence | undefined {
  const evidence = recordValue(value);
  const nativeAdapter = recordValue(evidence?.nativeAdapter);
  const browserHostSession = recordValue(evidence?.browserHostSession);
  const surface = recordValue(evidence?.surface);
  const interaction = recordValue(evidence?.interaction);
  const actionAck = recordValue(interaction?.actionAck);
  const heartbeat = recordValue(interaction?.stateHeartbeat);
  const benchmarkMetrics = recordValue(evidence?.benchmarkMetrics);
  const metricSections = recordValue(benchmarkMetrics?.metricSections);
  const lifecycle = recordValue(metricSections?.lifecycle);
  const inputCompleteness = recordValue(metricSections?.inputCompleteness);
  const sessionId = stringValue(browserHostSession?.id);
  if (
    stringValue(evidence?.schemaVersion) !== 'sciforge.desktop.browser-native-live-acceptance.v1'
    || stringValue(evidence?.status) !== 'passed'
    || evidence?.canClaimDesktopNativeLivePass !== true
    || stringValue(evidence?.claimScope) !== 'desktop-native-embedded-browser-pane-live'
    || stringValue(nativeAdapter?.owner) !== 'BrowserHostSession'
    || stringValue(nativeAdapter?.adapterRole) !== 'display-input-adapter'
    || stringValue(nativeAdapter?.liveSurfaceTransport) !== 'native-embedded'
    || nativeAdapter?.secondTruthSource !== false
    || stringValue(browserHostSession?.liveSurfaceTransport) !== 'native-embedded'
    || browserHostSession?.singleInteractiveTruth !== true
    || browserHostSession?.frameStreamRefPresent !== false
    || browserHostSession?.frameRefPresent !== false
    || browserHostSession?.frameUrlPresent !== false
    || surface?.ok !== true
    || stringValue(surface?.owner) !== 'BrowserHostSession'
    || stringValue(surface?.surface) !== 'electron-web-contents-view'
    || stringValue(surface?.liveSurfaceTransport) !== 'native-embedded'
    || surface?.embedded !== true
    || surface?.visible !== true
    || surface?.secondTruthSource !== false
    || interaction?.typedTokenObserved !== true
    || stringValue(interaction?.paintAckSource) !== 'native-adapter-action-state'
    || stringValue(actionAck?.status) !== 'ok'
    || actionAck?.dependsOnScreenshot !== false
    || actionAck?.dependsOnFrameStream !== false
    || stringValue(heartbeat?.source) !== 'native-adapter-state-endpoint'
    || heartbeat?.lightweightStateUpdated !== true
    || stringValue(lifecycle?.status) !== 'passed'
    || !isNonEmptyString(sessionId)
  ) {
    return undefined;
  }
  const sessionRef = `browser-host-session:${sessionId}`;
  return {
    sourceRef: 'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json',
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    claimScope: 'desktop-native-embedded-browser-pane-live',
    browserHostSessionRef: sessionRef,
    liveSurfaceRef: `${sessionRef}/live-surface`,
    nativeAttachRef: `${sessionRef}/desktop-native-live-attach-proof`,
    nativeSurfaceStateRef: `${sessionRef}/desktop-native-live-surface-state-proof`,
    lifecycleResultRef: stringValue(lifecycle?.resultRef),
    inputCompletenessResultRef: stringValue(inputCompleteness?.resultRef),
    verificationCommand: stringValue(evidence?.verificationCommand),
    rawPayloadRecorded: false,
  };
}

function nativeAttachFromConsumedDesktopEvidence(evidence: ConsumedNativeDesktopEvidence): SurfaceRerenderStabilityManifest['nativeAttach'] {
  return {
    state: 'attached',
    observed: 'native-embedded',
    proofRef: evidence.nativeAttachRef,
    canRetry: false,
    handoffRequired: false,
  };
}

function desktopNativeLiveEvidenceFixture() {
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    nativeAdapter: {
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      secondTruthSource: false,
    },
    browserHostSession: {
      id: 'browser-host-real-native-live',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      frameStreamRefPresent: false,
      frameRefPresent: false,
      frameUrlPresent: false,
    },
    surface: {
      ok: true,
      owner: 'BrowserHostSession',
      surface: 'electron-web-contents-view',
      liveSurfaceTransport: 'native-embedded',
      embedded: true,
      visible: true,
      secondTruthSource: false,
    },
    interaction: {
      typedTokenObserved: true,
      paintAckSource: 'native-adapter-action-state',
      actionAck: {
        status: 'ok',
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
      },
      stateHeartbeat: {
        source: 'native-adapter-state-endpoint',
        lightweightStateUpdated: true,
      },
    },
    benchmarkMetrics: {
      metricSections: {
        lifecycle: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:lifecycle:fixture',
        },
        inputCompleteness: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:inputCompleteness:fixture',
        },
      },
    },
    verificationCommand: 'npm run smoke:desktop-browser-native-live-acceptance --silent',
  };
}

function nativeSurfaceContractPhases(): SurfaceRenderPhase[] {
  return [
    {
      phase: 'initial',
      trigger: 'initial',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: nativeSession(),
    },
    {
      phase: 'topbar-address-draft-normalized',
      trigger: 'topbar-address-draft',
      addressDraft: TARGET_URL.replace(/^https:\/\//, ''),
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: nativeSession({ updatedAt: '2026-06-02T00:00:02.000Z' }),
    },
    {
      phase: 'tab-state-refresh',
      trigger: 'tab-state',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: nativeSession({
        updatedAt: '2026-06-02T00:00:03.000Z',
        title: 'Surface rerender target tab state',
        canGoBack: false,
        canGoForward: true,
      }),
    },
    {
      phase: 'refs-update',
      trigger: 'refs-update',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: `${WRITER_URL}/` }),
      hostSession: nativeSession({
        updatedAt: '2026-06-02T00:00:04.000Z',
        screenshotRef: `browser-host-session:${SESSION_ID}/screenshot-v2.png`,
        domSnapshotRef: `browser-host-session:${SESSION_ID}/dom-v2.html`,
        axSnapshotRef: `browser-host-session:${SESSION_ID}/ax-v2.json`,
        consoleLogRef: `browser-host-session:${SESSION_ID}/console-v2.jsonl`,
        networkLogRef: `browser-host-session:${SESSION_ID}/network-v2.jsonl`,
        searchResultRef: `browser-host-session:${SESSION_ID}/search-results-v2.json`,
      }),
    },
    {
      phase: 'diagnostic-expanded',
      trigger: 'diagnostic-expanded',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: nativeSession({
        updatedAt: '2026-06-02T00:00:05.000Z',
        diagnostics: [
          'bounded diagnostic expansion keeps the native surface key stable',
          'refs remain copyable without creating a second viewer',
        ],
      }),
    },
    {
      phase: 'loading-state',
      trigger: 'loading-state',
      addressDraft: TARGET_URL,
      config: configFixture({ workspaceWriterBaseUrl: WRITER_URL }),
      hostSession: nativeSession({
        status: 'loading',
        updatedAt: '2026-06-02T00:00:06.000Z',
        loadingProgress: {
          schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
          state: 'navigation-start',
          reason: 'navigation-requested',
          source: 'host-session',
          status: 'loading',
          updatedAt: '2026-06-02T00:00:06.000Z',
          refs: {
            session: `browser-host-session:${SESSION_ID}`,
            liveSurface: `browser-host-session:${SESSION_ID}/live-surface`,
          },
        },
      }),
      hostBusy: true,
    },
  ];
}

function nativeSurfaceContractEvidence(): SurfacePhaseEvidence[] {
  return nativeSurfaceContractPhases().map((phase) => {
    const html = renderBrowserPanePhase(phase);
    assertStableBrowserHostSurface(html, {
      phase: phase.phase,
      sessionId: SESSION_ID,
      expectedTransport: 'native-embedded',
      expectedFrameTransport: 'native-embedded',
      expectedStatus: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
    });
    const evidence = boundedSurfaceEvidence(phase.phase, html);
    const stabilityKey = uniqueAttrValues(html, 'data-browser-native-surface-stability-key')[0];
    return {
      ...evidence,
      trigger: phase.trigger,
      status: phase.hostSession.status === 'loading' ? 'loading' : 'ready',
      stabilityKey,
      stabilityKeyHash: stabilityKey ? hashText(stabilityKey) : undefined,
      frameTransport: uniqueAttrValues(html, 'data-browser-frame-transport')[0],
      refsRenderedCount: countMatches(html, /data-browser-ref=/g),
    };
  });
}

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
    expectedTransport: 'native-embedded';
    expectedFrameTransport: 'native-embedded';
    expectedStatus: 'ready' | 'loading';
  },
) {
  assert.equal(countMatches(html, /data-browser-object-type="host-browser"/g), 1, `${expected.phase}: one host-browser object`);
  assert.deepEqual(uniqueBrowserHostSessionIds(html), [expected.sessionId], `${expected.phase}: one BrowserHostSession id`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-live-surface-ref'), [`browser-host-session:${expected.sessionId}/live-surface`], `${expected.phase}: stable live surface ref`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-live-surface-transport'), [expected.expectedTransport], `${expected.phase}: stable transport`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-single-interactive-truth'), ['true'], `${expected.phase}: single truth attr`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-native-surface-stability-key'), [`${expected.sessionId}:browser-host-session:${expected.sessionId}/live-surface`], `${expected.phase}: stable native surface key`);
  assert.match(html, new RegExp(`data-status="${expected.expectedStatus}"`), `${expected.phase}: status`);
  assert.match(html, new RegExp(`data-browser-state="${expected.expectedStatus}"`), `${expected.phase}: browser state`);
  assert.doesNotMatch(html, /<iframe|<webview|<canvas|<img\b|data-browser-object-type="browser-embedded-frame"|data-browser-state-action="proxy-fallback"|data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-frame-source|host-stream|websocket-binary|webrtc-data-channel|\/api\/sciforge\/browser\/proxy|system-browser-window|data:image|base64/i, `${expected.phase}: no legacy live fallback or raw payload`);
  assert.equal(countMatches(html, /data-browser-native-surface="true"/g), 1, `${expected.phase}: one native mount`);
  assert.deepEqual(uniqueAttrValues(html, 'data-browser-frame-transport'), [expected.expectedFrameTransport], `${expected.phase}: native frame transport`);
}

function assertLegacyBrowserSurfaceRefOnly(html: string, phase: string) {
  assert.equal(countMatches(html, /data-browser-object-type="host-browser"/g), 0, `${phase}: no legacy host-browser object`);
  assert.equal(countMatches(html, /data-browser-native-surface="true"/g), 0, `${phase}: no native surface is forged`);
  assert.match(html, /data-browser-object-type="browser-state"/, `${phase}: legacy projection stays typed state`);
  assert.doesNotMatch(html, /data-browser-live-surface-ref|data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-frame-source|data-browser-frame-transport="(?:host-stream|websocket-binary|webrtc-data-channel)"|<canvas|<img\b|<iframe|<webview|data:image|base64/i, `${phase}: no legacy live fallback materialized`);
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
    legacyLiveSurfaceCount: countMatches(html, /data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-frame-source|data-browser-frame-transport="(?:host-stream|websocket-binary|webrtc-data-channel)"|<canvas\b|<img\b/g),
    secondTruthSource: /<iframe|<webview|<canvas\b|<img\b|data-browser-object-type="browser-embedded-frame"|data-browser-frame-stream-ref|data-browser-frame-renderer|data-browser-frame-source|data-browser-frame-transport="(?:host-stream|websocket-binary|webrtc-data-channel)"|\/api\/sciforge\/browser\/proxy|system-browser-window/i.test(html),
    rawPayloadsCaptured: /data:image|base64|<\s*(?:!doctype|html|body)\b/i.test(html),
  };
}

function buildSurfaceRerenderStabilityManifest(
  phases: SurfacePhaseEvidence[],
  nativeAttach: SurfaceRerenderStabilityManifest['nativeAttach'],
  options: {
    consumedNativeDesktopEvidence?: ConsumedNativeDesktopEvidence;
    coverageGaps?: string[];
    blockedReason?: string;
  } = {},
): SurfaceRerenderStabilityManifest {
  const sessionIds = uniqueFlat(phases.flatMap((item) => item.sessionIds));
  const liveSurfaceRefs = uniqueFlat(phases.map((item) => item.liveSurfaceRef).filter(isNonEmptyString));
  const stabilityKeys = uniqueFlat(phases.map((item) => item.stabilityKey).filter(isNonEmptyString));
  const transports = uniqueFlat(phases.map((item) => item.transport).filter(isNonEmptyString));
  const frameTransports = uniqueFlat(phases.map((item) => item.frameTransport).filter(isNonEmptyString));
  const sameSessionId = sessionIds.length === 1;
  const sameLiveSurfaceRef = liveSurfaceRefs.length === 1;
  const sameNativeSurfaceStabilityKey = stabilityKeys.length === 1;
  const liveSurfaceRefChangeCount = countValueChanges(phases.map((item) => item.liveSurfaceRef));
  const stabilityKeyChangeCount = countValueChanges(phases.map((item) => item.stabilityKey));
  const inferredNativeRemountCount = stabilityKeyChangeCount;
  const repeatedFocusRequestsAcrossSameSession = sameSessionId ? 0 : Math.max(0, sessionIds.length - 1);
  const secondTruthSource = phases.some((item) => item.secondTruthSource);
  const hasForbiddenNativeContractEvidence = phases.some((item) => (
    item.hostBrowserObjects !== 1
    || item.nativeSurfaces !== 1
    || item.legacyLiveSurfaceCount !== 0
    || item.rawPayloadsCaptured
    || item.imageSurfaces !== 0
    || item.canvasSurfaces !== 0
  ));
  const contractStable = sameSessionId
    && sameLiveSurfaceRef
    && sameNativeSurfaceStabilityKey
    && liveSurfaceRefChangeCount === 0
    && inferredNativeRemountCount === 0
    && repeatedFocusRequestsAcrossSameSession === 0
    && !secondTruthSource
    && !hasForbiddenNativeContractEvidence
    && transports.length === 1
    && transports[0] === 'native-embedded'
    && frameTransports.length === 1
    && frameTransports[0] === 'native-embedded';
  const coverageGaps = options.coverageGaps ?? [];
  const canClaimPass = contractStable
    && nativeAttach.state === 'attached'
    && nativeAttach.observed === 'native-embedded'
    && Boolean(nativeAttach.proofRef)
    && !nativeAttach.handoffRequired
    && coverageGaps.length === 0;
  const blockedReason = canClaimPass
    ? undefined
    : options.blockedReason ?? nativeAttach.blockedReason ?? blockedReasonForSurfaceStability({
      contractStable,
      sameSessionId,
      sameLiveSurfaceRef,
      sameNativeSurfaceStabilityKey,
      liveSurfaceRefChangeCount,
      inferredNativeRemountCount,
      repeatedFocusRequestsAcrossSameSession,
      secondTruthSource,
      transports,
      frameTransports,
      hasForbiddenNativeContractEvidence,
      nativeAttach,
    });

  return {
    schemaVersion: STABILITY_SCHEMA,
    status: canClaimPass ? 'passed' : 'blocked',
    claimScope: canClaimPass ? 'right-pane-native-surface-rerender-stability' : 'contract-diagnostic-only',
    passClaim: canClaimPass,
    runId: `browser-pane-surface-rerender-stability-${hashText(`${Date.now()}:${sessionIds.join(':')}:${nativeAttach.observed}`)}`,
    observedAt: new Date().toISOString(),
    refsFirst: true,
    targetUrlDigest: {
      length: TARGET_URL.length,
      hash: hashText(TARGET_URL),
      rawUrlCaptured: false,
    },
    required: {
      owner: 'BrowserHostSession',
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      sameSessionId: true,
      sameLiveSurfaceRef: true,
      sameNativeSurfaceStabilityKey: true,
      inferredNativeRemountCount: 0,
      repeatedFocusRequestsAcrossSameSession: 0,
    },
    observed: {
      owner: 'BrowserHostSession',
      liveSurfaceTransport: transports[0] ?? 'missing-native-attach',
      frameTransport: frameTransports[0] ?? 'missing-native-attach',
      singleInteractiveTruth: phases.every((item) => item.transport === 'native-embedded'),
      secondTruthSource,
      sameSessionId,
      sameLiveSurfaceRef,
      sameNativeSurfaceStabilityKey,
      phaseCount: phases.length,
      identityChangeCount: Math.max(sessionIds.length - 1, 0) + liveSurfaceRefChangeCount + stabilityKeyChangeCount,
      liveSurfaceRefChangeCount,
      stabilityKeyChangeCount,
      inferredNativeRemountCount,
      realNativeRemountCount: canClaimPass ? 0 : null,
      repeatedFocusRequestsAcrossSameSession,
      realNativeFocusLossCount: canClaimPass ? 0 : null,
      maxHostBrowserObjectsPerPhase: Math.max(...phases.map((item) => item.hostBrowserObjects)),
      maxNativeSurfaceMountsPerPhase: Math.max(...phases.map((item) => item.nativeSurfaces)),
      blockedReason,
    },
    consumedNativeDesktopEvidence: options.consumedNativeDesktopEvidence,
    coverageGaps,
    updateCounts: {
      topbarAddressDraftChanges: countTriggers(phases, 'topbar-address-draft'),
      tabStateChanges: countTriggers(phases, 'tab-state'),
      refsUpdates: countTriggers(phases, 'refs-update'),
      diagnosticUpdates: countTriggers(phases, 'diagnostic-expanded'),
      loadingStateChanges: countTriggers(phases, 'loading-state'),
      totalRerenderUpdates: phases.filter((item) => item.trigger !== 'initial').length,
    },
    nativeAttach: {
      ...nativeAttach,
      blockedReason,
    },
    contractEvidence: {
      source: 'react-static-render-contract',
      sourceGuardRefs: [
        'source:packages/presentation/components/browser-workbench/render.tsx#browserWorkbenchNativeSurfaceStabilityKey',
        'source:src/ui/src/app/results/browserPaneHostAdapter.tsx#attachNativeBrowserSurface-focus-session-scoped',
      ],
      phases,
    },
    refs: {
      liveSurfaceRef: canClaimPass ? liveSurfaceRefs[0] : undefined,
      surfaceIdentityTraceRef: `browser-host-session:${SESSION_ID}/surface-rerender-stability-trace.json`,
      adapterFocusPolicyRef: `browser-host-session:${SESSION_ID}/native-attach-focus-policy.json`,
    },
    forbiddenEvidence: {
      secondViewer: false,
      legacyStreamSurface: false,
      frameStreamRef: false,
      canvasSurface: false,
      httpFrameImage: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      rawDom: false,
      rawLogs: false,
      base64: false,
    },
    verificationCommand: VERIFICATION_COMMAND,
  };
}

function assertSurfaceRerenderStabilityManifest(manifest: SurfaceRerenderStabilityManifest) {
  assert.equal(manifest.schemaVersion, STABILITY_SCHEMA);
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.required.owner, 'BrowserHostSession');
  assert.equal(manifest.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(manifest.required.frameTransport, 'native-embedded');
  assert.equal(manifest.required.singleInteractiveTruth, true);
  assert.equal(manifest.required.secondTruthSource, false);
  assert.equal(manifest.required.inferredNativeRemountCount, 0);
  assert.equal(manifest.required.repeatedFocusRequestsAcrossSameSession, 0);
  assert.equal(manifest.targetUrlDigest.rawUrlCaptured, false);
  assert.equal(manifest.verificationCommand, VERIFICATION_COMMAND);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), Array(Object.values(manifest.forbiddenEvidence).length).fill(false));
  assert.equal(manifest.updateCounts.topbarAddressDraftChanges, 1);
  assert.equal(manifest.updateCounts.tabStateChanges, 1);
  assert.equal(manifest.updateCounts.refsUpdates, 1);
  assert.equal(manifest.updateCounts.diagnosticUpdates, 1);
  assert.equal(manifest.updateCounts.loadingStateChanges, 1);
  assert.equal(manifest.updateCounts.totalRerenderUpdates, 5);
  assert.equal(manifest.observed.sameSessionId, true);
  assert.equal(manifest.observed.sameLiveSurfaceRef, true);
  assert.equal(manifest.observed.sameNativeSurfaceStabilityKey, true);
  assert.equal(manifest.observed.identityChangeCount, 0);
  assert.equal(manifest.observed.liveSurfaceRefChangeCount, 0);
  assert.equal(manifest.observed.stabilityKeyChangeCount, 0);
  assert.equal(manifest.observed.inferredNativeRemountCount, 0);
  assert.equal(manifest.observed.repeatedFocusRequestsAcrossSameSession, 0);
  assert.equal(manifest.observed.maxHostBrowserObjectsPerPhase, 1);
  assert.equal(manifest.observed.maxNativeSurfaceMountsPerPhase, 1);
  assert.equal(manifest.contractEvidence.phases.length, 6);
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.transport === 'native-embedded'));
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.frameTransport === 'native-embedded'));
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.hostBrowserObjects === 1));
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.nativeSurfaces === 1));
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.legacyLiveSurfaceCount === 0));
  assert.ok(manifest.contractEvidence.phases.every((phase) => phase.secondTruthSource === false));
  if (manifest.status === 'passed') {
    assert.equal(manifest.claimScope, 'right-pane-native-surface-rerender-stability');
    assert.equal(manifest.passClaim, true);
    assert.deepEqual(manifest.coverageGaps, [], 'passed manifest cannot carry coverage gaps');
    assert.equal(manifest.nativeAttach.state, 'attached');
    assert.equal(manifest.nativeAttach.observed, 'native-embedded');
    assert.ok(manifest.nativeAttach.proofRef, 'passed manifest requires real native attach proof');
    assert.equal(manifest.nativeAttach.handoffRequired, false);
    assert.equal(manifest.observed.realNativeRemountCount, 0);
    assert.equal(manifest.observed.realNativeFocusLossCount, 0);
    assert.match(manifest.refs.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  } else {
    assert.equal(manifest.claimScope, 'contract-diagnostic-only');
    assert.equal(manifest.passClaim, false);
    if (manifest.nativeAttach.state === 'attached') {
      assert.equal(manifest.nativeAttach.observed, 'native-embedded');
      assert.ok(manifest.nativeAttach.proofRef, 'attached blocked manifest still requires bounded proof ref');
    } else {
      assert.equal(manifest.nativeAttach.observed, 'missing-native-attach');
      assert.equal(manifest.nativeAttach.handoffRequired, true);
    }
    assert.ok(manifest.coverageGaps.length > 0);
    assert.ok(manifest.observed.blockedReason);
    assert.equal(manifest.observed.realNativeRemountCount, null);
    assert.equal(manifest.observed.realNativeFocusLossCount, null);
    assert.equal(manifest.refs.liveSurfaceRef, undefined);
  }
  assertBoundedSurfaceRerenderManifest(manifest);
}

function blockedReasonForSurfaceStability(input: {
  contractStable: boolean;
  sameSessionId: boolean;
  sameLiveSurfaceRef: boolean;
  sameNativeSurfaceStabilityKey: boolean;
  liveSurfaceRefChangeCount: number;
  inferredNativeRemountCount: number;
  repeatedFocusRequestsAcrossSameSession: number;
  secondTruthSource: boolean;
  transports: string[];
  frameTransports: string[];
  hasForbiddenNativeContractEvidence: boolean;
  nativeAttach: SurfaceRerenderStabilityManifest['nativeAttach'];
}) {
  if (input.nativeAttach.state !== 'attached' || input.nativeAttach.observed !== 'native-embedded' || !input.nativeAttach.proofRef) {
    return 'Surface stability pass requires real native attach proof; current evidence is typed handoff/blocked diagnostic only.';
  }
  if (!input.sameSessionId) return 'Surface stability pass requires one BrowserHostSession id across rerender updates.';
  if (!input.sameLiveSurfaceRef || input.liveSurfaceRefChangeCount > 0) return 'Surface stability pass requires one liveSurfaceRef across rerender updates.';
  if (!input.sameNativeSurfaceStabilityKey || input.inferredNativeRemountCount > 0) return 'Surface stability pass requires a stable native surface key and zero inferred remounts.';
  if (input.repeatedFocusRequestsAcrossSameSession > 0) return 'Surface stability pass requires zero repeated focus requests for the same session.';
  if (input.secondTruthSource || input.hasForbiddenNativeContractEvidence) return 'Surface stability pass forbids second viewers, legacy streams, raw payloads, and fallback surfaces.';
  if (input.transports.length !== 1 || input.transports[0] !== 'native-embedded') return 'Surface stability pass requires native-embedded live surface transport.';
  if (input.frameTransports.length !== 1 || input.frameTransports[0] !== 'native-embedded') return 'Surface stability pass requires native-embedded frame transport.';
  if (!input.contractStable) return 'Surface stability contract evidence is incomplete.';
  return 'Surface stability pass requires bounded native surface evidence.';
}

function assertBoundedSurfaceRerenderManifest(manifest: SurfaceRerenderStabilityManifest) {
  const serialized = JSON.stringify(manifest);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_MANIFEST_BYTES, 'manifest must stay bounded');
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<iframe|<webview|<canvas|<img|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assert.doesNotMatch(serialized, /host-stream|websocket-binary|webrtc-data-channel|\/api\/sciforge\/browser\/proxy|system-browser-window/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(TARGET_URL)));
  assert.doesNotMatch(serialized, /candidate-secret|api[_-]?key|sk-[a-z0-9-]+/i);
}

function countTriggers(phases: SurfacePhaseEvidence[], trigger: SurfacePhaseTrigger) {
  return phases.filter((item) => item.trigger === trigger).length;
}

function countValueChanges(values: Array<string | undefined>) {
  let count = 0;
  let previous: string | undefined;
  for (const value of values) {
    if (!value) continue;
    if (previous && previous !== value) count += 1;
    previous = value;
  }
  return count;
}

function uniqueFlat(values: string[]) {
  return [...new Set(values)].sort();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertRefsOnlyReport(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image|base64|<\s*(?:!doctype|html|body|iframe|webview|canvas|img)\b|host-stream|websocket-binary|webrtc-data-channel|\/api\/sciforge\/browser\/proxy|system-browser-window/i);
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
