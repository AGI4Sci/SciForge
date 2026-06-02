import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const BOTTLENECK_SCHEMA = 'sciforge.browser-pane-bottleneck-audit.v1';
const DOGFOOD_SCHEMA = 'sciforge.browser-pane-dogfood.v1';
const REAL_EXTERNAL_DOGFOOD_SCHEMA = 'sciforge.browser-pane-real-external-dogfood.v1';
const LONG_SESSION_SCHEMA = 'sciforge.browser-pane-product-long-session.v1';
const WEBRTC_BRIDGE_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-bridge-smoke.v1';
const NATIVE_PLATFORM_BENCHMARK_SCHEMA = 'sciforge.browser-native-adapter-platform-benchmark-results.v1';
const INPUT_FIDELITY_SCHEMA = 'sciforge.browser.input-fidelity-product-acceptance.v1';
const MOUSE_GESTURE_SCHEMA = 'sciforge.browser-host-session.mouse-gesture-completeness-smoke.v1';
const BOTTLENECK_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-pane-bottleneck-audit/manifest.json');
const DOGFOOD_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-pane-dogfood/manifest.json');
const REAL_EXTERNAL_DOGFOOD_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-pane-real-external-dogfood/manifest.json');
const LONG_SESSION_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-pane-product-long-session/manifest.json');
const WEBRTC_BRIDGE_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-host-webrtc-transport-bridge/manifest.json');
const NATIVE_PLATFORM_BENCHMARK_RESULTS = resolve(process.cwd(), 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-results.json');
const INPUT_FIDELITY_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-input-fidelity-product-acceptance/manifest.json');
const MOUSE_GESTURE_MANIFEST = resolve(process.cwd(), 'docs/test-artifacts/browser-mouse-gesture-completeness/manifest.json');
const MAX_MANIFEST_BYTES = 96_000;
const REAL_NATIVE_PLATFORM_METRIC_SECTIONS = [
  'latency',
  'cpu',
  'memory',
  'inputCompleteness',
  'lifecycle',
  'reconnect',
] as const;

type JsonRecord = Record<string, unknown>;

test('Browser bounded manifests cross-check bounded evidence while native-only live acceptance is gated', async () => {
  const bottleneck = await readManifest(BOTTLENECK_MANIFEST);
  const dogfood = await readManifest(DOGFOOD_MANIFEST);
  const realExternalDogfood = await readRealExternalDogfoodManifest();
  const longSession = await readManifest(LONG_SESSION_MANIFEST);
  const webrtcBridge = await readManifest(WEBRTC_BRIDGE_MANIFEST);
  const nativeBenchmark = await readManifest(NATIVE_PLATFORM_BENCHMARK_RESULTS);
  const inputFidelity = await readManifest(INPUT_FIDELITY_MANIFEST);
  const mouseGesture = await readManifest(MOUSE_GESTURE_MANIFEST);

  const validation = validateBoundedBrowserEvidence({ bottleneck, dogfood, realExternalDogfood, longSession, webrtcBridge, nativeBenchmark, inputFidelity, mouseGesture });

  assert.deepEqual(validation.blockers, []);
  assert.equal(validation.canUseAsBoundedDiagnosticEvidence, true);
  if (!validation.canUseAsBoundedProductEvidence) {
    assert.ok(
      validation.liveAcceptanceBlockers.some((blocker) => blocker.endsWith('live-pass-requires-native-embedded')),
      `non-native Browser pane live claims must be refused: ${validation.liveAcceptanceBlockers.join(', ')}`,
    );
  }
});

test('Browser bounded evidence cross-check rejects forged pass-shaped manifests', async () => {
  const bottleneck = await readManifest(BOTTLENECK_MANIFEST);
  const dogfood = await readManifest(DOGFOOD_MANIFEST);
  const realExternalDogfood = await readRealExternalDogfoodManifest();
  const longSession = await readManifest(LONG_SESSION_MANIFEST);
  const webrtcBridge = await readManifest(WEBRTC_BRIDGE_MANIFEST);
  const nativeBenchmark = await readManifest(NATIVE_PLATFORM_BENCHMARK_RESULTS);
  const inputFidelity = await readManifest(INPUT_FIDELITY_MANIFEST);
  const forgedBottleneck = structuredClone(bottleneck);
  const forgedDogfood = structuredClone(dogfood);
  const forgedRealExternalDogfood = structuredClone(realExternalDogfood);
  const forgedLongSession = structuredClone(longSession);
  const forgedWebRtcBridge = structuredClone(webrtcBridge);
  const forgedNativeBenchmark = structuredClone(nativeBenchmark);
  const forgedInputFidelity = structuredClone(inputFidelity);
  const forgedMouseGesture = structuredClone(await readManifest(MOUSE_GESTURE_MANIFEST));

  setPath(forgedBottleneck, ['status'], 'passed');
  setPath(forgedBottleneck, ['browserHostSession', 'owner'], 'BrowserWorkbench');
  setPath(forgedBottleneck, ['targetEvidence', 'realExternalSiteClaim'], true);
  setPath(forgedBottleneck, ['targetEvidence', 'hardcodedSitePassClaim'], true);
  setPath(forgedBottleneck, ['targetEvidence', 'rawUrlCaptured'], true);
  setPath(forgedBottleneck, ['targetOriginRef'], 'http://example.com/search?q=raw');
  setPath(forgedBottleneck, ['browserHostSession', 'transport'], 'host-stream');
  setPath(forgedBottleneck, ['browserHostSession', 'liveSurfaceTransport'], 'host-stream');
  setPath(forgedBottleneck, ['browserHostSession', 'secondTruthSource'], true);
  setPath(forgedBottleneck, ['browserHostSession', 'liveSurfaceRef'], 'browser-host-session:other/live-surface');
  setPath(forgedBottleneck, ['interactionCoverage', 'searchboxCaret', 'selectedTextHash'], undefined);
  setPath(forgedBottleneck, ['interactionCoverage', 'drag', 'browserHostRouteActions'], ['drag']);
  setPath(forgedBottleneck, ['interactionCoverage', 'classes'], ['continuous-input']);
  setPath(forgedBottleneck, ['interactionCoverage', 'surfaceContinuity', 'sameLiveSurfaceAcrossReload'], false);
  setPath(forgedBottleneck, ['interactionCoverage', 'surfaceContinuity', 'checkpointLabels'], ['before-resize']);
  setPath(forgedBottleneck, ['timingSummary'], {
    categories: [{ category: 'input-routing', sampleCount: 1, p95Ms: 100, maxMs: 10 }],
  });
  setPath(forgedLongSession, ['interactionCoverage', 'classes'], ['continuous-input']);
  setPath(forgedDogfood, ['status'], 'passed');
  setPath(forgedDogfood, ['targetEvidence', 'realExternalSiteClaim'], true);
  setPath(forgedDogfood, ['targetEvidence', 'hardcodedSitePassClaim'], true);
  setPath(forgedDogfood, ['targetEvidence', 'rawUrlCaptured'], true);
  setPath(forgedDogfood, ['targetOriginRef'], 'https://fixed.example.invalid/path?q=raw');
  setPath(forgedDogfood, ['forbiddenFallbacks', 'httpFrameLiveView'], true);
  setPath(forgedDogfood, ['browserHostSession', 'transport'], 'host-stream');
  setPath(forgedDogfood, ['browserHostSession', 'liveSurfaceTransport'], 'host-stream');
  setPath(forgedDogfood, ['browserHostSession', 'singleInteractiveTruth'], false);
  setPath(forgedDogfood, ['browserHostSession', 'secondTruthSource'], true);
  setPath(forgedDogfood, ['browserHostSession', 'liveSurfaceRef'], 'browser-host-session:other/live-surface');
  setPath(forgedRealExternalDogfood, ['status'], 'passed');
  setPath(forgedRealExternalDogfood, ['targetEvidence', 'mode'], 'real-external-url-config');
  setPath(forgedRealExternalDogfood, ['targetEvidence', 'realExternalSiteClaim'], true);
  setPath(forgedRealExternalDogfood, ['targetEvidence', 'requestedUrlHash'], 'https://raw.example.invalid/search?q=leak');
  setPath(forgedRealExternalDogfood, ['targetEvidence', 'finalUrlHash'], 'not-a-hash');
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'id'], 'real-external-forged');
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'transport'], 'host-stream');
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'liveSurfaceTransport'], 'host-stream');
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'singleInteractiveTruth'], true);
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'secondTruthSource'], true);
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'liveSurfaceRef'], 'browser-host-session:other/live-surface');
  setPath(forgedRealExternalDogfood, ['browserHostSession', 'refs', 'frameRef'], 'browser-host-session:real-external-forged/frame.png');
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'openUrl'], true);
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'liveFrameVisible'], true);
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'scrollAttempted'], true);
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'reloadAttempted'], true);
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'sameSessionAfterReload'], false);
  setPath(forgedRealExternalDogfood, ['interactionCoverage', 'sameLiveSurfaceAfterReload'], false);
  setPath(forgedRealExternalDogfood, ['publicSearchBoxEvidence'], {
    configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
    claimScope: 'input-route-and-url-digest-only',
    clickRatioConfigured: true,
    hiddenKeyboardFocusedAfterClick: false,
    cursorAtClick: 'text',
    typeActionTextLengths: [18],
    typeActionTextHashes: ['raw typed public query'],
    backspaceCount: 1,
    pressKeys: ['Enter'],
    shellComposerCapturedCharacters: 4,
    submitAttempted: true,
    expectedAfterSubmitUrlLength: 200,
    expectedAfterSubmitUrlHash: '0123456789abcdef',
    finalUrlLength: 201,
    finalUrlHash: 'fedcba9876543210',
    expectedFinalUrlMatched: false,
    sameSessionAfterSubmit: false,
    sameLiveSurfaceAfterSubmit: false,
    rawTextCaptured: true,
    rawUrlCaptured: true,
    rawDomCaptured: true,
  });
  setPath(forgedRealExternalDogfood, ['fallbackCounts', 'iframe'], 1);
  setPath(forgedRealExternalDogfood, ['blockedReason'], 'kept blocked reason on a pass');
  setPath(forgedLongSession, ['status'], 'passed');
  setPath(forgedLongSession, ['interactionCoverage', 'browserHostActions'], ['navigate']);
  setPath(forgedLongSession, ['browserHostSession', 'beforeWorkspaceRestart', 'transport'], 'host-stream');
  setPath(forgedLongSession, ['browserHostSession', 'beforeWorkspaceRestart', 'liveSurfaceTransport'], 'host-stream');
  setPath(forgedLongSession, ['browserHostSession', 'beforeWorkspaceRestart', 'secondTruthSource'], true);
  setPath(forgedLongSession, ['continuity', 'tabSwitchSameSession'], false);
  setPath(forgedLongSession, ['failureRetry', 'workspaceWriterRestart', 'attempted'], false);
  setPath(forgedLongSession, ['failureRetry', 'addressDetailsRecovery', 'outcomes'], []);
  setPath(forgedLongSession, ['boundedMetrics', 'memoryishCounts', 'objectUrlCreateCountBeforeRestart'], 5);
  setPath(forgedLongSession, ['boundedMetrics', 'memoryishCounts', 'objectUrlRevokeCountBeforeRestart'], 1);
  setPath(forgedLongSession, ['boundedMetrics', 'memoryishCounts', 'objectUrlLiveEstimateBeforeRestart'], 0);
  setPath(forgedLongSession, ['boundedMetrics', 'memoryishCounts', 'objectUrlRevokeDeficitBeforeRestart'], 0);
  setPath(forgedLongSession, ['boundedMetrics', 'loadingProgressLifecycle', 'completionEvidence', 'uiLoadingToReady'], false);
  setPath(forgedLongSession, ['boundedMetrics', 'loadingProgressLifecycle', 'completionEvidence', 'lifecycleNavigationStartToNetworkQuiet'], false);
  setPath(forgedLongSession, ['boundedMetrics', 'loadingProgressLifecycle', 'completionEvidence', 'networkQuietObserved'], false);
  setPath(forgedLongSession, ['boundedMetrics', 'loadingProgressLifecycle', 'observedLifecycleStates'], [{ value: 'navigation-start', count: 1 }]);
  setPath(forgedLongSession, ['boundedMetrics', 'loadingProgressLifecycle', 'urlEvidence', 'requested', 'hashes'], []);
  setPath(forgedLongSession, ['runner', 'requestedMinutes'], 30);
  setPath(forgedLongSession, ['runner', 'durationMs'], 1_200);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'fullyPassedClaim'], true);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'realUiWebRtcPassClaim'], true);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'loopbackEvidenceOnly'], true);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'httpFrameRouteClaim'], true);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'secondViewer'], true);
  setPath(forgedWebRtcBridge, ['bridge', 'rightPaneHandoff', 'inlineFrameBytes'], true);
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'status'], 'passed');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'benchmarkClaim'], true);
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'source'], 'webrtc-loopback-smoke');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'realUiRun'], true);
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'productSurface'], 'loopback-browser');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'transportEvidenceKind'], 'loopback-data-channel');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'refs', 'rightPaneSurfaceRef'], 'browser-host-session:other-webrtc/live-surface');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'refs', 'metricsSamplesRef'], 'browser-host-session:webrtc-bridge-positive/webrtc-loopback/samples');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'refs', 'httpFrameRef'], '/api/sciforge/browser-host/sessions/webrtc-bridge-positive/frame');
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'passRefusalPolicy', 'loopbackSmokeDoesNotPass'], false);
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'passRefusalPolicy', 'httpFrameRouteDoesNotPass'], false);
  setPath(forgedWebRtcBridge, ['realP95DropBackpressureLongRunHandoff', 'deterministicContractMetrics', 'sampleCount'], 4);
  setPath(forgedNativeBenchmark, ['benchmarkClaim'], true);
  setPath(forgedNativeBenchmark, ['candidates', 0, 'status'], 'passed');
  setPath(forgedNativeBenchmark, ['candidates', 0, 'benchmarkClaim'], true);
  setPath(forgedNativeBenchmark, ['candidates', 0, 'realAdapterResult'], false);
  setPath(forgedNativeBenchmark, ['externalAdapterCommandContract', 'realProofRefusalPolicy', 'partialPlatformResultsDoNotPass'], false);
  setPath(forgedNativeBenchmark, ['externalAdapterCommandContract', 'perCandidateCommandEnv', 'webview2', 'supportedOnCurrentPlatform'], true);
  setPath(forgedInputFidelity, ['status'], 'passed');
  setPath(forgedInputFidelity, ['source'], 'real-product-os-ui-run');
  setPath(forgedInputFidelity, ['canClaimProductInputFidelityPass'], true);
  setPath(forgedInputFidelity, ['osUiRun', 'auditProofs'], []);
  setPath(forgedInputFidelity, ['capabilities', 'ime', 'status'], 'passed');
  setPath(forgedInputFidelity, ['capabilities', 'clipboard', 'status'], 'passed');
  setPath(forgedInputFidelity, ['capabilities', 'selectionRange', 'status'], 'passed');
  setPath(forgedInputFidelity, ['capabilities', 'selectionRange', 'details', 'ranges'], [{ selectionText: 'raw text' }]);
  setPath(forgedInputFidelity, ['capabilities', 'cursorCaret', 'productActionRefs'], ['browser-host-session:other-input-run/cursor-caret-actions']);
  setPath(forgedInputFidelity, ['osUiRun', 'composerAudit', 'composerAuditRef'], 'browser-host-session:other-input-run/composer-audit');
  setPath(forgedMouseGesture, ['contextMenuPolicy'], 'system-popup');
  setPath(forgedMouseGesture, ['newTabSemantics', 'status'], 'passed');
  setPath(forgedMouseGesture, ['newTabSemantics', 'middleClick', 'claim'], 'new-tab-opened');
  setPath(forgedMouseGesture, ['productAcceptance', 'status'], 'passed');
  setPath(forgedMouseGesture, ['productAcceptance', 'source'], 'real-product-os-ui-run');
  setPath(forgedMouseGesture, ['productAcceptance', 'canClaimRealMouseFidelityPass'], true);
  setPath(forgedMouseGesture, ['productAcceptance', 'osUiRun', 'auditProofs'], []);
  setPath(forgedMouseGesture, ['productAcceptance', 'osUiRun', 'composerAudit', 'composerAuditRef'], 'browser-host-session:other-mouse-run/composer-audit');
  setPath(forgedMouseGesture, ['systemInputUsed'], true);
  setPath(forgedMouseGesture, ['secondTruthSource'], true);

  const validation = validateBoundedBrowserEvidence({
    bottleneck: forgedBottleneck,
    dogfood: forgedDogfood,
    realExternalDogfood: forgedRealExternalDogfood,
    longSession: forgedLongSession,
    webrtcBridge: forgedWebRtcBridge,
    nativeBenchmark: forgedNativeBenchmark,
    inputFidelity: forgedInputFidelity,
    mouseGesture: forgedMouseGesture,
  });

  assert.equal(validation.canUseAsBoundedProductEvidence, false);
  const allBlockers = validation.allBlockers;
  assert.ok(allBlockers.includes('bottleneck-live-pass-requires-native-embedded'));
  assert.ok(allBlockers.includes('bottleneck-second-truth-source-forbidden'));
  assert.ok(allBlockers.includes('dogfood-live-pass-requires-native-embedded'));
  assert.ok(allBlockers.includes('dogfood-second-truth-source-forbidden'));
  assert.ok(allBlockers.includes('real-external-dogfood-live-pass-requires-native-embedded'));
  assert.ok(allBlockers.includes('real-external-dogfood-second-truth-source-forbidden'));
  assert.ok(allBlockers.includes('long-session-live-pass-requires-native-embedded'));
  assert.ok(allBlockers.includes('long-session-second-truth-source-forbidden'));
  assert.ok(allBlockers.includes('bottleneck-owner-must-be-host'));
  assert.ok(allBlockers.includes('bottleneck-target-must-not-claim-real-external-site'));
  assert.ok(allBlockers.includes('bottleneck-target-must-not-claim-hardcoded-site-pass'));
  assert.ok(allBlockers.includes('bottleneck-target-raw-url-forbidden'));
  assert.ok(allBlockers.includes('bottleneck-target-origin-ref-must-be-bounded'));
  assert.ok(allBlockers.includes('dogfood-target-must-not-claim-real-external-site'));
  assert.ok(allBlockers.includes('dogfood-target-must-not-claim-hardcoded-site-pass'));
  assert.ok(allBlockers.includes('dogfood-target-raw-url-forbidden'));
  assert.ok(allBlockers.includes('dogfood-target-origin-ref-must-be-bounded'));
  assert.ok(allBlockers.includes('dogfood-single-interactive-truth-required'));
  assert.ok(allBlockers.includes('dogfood-live-surface-ref-must-match-session-id'));
  assert.ok(allBlockers.includes('dogfood-forbidden-fallbacks-must-be-false'));
  assert.ok(allBlockers.includes('real-external-dogfood-url-evidence-must-be-bounded-hashes'));
  assert.ok(allBlockers.includes('real-external-dogfood-live-surface-ref-must-match-session-id'));
  assert.ok(allBlockers.includes('real-external-dogfood-reload-continuity-required'));
  assert.ok(allBlockers.includes('real-external-dogfood-fallback-counts-must-be-zero'));
  assert.ok(allBlockers.includes('real-external-dogfood-pass-must-not-keep-blocked-reason'));
  assert.ok(allBlockers.includes('real-external-dogfood-raw-url-forbidden'));
  assert.ok(allBlockers.includes('real-external-dogfood-public-search-raw-payloads-forbidden'));
  assert.ok(allBlockers.includes('real-external-dogfood-public-search-text-hashes-required'));
  assert.ok(allBlockers.includes('real-external-dogfood-public-search-composer-must-not-capture'));
  assert.ok(allBlockers.includes('real-external-dogfood-public-search-url-digest-must-match-claim'));
  assert.ok(allBlockers.includes('real-external-dogfood-public-search-submit-continuity-required'));
  assert.ok(allBlockers.includes('bottleneck-live-surface-ref-must-match-session-id'));
  assert.ok(allBlockers.includes('selection-must-be-length-and-hash-only'));
  assert.ok(allBlockers.includes('drag-must-include-low-level-browser-host-route'));
  assert.ok(allBlockers.includes('bottleneck-required-coverage-missing:tab-switch-surface-continuity'));
  assert.ok(allBlockers.includes('bottleneck-required-coverage-missing:surface-resize-reload-continuity'));
  assert.ok(allBlockers.includes('bottleneck-required-coverage-missing:navigation-history-reload'));
  assert.ok(allBlockers.includes('bottleneck-surface-continuity-must-cover-resize-tab-reload'));
  assert.ok(allBlockers.includes('bottleneck-surface-continuity-checkpoints-required'));
  assert.ok(allBlockers.includes('latency-p95-must-not-exceed-max'));
  assert.ok(allBlockers.includes('long-session-required-coverage-missing:history-back-forward-reload'));
  assert.ok(allBlockers.includes('long-session-required-coverage-missing:right-pane-tab-switch'));
  assert.ok(allBlockers.includes('long-session-required-coverage-missing:workspace-writer-restart-reconnect'));
  assert.ok(allBlockers.includes('long-session-browser-host-action-required:back'));
  assert.ok(allBlockers.includes('long-session-browser-host-action-required:forward'));
  assert.ok(allBlockers.includes('long-session-browser-host-action-required:reload'));
  assert.ok(allBlockers.includes('long-session-tab-switch-continuity-required'));
  assert.ok(allBlockers.includes('long-session-workspace-writer-restart-attempt-required'));
  assert.ok(allBlockers.includes('long-session-address-details-recovery-outcomes-required'));
  assert.ok(allBlockers.includes('object-url-counts-must-balance'));
  assert.ok(allBlockers.includes('long-session-loading-progress-completion-required'));
  assert.ok(allBlockers.includes('long-session-loading-progress-network-quiet-required'));
  assert.ok(allBlockers.includes('long-session-loading-progress-url-digests-required'));
  assert.ok(allBlockers.includes('long-session-thirty-minute-claim-duration-required'));
  assert.ok(allBlockers.includes('webrtc-right-pane-handoff-must-not-claim-fully-passed'));
  assert.ok(allBlockers.includes('webrtc-right-pane-handoff-must-not-claim-real-ui-pass'));
  assert.ok(allBlockers.includes('webrtc-right-pane-handoff-loopback-cannot-pass'));
  assert.ok(allBlockers.includes('webrtc-right-pane-handoff-http-frame-route-cannot-pass'));
  assert.ok(allBlockers.includes('webrtc-right-pane-handoff-must-not-create-second-viewer'));
  assert.ok(allBlockers.includes('webrtc-inline-frame-bytes-forbidden'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-pass-must-have-real-run-proof'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-pass-must-not-use-loopback-or-candidate-proof'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-ref-cohesion-required'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-http-frame-route-forbidden'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-pass-must-have-enough-samples'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-ref-required:decoderMetricsRef'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-ref-required:objectUrlMetricsRef'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-metric-required:p95DecodeMs'));
  assert.ok(allBlockers.includes('webrtc-real-ui-long-run-metric-required:objectUrlCreateCount'));
  assert.ok(allBlockers.includes('native-platform-benchmark-must-not-claim-pass-without-real-results'));
  assert.ok(allBlockers.includes('native-platform-candidate-must-not-claim-benchmark-pass'));
  assert.ok(allBlockers.includes('native-platform-refusal-policy-required'));
  assert.ok(allBlockers.includes('native-platform-supported-flag-mismatch:webview2'));
  assert.ok(allBlockers.includes('input-fidelity-real-product-pass-must-have-os-ui-run'));
  assert.ok(allBlockers.includes('input-fidelity-composer-isolation-proof-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-os-ui-audit-proof-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-os-ui-run-ref-cohesion-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-ime-proof-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-clipboard-proof-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-selection-proof-required-for-pass'));
  assert.ok(allBlockers.includes('input-fidelity-raw-payloads-forbidden'));
  assert.ok(allBlockers.includes('mouse-context-menu-must-stay-browser-owned-policy'));
  assert.ok(allBlockers.includes('mouse-new-tab-semantics-must-remain-blocked-until-owner-contract-exists'));
  assert.ok(allBlockers.includes('mouse-real-product-pass-must-have-os-ui-audit-proof'));
  assert.ok(allBlockers.includes('mouse-real-product-ref-cohesion-required'));
  assert.ok(allBlockers.includes('mouse-system-input-forbidden'));
  assert.ok(allBlockers.includes('mouse-second-truth-source-forbidden'));
});

function validateBoundedBrowserEvidence(input: {
  bottleneck: JsonRecord;
  dogfood: JsonRecord;
  realExternalDogfood: JsonRecord;
  longSession: JsonRecord;
  webrtcBridge: JsonRecord;
  nativeBenchmark: JsonRecord;
  inputFidelity: JsonRecord;
  mouseGesture: JsonRecord;
}) {
  const blockers: string[] = [];
  const liveAcceptanceBlockers: string[] = [];
  blockers.push(...validateBottleneckManifest(input.bottleneck));
  blockers.push(...validateDogfoodManifest(input.dogfood));
  blockers.push(...validateRealExternalDogfoodManifest(input.realExternalDogfood));
  blockers.push(...validateLongSessionManifest(input.longSession));
  blockers.push(...validateWebRtcBridgeManifest(input.webrtcBridge));
  blockers.push(...validateNativePlatformBenchmarkResults(input.nativeBenchmark));
  blockers.push(...validateInputFidelityManifest(input.inputFidelity));
  blockers.push(...validateMouseGestureManifest(input.mouseGesture));
  blockers.push(...validateSharedBrowserEvidence(input.bottleneck, 'bottleneck'));
  blockers.push(...validateSharedBrowserEvidence(input.dogfood, 'dogfood'));
  blockers.push(...validateSharedBrowserEvidence(input.realExternalDogfood, 'real-external-dogfood'));
  blockers.push(...validateSharedBrowserEvidence(input.longSession, 'long-session'));
  blockers.push(...validateSharedBrowserEvidence(input.webrtcBridge, 'webrtc-bridge'));
  blockers.push(...validateSharedBrowserEvidence(input.nativeBenchmark, 'native-platform-benchmark'));
  blockers.push(...validateSharedBrowserEvidence(input.inputFidelity, 'input-fidelity'));
  blockers.push(...validateSharedBrowserEvidence(input.mouseGesture, 'mouse-gesture'));
  liveAcceptanceBlockers.push(...validateBrowserPaneLiveAcceptanceClaim(input.bottleneck, 'bottleneck', ['browserHostSession']));
  liveAcceptanceBlockers.push(...validateBrowserPaneLiveAcceptanceClaim(input.dogfood, 'dogfood', ['browserHostSession']));
  liveAcceptanceBlockers.push(...validateBrowserPaneLiveAcceptanceClaim(input.realExternalDogfood, 'real-external-dogfood', ['browserHostSession']));
  liveAcceptanceBlockers.push(...validateBrowserPaneLiveAcceptanceClaim(input.longSession, 'long-session', ['browserHostSession', 'beforeWorkspaceRestart']));

  const bottleneckSessionId = stringAt(input.bottleneck, ['browserHostSession', 'id']);
  const bottleneckRightPaneSessions = stringArrayAt(input.bottleneck, ['boundedMetrics', 'rightPane', 'sessionIds']);
  if (bottleneckSessionId && !bottleneckRightPaneSessions.includes(bottleneckSessionId)) {
    blockers.push('bottleneck-right-pane-session-ref-must-contain-browser-host-session');
  }

  const longSessionId = stringAt(input.longSession, ['browserHostSession', 'beforeWorkspaceRestart', 'id']);
  const longRightPaneSessions = stringArrayAt(input.longSession, ['boundedMetrics', 'rightPaneBeforeRestart', 'sessionIds']);
  if (longSessionId && !longRightPaneSessions.includes(longSessionId)) {
    blockers.push('long-session-right-pane-session-ref-must-contain-browser-host-session');
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const uniqueLiveAcceptanceBlockers = [...new Set(liveAcceptanceBlockers)].sort();
  return {
    canUseAsBoundedProductEvidence: uniqueBlockers.length === 0 && uniqueLiveAcceptanceBlockers.length === 0,
    canUseAsBoundedDiagnosticEvidence: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    liveAcceptanceBlockers: uniqueLiveAcceptanceBlockers,
    allBlockers: [...new Set([...uniqueBlockers, ...uniqueLiveAcceptanceBlockers])].sort(),
  };
}

function validateBrowserPaneLiveAcceptanceClaim(
  manifest: JsonRecord,
  label: 'bottleneck' | 'dogfood' | 'real-external-dogfood' | 'long-session',
  sessionPath: Array<string | number>,
): string[] {
  const blockers: string[] = [];
  const status = stringAt(manifest, ['status']);
  const liveAcceptance = recordAt(manifest, ['liveAcceptance']);

  if (status === 'blocked') {
    if (valueAt(liveAcceptance, ['passClaim']) === true || stringAt(liveAcceptance, ['claimScope']) === 'right-pane-live-pass') {
      blockers.push(`${label}-blocked-must-not-claim-live-pass`);
    }
    return blockers;
  }
  if (status !== 'passed') return blockers;

  const session = recordAt(manifest, sessionPath);
  const liveSurfaceTransport = stringField(session.liveSurfaceTransport) || stringField(session.transport);
  if (liveSurfaceTransport !== 'native-embedded') blockers.push(`${label}-live-pass-requires-native-embedded`);
  if (valueAt(session, ['singleInteractiveTruth']) !== true) blockers.push(`${label}-single-interactive-truth-required`);
  if (valueAt(session, ['secondTruthSource']) !== false) blockers.push(`${label}-second-truth-source-forbidden`);

  if (Object.keys(liveAcceptance).length > 0) {
    if (
      stringAt(liveAcceptance, ['status']) !== 'passed'
      || stringAt(liveAcceptance, ['claimScope']) !== 'right-pane-live-pass'
      || valueAt(liveAcceptance, ['passClaim']) !== true
      || stringAt(liveAcceptance, ['required', 'liveSurfaceTransport']) !== 'native-embedded'
      || valueAt(liveAcceptance, ['required', 'singleInteractiveTruth']) !== true
      || valueAt(liveAcceptance, ['required', 'secondTruthSource']) !== false
    ) {
      blockers.push(`${label}-live-acceptance-pass-claim-required`);
    }
  }
  return blockers;
}

function validateDogfoodManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== DOGFOOD_SCHEMA) blockers.push('dogfood-schema-mismatch');
  if (!['passed', 'blocked'].includes(stringAt(manifest, ['status']))) blockers.push('dogfood-status-must-be-passed-or-blocked');
  if (manifest.status === 'blocked' && !stringAt(manifest, ['blockedReason'])) blockers.push('dogfood-blocked-reason-required');
  if (stringAt(manifest, ['shell']) !== 'web-right-pane') blockers.push('dogfood-shell-must-be-web-right-pane');
  if (manifest.status === 'blocked' && stringAt(manifest, ['liveAcceptance', 'observed', 'liveSurfaceTransport']) === 'missing-native-attach') {
    return blockers;
  }
  if (!stringAt(manifest, ['browserHostSession', 'transport']) && !stringAt(manifest, ['browserHostSession', 'liveSurfaceTransport'])) blockers.push('dogfood-live-surface-transport-required');
  if (valueAt(manifest, ['browserHostSession', 'singleInteractiveTruth']) !== true) blockers.push('dogfood-single-interactive-truth-required');
  const sessionId = stringAt(manifest, ['browserHostSession', 'id']);
  assertSessionScopedRef(manifest, ['browserHostSession', 'liveSurfaceRef'], sessionId, 'live-surface', blockers, 'dogfood-live-surface-ref-must-match-session-id');
  assertSessionScopedRef(manifest, ['browserHostSession', 'refs', 'frameRef'], sessionId, 'frame.png', blockers, 'dogfood-frame-ref-must-match-session-id');
  blockers.push(...validateFixtureTargetEvidence(manifest, 'dogfood'));
  for (const scenario of ['search', 'documentScroll', 'formInput']) {
    if (stringAt(manifest, ['scenarios', scenario, 'status']) !== 'passed') blockers.push(`dogfood-scenario-must-pass:${scenario}`);
    if (stringArrayAt(manifest, ['scenarios', scenario, 'eventTypes']).length === 0) blockers.push(`dogfood-scenario-events-required:${scenario}`);
  }
  if (!stringArrayAt(manifest, ['scenarios', 'search', 'eventTypes']).includes('search-submit')) blockers.push('dogfood-search-submit-required');
  if (!stringArrayAt(manifest, ['scenarios', 'documentScroll', 'eventTypes']).includes('result-click')) blockers.push('dogfood-result-click-required');
  if ((numberAt(manifest, ['scenarios', 'documentScroll', 'maxScrollY']) ?? 0) <= 0) blockers.push('dogfood-scroll-evidence-required');
  if (!stringArrayAt(manifest, ['scenarios', 'formInput', 'eventTypes']).includes('form-submit')) blockers.push('dogfood-form-submit-required');
  const fallbackFlags = recordAt(manifest, ['forbiddenFallbacks']);
  if (Object.values(fallbackFlags).some((value) => value !== false)) blockers.push('dogfood-forbidden-fallbacks-must-be-false');
  return blockers;
}

function validateRealExternalDogfoodManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== REAL_EXTERNAL_DOGFOOD_SCHEMA) blockers.push('real-external-dogfood-schema-mismatch');
  if (stringAt(manifest, ['shell']) !== 'web-right-pane') blockers.push('real-external-dogfood-shell-must-be-web-right-pane');
  const target = recordAt(manifest, ['targetEvidence']);
  if (stringField(target.configuredBy) !== 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON') {
    blockers.push('real-external-dogfood-target-must-be-env-configured');
  }
  if (valueAt(target, ['hardcodedSitePassClaim']) !== false) blockers.push('real-external-dogfood-hardcoded-site-pass-forbidden');
  if (valueAt(target, ['rawUrlCaptured']) !== false || valueAt(target, ['rawDomCaptured']) !== false) {
    blockers.push('real-external-dogfood-raw-payloads-forbidden');
  }
  if (manifest.status === 'blocked') {
    if (!['blocked-no-target-config', 'blocked-real-external-url-config'].includes(stringField(target.mode))) {
      blockers.push('real-external-dogfood-blocked-mode-required');
    }
    if (valueAt(target, ['realExternalSiteClaim']) !== false) blockers.push('real-external-dogfood-blocked-must-not-claim-real-external-site');
    if (!stringAt(manifest, ['blockedReason'])) blockers.push('real-external-dogfood-blocked-reason-required');
    return blockers;
  }

  if (manifest.status !== 'passed') blockers.push('real-external-dogfood-status-must-be-passed-or-blocked');
  if (stringField(target.mode) !== 'real-external-url-config') blockers.push('real-external-dogfood-target-mode-must-be-real-external-url-config');
  if (valueAt(target, ['realExternalSiteClaim']) !== true) blockers.push('real-external-dogfood-pass-must-claim-real-external-site');
  if (
    (numberField(target, 'requestedUrlLength') ?? 0) <= 0
    || !isBoundedHash(stringField(target.requestedUrlHash))
    || (numberField(target, 'finalUrlLength') ?? 0) <= 0
    || !isBoundedHash(stringField(target.finalUrlHash))
  ) {
    blockers.push('real-external-dogfood-url-evidence-must-be-bounded-hashes');
  }
  const serializedTarget = JSON.stringify(target);
  if (/https?:\/\//i.test(serializedTarget)) blockers.push('real-external-dogfood-raw-url-forbidden');
  const sessionId = stringAt(manifest, ['browserHostSession', 'id']);
  if (!stringAt(manifest, ['browserHostSession', 'transport']) && !stringAt(manifest, ['browserHostSession', 'liveSurfaceTransport'])) {
    blockers.push('real-external-dogfood-live-surface-transport-required');
  }
  if (valueAt(manifest, ['browserHostSession', 'singleInteractiveTruth']) !== true) blockers.push('real-external-dogfood-single-interactive-truth-required');
  assertSessionScopedRef(manifest, ['browserHostSession', 'liveSurfaceRef'], sessionId, 'live-surface', blockers, 'real-external-dogfood-live-surface-ref-must-match-session-id');
  assertSessionScopedRef(manifest, ['browserHostSession', 'refs', 'frameRef'], sessionId, 'frame.png', blockers, 'real-external-dogfood-frame-ref-must-match-session-id');
  for (const field of ['openUrl', 'liveFrameVisible', 'scrollAttempted', 'reloadAttempted']) {
    if (valueAt(manifest, ['interactionCoverage', field]) !== true) blockers.push(`real-external-dogfood-interaction-required:${field}`);
  }
  if (
    valueAt(manifest, ['interactionCoverage', 'sameSessionAfterReload']) !== true
    || valueAt(manifest, ['interactionCoverage', 'sameLiveSurfaceAfterReload']) !== true
  ) {
    blockers.push('real-external-dogfood-reload-continuity-required');
  }
  const fallbacks = recordAt(manifest, ['fallbackCounts']);
  if (['iframe', 'proxy', 'systemPopup', 'httpFrameLiveView'].some((field) => (numberField(fallbacks, field) ?? 0) !== 0)) {
    blockers.push('real-external-dogfood-fallback-counts-must-be-zero');
  }
  blockers.push(...validateRealExternalPublicSearchBoxEvidence(recordAt(manifest, ['publicSearchBoxEvidence'])));
  if (stringAt(manifest, ['blockedReason'])) blockers.push('real-external-dogfood-pass-must-not-keep-blocked-reason');
  return blockers;
}

function validateRealExternalPublicSearchBoxEvidence(evidence: JsonRecord): string[] {
  const blockers: string[] = [];
  if (Object.keys(evidence).length === 0) return blockers;
  if (stringField(evidence.configuredBy) !== 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON') {
    blockers.push('real-external-dogfood-public-search-must-be-env-configured');
  }
  if (valueAt(evidence, ['rawTextCaptured']) !== false || valueAt(evidence, ['rawUrlCaptured']) !== false || valueAt(evidence, ['rawDomCaptured']) !== false) {
    blockers.push('real-external-dogfood-public-search-raw-payloads-forbidden');
  }
  const claimScope = stringField(evidence.claimScope);
  if (!['input-route-and-url-digest-only', 'input-route-only', 'not-attempted'].includes(claimScope)) {
    blockers.push('real-external-dogfood-public-search-claim-scope-required');
  }
  const typeLengths = numberArrayAt(evidence, ['typeActionTextLengths']);
  const typeHashes = stringArrayAt(evidence, ['typeActionTextHashes']);
  if (typeHashes.some((hash) => !isBoundedHash(hash)) || typeLengths.some((length) => length <= 0) || typeHashes.length !== typeLengths.length) {
    blockers.push('real-external-dogfood-public-search-text-hashes-required');
  }
  if ((numberField(evidence, 'shellComposerCapturedCharacters') ?? 0) !== 0) {
    blockers.push('real-external-dogfood-public-search-composer-must-not-capture');
  }
  if (stringArrayAt(evidence, ['pressKeys']).some((key) => key !== 'Enter')) {
    blockers.push('real-external-dogfood-public-search-press-keys-must-be-bounded');
  }
  const expectedHash = stringField(evidence.expectedAfterSubmitUrlHash);
  const finalHash = stringField(evidence.finalUrlHash);
  const hasExpectedDigest = Boolean(expectedHash || numberField(evidence, 'expectedAfterSubmitUrlLength'));
  if (hasExpectedDigest && (!isBoundedHash(expectedHash) || (numberField(evidence, 'expectedAfterSubmitUrlLength') ?? 0) <= 0)) {
    blockers.push('real-external-dogfood-public-search-expected-url-digest-required');
  }
  if (claimScope === 'input-route-and-url-digest-only') {
    if (!isBoundedHash(finalHash) || (numberField(evidence, 'finalUrlLength') ?? 0) <= 0 || valueAt(evidence, ['expectedFinalUrlMatched']) !== true) {
      blockers.push('real-external-dogfood-public-search-url-digest-must-match-claim');
    }
    if (valueAt(evidence, ['sameSessionAfterSubmit']) !== true || valueAt(evidence, ['sameLiveSurfaceAfterSubmit']) !== true) {
      blockers.push('real-external-dogfood-public-search-submit-continuity-required');
    }
  }
  return blockers;
}

function validateMouseGestureManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== MOUSE_GESTURE_SCHEMA) blockers.push('mouse-gesture-schema-mismatch');
  if (stringAt(manifest, ['liveBrowserOwner']) !== 'BrowserHostSession') blockers.push('mouse-owner-must-be-browser-host-session');
  if (valueAt(manifest, ['singleInteractiveTruth']) !== true) blockers.push('mouse-single-interactive-truth-required');
  if (valueAt(manifest, ['systemInputUsed']) !== false) blockers.push('mouse-system-input-forbidden');
  if (valueAt(manifest, ['secondTruthSource']) !== false) blockers.push('mouse-second-truth-source-forbidden');
  if (valueAt(manifest, ['rawPayloadsCaptured']) !== false) blockers.push('mouse-raw-payloads-forbidden');
  if (stringAt(manifest, ['artifactPayloadMode']) !== 'bounded-refs-and-policy-only') blockers.push('mouse-bounded-payload-mode-required');

  const missingGestures = stringArrayAt(manifest, ['coverage', 'missingGestures']);
  if (missingGestures.length > 0) blockers.push('mouse-required-gestures-must-be-covered');
  for (const fixture of ['dragDrop', 'textSelection', 'scrollbarThumbDrag']) {
    const fixtureStatus = stringAt(manifest, ['acceptanceFixtures', fixture, 'status']);
    if (fixtureStatus !== 'passed' && fixtureStatus !== 'diagnostic') blockers.push(`mouse-acceptance-fixture-must-be-diagnostic-or-pass:${fixture}`);
    if (!stringAt(manifest, ['acceptanceFixtures', fixture, 'evidenceRef']).startsWith('browser-host-session:')) blockers.push(`mouse-acceptance-fixture-ref-required:${fixture}`);
  }
  if (stringAt(manifest, ['contextMenuPolicy']) !== 'browser-context-menu') blockers.push('mouse-context-menu-must-stay-browser-owned-policy');
  if (stringAt(manifest, ['middleClickPolicy']) !== 'browser-host-session-owned-middle-button') blockers.push('mouse-middle-click-policy-required');
  blockers.push(...validateMouseGestureProductAcceptance(recordAt(manifest, ['productAcceptance'])));
  if (stringAt(manifest, ['newTabSemantics', 'status']) !== 'blocked') blockers.push('mouse-new-tab-semantics-must-remain-blocked-until-owner-contract-exists');
  if (stringAt(manifest, ['newTabSemantics', 'middleClick', 'claim']) !== 'not-claimed') blockers.push('mouse-middle-click-new-tab-must-not-claim-pass');
  if (stringAt(manifest, ['newTabSemantics', 'modifierClick', 'claim']) !== 'not-claimed') blockers.push('mouse-modifier-click-new-tab-must-not-claim-pass');
  if (valueAt(manifest, ['newTabSemantics', 'singleOwnerPreserved']) !== true) blockers.push('mouse-new-tab-policy-must-preserve-single-owner');
  if (valueAt(manifest, ['newTabSemantics', 'rawTabPayloadCaptured']) !== false) blockers.push('mouse-new-tab-raw-tab-payload-forbidden');
  if (valueAt(manifest, ['newTabSemantics', 'systemInputUsed']) !== false) blockers.push('mouse-new-tab-system-input-forbidden');
  return blockers;
}

function validateMouseGestureProductAcceptance(acceptance: JsonRecord): string[] {
  const blockers: string[] = [];
  const canClaimPass = valueAt(acceptance, ['canClaimRealMouseFidelityPass']) === true;
  if (!canClaimPass) {
    if (stringField(acceptance.status) !== 'blocked') blockers.push('mouse-real-product-nonpass-must-be-blocked');
    if (valueAt(acceptance, ['rawSelectionTextRecorded']) !== false
      || valueAt(acceptance, ['rawContextMenuPayloadRecorded']) !== false
      || valueAt(acceptance, ['rawTabPayloadCaptured']) !== false) {
      blockers.push('mouse-real-product-raw-payloads-forbidden');
    }
    return blockers;
  }

  if (stringField(acceptance.status) !== 'passed' || stringField(acceptance.source) !== 'real-product-os-ui-run') {
    blockers.push('mouse-real-product-pass-must-have-os-ui-audit-proof');
  }
  const run = recordAt(acceptance, ['osUiRun']);
  const audit = recordAt(run, ['composerAudit']);
  const proofs = arrayAt(run, ['auditProofs']).map(recordFromUnknown);
  const proofKinds = new Set(proofs.map((proof) => stringField(proof.kind)));
  const requiredKinds = stringArrayAt(acceptance, ['auditProofsRequired']);
  const hasProofs = stringField(run.productSurface) === 'right-pane-browser'
    && stringField(run.browserHostSessionRef).startsWith('browser-host-session:')
    && stringField(run.liveSurfaceRef).startsWith('browser-host-session:')
    && requiredKinds.length > 0
    && requiredKinds.every((kind) => proofKinds.has(kind))
    && proofs.every((proof) => (
      stringField(proof.owner) === 'BrowserHostSession'
        && stringField(proof.auditRef).startsWith('browser-host-session:')
        && stringField(proof.browserHostSessionRef) === stringField(run.browserHostSessionRef)
        && stringField(proof.liveSurfaceRef) === stringField(run.liveSurfaceRef)
        && valueAt(proof, ['rawPayloadRecorded']) === false
        && stringField(proof.shellComposerTarget) === 'not-targeted'
    ));
  if (!hasProofs) blockers.push('mouse-real-product-pass-must-have-os-ui-audit-proof');
  if (!hasMouseGestureOsUiRunRefCohesion(acceptance)) blockers.push('mouse-real-product-ref-cohesion-required');
  if ((numberField(audit, 'shellComposerCapturedCharacters') ?? -1) !== 0
    || (numberField(audit, 'shellComposerTargetedActions') ?? -1) !== 0
    || !stringField(audit.composerAuditRef).startsWith('browser-host-session:')) {
    blockers.push('mouse-real-product-composer-isolation-proof-required');
  }
  if (valueAt(acceptance, ['realContextMenuVerified']) !== true) blockers.push('mouse-real-context-menu-proof-required');
  if (valueAt(acceptance, ['realMiddleClickNewTabOrHandoffVerified']) !== true) blockers.push('mouse-real-middle-click-proof-required');
  if (valueAt(acceptance, ['realSelectionRangeVerified']) !== true) blockers.push('mouse-real-selection-range-proof-required');
  if (valueAt(acceptance, ['rawSelectionTextRecorded']) !== false
    || valueAt(acceptance, ['rawContextMenuPayloadRecorded']) !== false
    || valueAt(acceptance, ['rawTabPayloadCaptured']) !== false) {
    blockers.push('mouse-real-product-raw-payloads-forbidden');
  }
  return blockers;
}

function validateInputFidelityManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== INPUT_FIDELITY_SCHEMA) blockers.push('input-fidelity-schema-mismatch');
  if (stringAt(manifest, ['owner']) !== 'BrowserHostSession') blockers.push('input-fidelity-owner-must-be-browser-host-session');
  if (valueAt(manifest, ['singleInteractiveTruth']) !== true) blockers.push('input-fidelity-single-interactive-truth-required');
  if (valueAt(manifest, ['secondTruthSource']) !== false) blockers.push('input-fidelity-second-truth-source-forbidden');
  if (valueAt(manifest, ['rawPayloadsCaptured']) !== false) blockers.push('input-fidelity-raw-payloads-forbidden');
  if (/"(?:clipboardText|clipboardPayload|selectionText|selectionPayload|compositionText|compositionPayload|typedText|typedPayload|domPayload|rawDom|rawHtml|rawClipboard|rawSelection|rawComposition)"\s*:/i.test(JSON.stringify(manifest))) {
    blockers.push('input-fidelity-raw-payloads-forbidden');
  }
  if (valueAt(manifest, ['refsFirst']) !== true) blockers.push('input-fidelity-refs-first-required');

  const canClaimPass = valueAt(manifest, ['canClaimProductInputFidelityPass']) === true;
  const status = stringAt(manifest, ['status']);
  const source = stringAt(manifest, ['source']);
  if (!canClaimPass) {
    if (status !== 'blocked') blockers.push('input-fidelity-nonpass-must-be-blocked');
    return blockers;
  }

  if (status !== 'passed' || source !== 'real-product-os-ui-run' || !hasInputOsUiRun(manifest)) {
    blockers.push('input-fidelity-real-product-pass-must-have-os-ui-run');
  }
  if (!hasInputComposerIsolationProof(manifest)) blockers.push('input-fidelity-composer-isolation-proof-required-for-pass');
  if (!hasInputOsUiAuditProofs(manifest)) blockers.push('input-fidelity-os-ui-audit-proof-required-for-pass');
  if (!hasInputOsUiRunRefCohesion(manifest)) blockers.push('input-fidelity-os-ui-run-ref-cohesion-required-for-pass');
  if (!hasInputImeProof(recordAt(manifest, ['capabilities', 'ime']))) blockers.push('input-fidelity-ime-proof-required-for-pass');
  if (!hasInputClipboardProof(recordAt(manifest, ['capabilities', 'clipboard']))) blockers.push('input-fidelity-clipboard-proof-required-for-pass');
  if (!hasInputSelectionProof(recordAt(manifest, ['capabilities', 'selectionRange']))) blockers.push('input-fidelity-selection-proof-required-for-pass');
  for (const capabilityName of ['cursorCaret', 'mouse', 'keyboard', 'ime', 'clipboard', 'selectionRange']) {
    const capability = recordAt(manifest, ['capabilities', capabilityName]);
    if (stringField(capability.status) !== 'passed') blockers.push(`input-fidelity-capability-must-pass:${capabilityName}`);
    if (stringArrayAt(capability, ['evidenceRefs']).length === 0) blockers.push(`input-fidelity-capability-ref-required:${capabilityName}`);
  }
  return blockers;
}

function validateBottleneckManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== BOTTLENECK_SCHEMA) blockers.push('bottleneck-schema-mismatch');
  if (!['passed', 'blocked'].includes(stringAt(manifest, ['status']))) blockers.push('bottleneck-status-must-be-passed-or-blocked');
  if (manifest.status === 'blocked' && !stringAt(manifest, ['blockedReason'])) blockers.push('bottleneck-blocked-reason-required');
  if (manifest.refsFirst !== true) blockers.push('bottleneck-refs-first-required');
  if (manifest.status === 'blocked' && (stringAt(manifest, ['targetEvidence', 'mode']) === 'blocked' || !stringAt(manifest, ['browserHostSession', 'id']))) {
    return blockers;
  }
  if (stringAt(manifest, ['browserHostSession', 'owner']) !== 'host') blockers.push('bottleneck-owner-must-be-host');
  if (valueAt(manifest, ['browserHostSession', 'singleInteractiveTruth']) !== true) {
    blockers.push('bottleneck-single-interactive-truth-required');
  }
  const sessionId = stringAt(manifest, ['browserHostSession', 'id']);
  assertSessionScopedRef(manifest, ['browserHostSession', 'liveSurfaceRef'], sessionId, 'live-surface', blockers, 'bottleneck-live-surface-ref-must-match-session-id');
  assertOptionalSessionScopedRef(manifest, ['browserHostSession', 'refs', 'frameStreamRef'], sessionId, 'frame-stream', blockers, 'bottleneck-frame-stream-ref-must-match-session-id');
  blockers.push(...validateFixtureTargetEvidence(manifest, 'bottleneck'));

  const selectionLength = numberAt(manifest, ['interactionCoverage', 'searchboxCaret', 'finalSelectionLength']);
  const selectionHash = stringAt(manifest, ['interactionCoverage', 'searchboxCaret', 'selectedTextHash']);
  const textSelectionLength = numberAt(manifest, ['interactionCoverage', 'textSelection', 'maxSelectionLength']);
  const textSelectionHash = stringAt(manifest, ['interactionCoverage', 'textSelection', 'selectionHash']);
  if ((selectionLength ?? 0) <= 0 || !isBoundedHash(selectionHash) || (textSelectionLength ?? 0) <= 0 || !isBoundedHash(textSelectionHash)) {
    blockers.push('selection-must-be-length-and-hash-only');
  }

  const dragActions = stringArrayAt(manifest, ['interactionCoverage', 'drag', 'browserHostRouteActions']);
  if (!hasLowLevelDragRoute(dragActions)) blockers.push('drag-must-include-low-level-browser-host-route');
  if ((numberAt(manifest, ['interactionCoverage', 'drag', 'fixturePointerMoveEvents']) ?? 0) <= 0) {
    blockers.push('drag-must-have-product-pointer-evidence');
  }
  for (const coverage of ['tab-switch-surface-continuity', 'surface-resize-reload-continuity', 'navigation-history-reload']) {
    if (!stringArrayAt(manifest, ['interactionCoverage', 'classes']).includes(coverage)) {
      blockers.push(`bottleneck-required-coverage-missing:${coverage}`);
    }
  }
  const continuity = recordAt(manifest, ['interactionCoverage', 'surfaceContinuity']);
  if (
    valueAt(continuity, ['sameSessionAcrossResize']) !== true
    || valueAt(continuity, ['sameLiveSurfaceAcrossResize']) !== true
    || valueAt(continuity, ['sameSessionAcrossTabSwitch']) !== true
    || valueAt(continuity, ['sameLiveSurfaceAcrossTabSwitch']) !== true
    || valueAt(continuity, ['sameLiveSurfaceAcrossReload']) !== true
  ) {
    blockers.push('bottleneck-surface-continuity-must-cover-resize-tab-reload');
  }
  const checkpointLabels = stringArrayAt(continuity, ['checkpointLabels']);
  for (const label of ['before-resize', 'after-resize', 'after-tab-return', 'after-reload']) {
    if (!checkpointLabels.includes(label)) blockers.push('bottleneck-surface-continuity-checkpoints-required');
  }

  assertLatencyCategories(
    arrayAt(manifest, ['timingSummary', 'categories']),
    ['input-routing', 'surface-attach', 'frame-capture', 'state-polling', 'navigation', 'react-rerender'],
    blockers,
  );
  if ((numberAt(manifest, ['boundedMetrics', 'rightPane', 'detachChanges']) ?? 0) !== 0) blockers.push('surface-detach-must-be-zero');
  if ((numberAt(manifest, ['boundedMetrics', 'rightPane', 'maxHostFrames']) ?? 0) !== 1) blockers.push('single-host-frame-required');
  return blockers;
}

function validateFixtureTargetEvidence(manifest: JsonRecord, label: 'dogfood' | 'bottleneck'): string[] {
  const blockers: string[] = [];
  const target = recordAt(manifest, ['targetEvidence']);
  if (stringField(target.mode) !== 'resolver-fixture') blockers.push(`${label}-target-mode-must-be-resolver-fixture`);
  if (!stringField(target.hostRef).startsWith('fixture-host:')) blockers.push(`${label}-target-host-ref-required`);
  if (!stringField(target.originRef).startsWith('fixture-origin:')) blockers.push(`${label}-target-origin-ref-must-be-bounded`);
  if (stringField(target.originRef) !== stringAt(manifest, ['targetOriginRef'])) blockers.push(`${label}-target-origin-ref-must-match`);
  if (valueAt(target, ['resolverRuleApplied']) !== true) blockers.push(`${label}-target-resolver-rule-required`);
  if (valueAt(target, ['realExternalSiteClaim']) !== false) blockers.push(`${label}-target-must-not-claim-real-external-site`);
  if (valueAt(target, ['hardcodedSitePassClaim']) !== false) blockers.push(`${label}-target-must-not-claim-hardcoded-site-pass`);
  if (valueAt(target, ['rawUrlCaptured']) !== false) blockers.push(`${label}-target-raw-url-forbidden`);
  if (stringField(target.allowedUse) !== 'right-pane-product-path-contract-not-external-web-pass') {
    blockers.push(`${label}-target-allowed-use-must-not-claim-external-pass`);
  }
  if (/^https?:\/\//i.test(stringAt(manifest, ['targetOriginRef']))) blockers.push(`${label}-target-origin-ref-must-be-bounded`);
  return blockers;
}

function validateLongSessionManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== LONG_SESSION_SCHEMA) blockers.push('long-session-schema-mismatch');
  if (!['passed', 'blocked'].includes(stringAt(manifest, ['status']))) blockers.push('long-session-status-must-be-passed-or-blocked');
  if (manifest.status === 'blocked' && !stringAt(manifest, ['blockedReason']) && !stringAt(manifest, ['failure', 'reasonCode'])) {
    blockers.push('long-session-blocked-reason-required');
  }
  if (manifest.status === 'blocked' && !stringAt(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'id'])) {
    return blockers;
  }
  if (stringAt(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'owner']) !== 'host') blockers.push('long-session-owner-must-be-host');
  if (valueAt(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'singleInteractiveTruth']) !== true) {
    blockers.push('long-session-single-interactive-truth-required');
  }
  const sessionId = stringAt(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'id']);
  assertSessionScopedRef(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'liveSurfaceRef'], sessionId, 'live-surface', blockers, 'long-session-live-surface-ref-must-match-session-id');
  assertOptionalSessionScopedRef(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'refs', 'frameStreamRef'], sessionId, 'frame-stream', blockers, 'long-session-frame-stream-ref-must-match-session-id');

  const dragActions = stringArrayAt(manifest, ['interactionCoverage', 'drag', 'browserHostRouteActions']);
  if (!hasLowLevelDragRoute(dragActions)) blockers.push('drag-must-include-low-level-browser-host-route');
  if ((numberAt(manifest, ['interactionCoverage', 'drag', 'fixturePointerEvents']) ?? 0) <= 0) {
    blockers.push('drag-must-have-product-pointer-evidence');
  }
  for (const coverage of [
    'continuous-navigation',
    'continuous-input',
    'long-page-scroll',
    'drag-mouse-route',
    'history-back-forward-reload',
    'right-pane-tab-switch',
    'workspace-writer-restart-reconnect',
  ]) {
    if (!stringArrayAt(manifest, ['interactionCoverage', 'classes']).includes(coverage)) {
      blockers.push(`long-session-required-coverage-missing:${coverage}`);
    }
  }
  for (const action of ['navigate', 'back', 'forward', 'reload']) {
    if (!stringArrayAt(manifest, ['interactionCoverage', 'browserHostActions']).includes(action)) {
      blockers.push(`long-session-browser-host-action-required:${action}`);
    }
  }
  if (valueAt(manifest, ['continuity', 'sameSessionBeforeRestart']) !== true) {
    blockers.push('long-session-same-session-before-restart-required');
  }
  if (valueAt(manifest, ['continuity', 'tabSwitchSameSession']) !== true) {
    blockers.push('long-session-tab-switch-continuity-required');
  }

  const typedInputHashes = stringArrayAt(manifest, ['interactionCoverage', 'typedInput', 'hashes']);
  const lengthRange = numberArrayAt(manifest, ['interactionCoverage', 'typedInput', 'lengthRange']);
  if (typedInputHashes.length === 0 || typedInputHashes.some((hash) => !isBoundedHash(hash)) || Math.min(...lengthRange) <= 0) {
    blockers.push('typed-input-must-be-length-and-hash-only');
  }

  assertLatencyRecord(
    recordAt(manifest, ['boundedMetrics', 'latencySummary']),
    ['navigation', 'input-routing', 'scroll-routing', 'drag-routing', 'history-reload', 'right-pane-tab-switch', 'frame-capture', 'state-polling', 'workspace-reconnect'],
    blockers,
  );
  const outcomes = arrayAt(manifest, ['failureRetry', 'addressDetailsRecovery', 'outcomes']).map(recordFromUnknown);
  const outcomeCount = numberAt(manifest, ['failureRetry', 'addressDetailsRecovery', 'outcomeCount']) ?? 0;
  const iterationsCompleted = numberAt(manifest, ['runner', 'iterationsCompleted']) ?? 0;
  if (outcomeCount !== iterationsCompleted || outcomes.length === 0 || outcomes.length > 12) {
    blockers.push('long-session-address-details-recovery-outcomes-required');
  }
  for (const outcome of outcomes) {
    if (valueAt(outcome, ['boundedRefs', 'bounded']) !== true
      || valueAt(outcome, ['boundedRefs', 'noRawUrl']) !== true
      || valueAt(outcome, ['boundedRefs', 'noRawDom']) !== true) {
      blockers.push('long-session-address-details-recovery-bounded-refs-required');
    }
  }
  const restart = recordAt(manifest, ['failureRetry', 'workspaceWriterRestart']);
  const restartStatus = stringField(restart.status);
  if (valueAt(restart, ['attempted']) !== true || !['reconnected', 'blocked'].includes(restartStatus)) {
    blockers.push('long-session-workspace-writer-restart-attempt-required');
  }
  const restartRetry = recordAt(restart, ['retry']);
  if (stringField(restartRetry.action) !== 'restart-workspace-writer-same-port-and-poll-existing-session'
    || !['succeeded', 'blocked'].includes(stringField(restartRetry.status))) {
    blockers.push('long-session-workspace-writer-restart-retry-evidence-required');
  }
  if (restartStatus === 'reconnected') {
    const beforeId = stringAt(manifest, ['browserHostSession', 'beforeWorkspaceRestart', 'id']);
    const afterId = stringAt(manifest, ['browserHostSession', 'afterWorkspaceRestart', 'id']);
    if (!beforeId || beforeId !== afterId || stringField(restartRetry.status) !== 'succeeded') {
      blockers.push('long-session-workspace-writer-restart-session-ref-required');
    }
  }
  assertObjectUrlCounts(recordAt(manifest, ['boundedMetrics', 'memoryishCounts']), recordAt(manifest, ['boundedMetrics', 'rightPaneBeforeRestart', 'objectUrls']), blockers);
  if ((numberAt(manifest, ['boundedMetrics', 'rightPaneBeforeRestart', 'detachChanges']) ?? 0) !== 0) blockers.push('surface-detach-must-be-zero');
  if ((numberAt(manifest, ['boundedMetrics', 'rightPaneBeforeRestart', 'maxHostFrames']) ?? 0) !== 1) blockers.push('single-host-frame-required');
  if (valueAt(manifest, ['runner', 'defaultSmokeIsThirtyMinuteBenchmark']) !== false) blockers.push('quick-smoke-must-not-claim-thirty-minutes');
  validateLongSessionLoadingProgress(recordAt(manifest, ['boundedMetrics', 'loadingProgressLifecycle']), blockers);
  const requestedMinutes = numberAt(manifest, ['runner', 'requestedMinutes']) ?? 0;
  const durationMs = numberAt(manifest, ['runner', 'durationMs']) ?? 0;
  if (requestedMinutes >= 30 && durationMs < requestedMinutes * 60_000) {
    blockers.push('long-session-thirty-minute-claim-duration-required');
  }
  return blockers;
}

function validateLongSessionLoadingProgress(lifecycle: JsonRecord, blockers: string[]): void {
  if (stringField(lifecycle.schemaVersion) !== 'sciforge.browser-pane-product-long-session.loading-progress-trace.v1') {
    blockers.push('long-session-loading-progress-schema-mismatch');
  }
  if (valueAt(lifecycle, ['bounded']) !== true) blockers.push('long-session-loading-progress-must-be-bounded');
  const completion = recordAt(lifecycle, ['completionEvidence']);
  if (valueAt(completion, ['uiLoadingToReady']) !== true || valueAt(completion, ['readyStateObserved']) !== true) {
    blockers.push('long-session-loading-progress-completion-required');
  }
  if (valueAt(completion, ['networkQuietObserved']) !== true) {
    blockers.push('long-session-loading-progress-network-quiet-required');
  }
  if (!boundedCountsContain(lifecycle, ['observedUiStates'], 'loading') || !boundedCountsContain(lifecycle, ['observedUiStates'], 'ready')) {
    blockers.push('long-session-loading-progress-ui-states-required');
  }
  const hasLoadingLifecycleState = ['navigation-start', 'navigation-committed', 'interactive', 'load', 'stalled', 'retry']
    .some((state) => boundedCountsContain(lifecycle, ['observedLifecycleStates'], state));
  const hasUiLoadingReadyTrace = valueAt(completion, ['uiLoadingToReady']) === true
    && boundedCountsContain(lifecycle, ['observedUiStates'], 'loading')
    && boundedCountsContain(lifecycle, ['observedUiStates'], 'ready');
  if ((!hasLoadingLifecycleState && !hasUiLoadingReadyTrace) || !boundedCountsContain(lifecycle, ['observedLifecycleStates'], 'network-quiet')) {
    blockers.push('long-session-loading-progress-lifecycle-states-required');
  }
  if (!hasLongSessionUrlDigestEvidence(recordAt(lifecycle, ['urlEvidence', 'requested']))
    || !hasLongSessionUrlDigestEvidence(recordAt(lifecycle, ['urlEvidence', 'current']))) {
    blockers.push('long-session-loading-progress-url-digests-required');
  }
}

function hasLongSessionUrlDigestEvidence(summary: JsonRecord): boolean {
  const hashes = stringArrayAt(summary, ['hashes']);
  const lengthRange = numberArrayAt(summary, ['lengthRange']);
  return (numberField(summary, 'sampleCount') ?? 0) > 0
    && (numberField(summary, 'uniqueHashCount') ?? 0) > 0
    && lengthRange.length === 2
    && lengthRange.every((value) => value > 0)
    && hashes.length > 0
    && hashes.every((hash) => /^[a-f0-9]{16}$/.test(hash));
}

function validateWebRtcBridgeManifest(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== WEBRTC_BRIDGE_SCHEMA) blockers.push('webrtc-bridge-schema-mismatch');
  if (!['passed', 'diagnostic'].includes(stringAt(manifest, ['status']))) blockers.push('webrtc-bridge-status-must-be-passed-contract-or-diagnostic');
  if (stringAt(manifest, ['bridge', 'owner']) !== 'BrowserHostSession') blockers.push('webrtc-bridge-owner-must-be-browser-host-session');
  if (valueAt(manifest, ['bridge', 'singleInteractiveTruth']) !== true) blockers.push('webrtc-bridge-single-interactive-truth-required');
  if (valueAt(manifest, ['bridge', 'secondTruthSource']) !== false) blockers.push('webrtc-bridge-second-truth-source-forbidden');
  if (valueAt(manifest, ['bridge', 'rawPayloadsCaptured']) !== false) blockers.push('webrtc-bridge-raw-payloads-forbidden');
  const sessionRef = stringAt(manifest, ['refs', 'hostSessionRef']);
  const sessionId = sessionRef.startsWith('browser-host-session:') ? sessionRef.slice('browser-host-session:'.length) : '';
  assertSessionScopedRef(manifest, ['bridge', 'refs', 'liveSurfaceRef'], sessionId, 'live-surface', blockers, 'webrtc-live-surface-ref-must-match-session-id');
  assertOptionalSessionScopedRef(manifest, ['bridge', 'refs', 'frameStreamRef'], sessionId, 'frame-stream', blockers, 'webrtc-frame-stream-ref-must-match-session-id');
  if (stringAt(manifest, ['bridge', 'rightPaneHandoff', 'status']) !== 'candidate-contract') {
    blockers.push('webrtc-right-pane-handoff-status-must-remain-candidate-contract');
  }
  if (stringAt(manifest, ['bridge', 'rightPaneHandoff', 'frameTransport']) !== 'webrtc-data-channel'
    || stringAt(manifest, ['bridge', 'rightPaneHandoff', 'liveSurfaceTransportCandidate']) !== 'webrtc-data-channel') {
    blockers.push('webrtc-right-pane-handoff-transport-must-remain-candidate-only');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'fullyPassedClaim']) !== false) {
    blockers.push('webrtc-right-pane-handoff-must-not-claim-fully-passed');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'realUiWebRtcPassClaim']) !== false) {
    blockers.push('webrtc-right-pane-handoff-must-not-claim-real-ui-pass');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'loopbackEvidenceOnly']) !== false) {
    blockers.push('webrtc-right-pane-handoff-loopback-cannot-pass');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'httpFrameRouteClaim']) !== false) {
    blockers.push('webrtc-right-pane-handoff-http-frame-route-cannot-pass');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'secondViewer']) !== false || valueAt(manifest, ['bridge', 'rightPaneHandoff', 'secondTruthSource']) !== false) {
    blockers.push('webrtc-right-pane-handoff-must-not-create-second-viewer');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'inlineFrameBytes']) !== false || valueAt(manifest, ['bridge', 'rightPaneHandoff', 'inlineSignals']) !== false) {
    blockers.push('webrtc-inline-frame-bytes-forbidden');
  }
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'httpFrameLiveFallback']) !== false) blockers.push('webrtc-http-frame-live-fallback-forbidden');
  if (valueAt(manifest, ['bridge', 'rightPaneHandoff', 'iframe']) !== false || valueAt(manifest, ['bridge', 'rightPaneHandoff', 'proxy']) !== false) {
    blockers.push('webrtc-iframe-proxy-forbidden');
  }
  const rightPaneLiveAcceptance = recordAt(manifest, ['rightPaneLiveAcceptance']);
  if (Object.keys(rightPaneLiveAcceptance).length > 0) {
    if (stringAt(rightPaneLiveAcceptance, ['status']) !== 'blocked'
      || stringAt(rightPaneLiveAcceptance, ['claimScope']) !== 'legacy-transport-diagnostic-only'
      || valueAt(rightPaneLiveAcceptance, ['passClaim']) !== false
      || stringAt(rightPaneLiveAcceptance, ['required', 'liveSurfaceTransport']) !== 'native-embedded'
      || valueAt(rightPaneLiveAcceptance, ['required', 'singleInteractiveTruth']) !== true
      || valueAt(rightPaneLiveAcceptance, ['required', 'secondTruthSource']) !== false) {
      blockers.push('webrtc-right-pane-live-acceptance-must-be-diagnostic-refusal');
    }
  }
  const summary = recordAt(manifest, ['bridge', 'metrics', 'summary']);
  if ((numberField(summary, 'sampleCount') ?? 0) <= 0) blockers.push('webrtc-metrics-sample-count-required');
  if ((numberField(summary, 'p95EndToEndMs') ?? 0) <= 0) blockers.push('webrtc-p95-end-to-end-required');
  blockers.push(...validateWebRtcRealUiLongRunHandoff(recordAt(manifest, ['realP95DropBackpressureLongRunHandoff'])));
  return blockers;
}

function validateWebRtcRealUiLongRunHandoff(handoff: JsonRecord): string[] {
  const blockers: string[] = [];
  const status = stringField(handoff.status);
  const benchmarkClaim = valueAt(handoff, ['benchmarkClaim']) === true;
  if (!status) {
    blockers.push('webrtc-real-ui-long-run-handoff-required');
    return blockers;
  }
  if (!benchmarkClaim) {
    if (status !== 'blocked') blockers.push('webrtc-real-ui-long-run-nonpass-must-be-blocked');
    if (valueAt(handoff, ['rawPayloadsCaptured']) !== false) blockers.push('webrtc-real-ui-long-run-raw-payloads-forbidden');
    if (valueAt(handoff, ['secondTruthSource']) !== false) blockers.push('webrtc-real-ui-long-run-second-truth-forbidden');
    if (!hasWebRtcPassRefusalPolicy(handoff)) blockers.push('webrtc-real-ui-long-run-pass-refusal-policy-required');
    return blockers;
  }

  if (
    status !== 'passed'
    || stringField(handoff.source) !== 'real-right-pane-ui-webrtc-run'
    || valueAt(handoff, ['realUiRun']) !== true
    || stringField(handoff.productSurface) !== 'right-pane-browser'
    || stringField(handoff.transportEvidenceKind) !== 'real-ui-webrtc-data-channel-live-stack'
    || valueAt(handoff, ['secondTruthSource']) !== false
    || valueAt(handoff, ['rawPayloadsCaptured']) !== false
  ) {
    blockers.push('webrtc-real-ui-long-run-pass-must-have-real-run-proof');
  }
  if (['contract-smoke-not-real-ui-run', 'webrtc-loopback-smoke', 'candidate-contract', 'loopback-data-channel'].includes(stringField(handoff.source))
    || ['loopback-browser', 'contract-smoke'].includes(stringField(handoff.productSurface))
    || ['loopback-data-channel', 'candidate-contract'].includes(stringField(handoff.transportEvidenceKind))) {
    blockers.push('webrtc-real-ui-long-run-pass-must-not-use-loopback-or-candidate-proof');
  }
  const refs = recordAt(handoff, ['refs']);
  for (const field of ['hostSessionRef', 'rightPaneSurfaceRef', 'metricsSamplesRef', 'decoderMetricsRef', 'objectUrlMetricsRef', 'actionChannelRef']) {
    if (!stringField(refs[field]).startsWith('browser-host-session:')) {
      blockers.push(`webrtc-real-ui-long-run-ref-required:${field}`);
    }
  }
  if (!hasWebRtcRealUiRefCohesion(refs)) blockers.push('webrtc-real-ui-long-run-ref-cohesion-required');
  if (stringField(refs.httpFrameRef).includes('/frame') || stringField(refs.frameUrl).includes('/frame')) {
    blockers.push('webrtc-real-ui-long-run-http-frame-route-forbidden');
  }
  if (!hasWebRtcPassRefusalPolicy(handoff)) blockers.push('webrtc-real-ui-long-run-pass-refusal-policy-required');
  const metrics = recordAt(handoff, ['realRunMetrics']);
  const sampleCount = numberField(metrics, 'sampleCount') ?? numberAt(handoff, ['deterministicContractMetrics', 'sampleCount']) ?? 0;
  if (sampleCount < 120) blockers.push('webrtc-real-ui-long-run-pass-must-have-enough-samples');
  for (const field of ['p95EndToEndMs', 'p95DecodeMs', 'dropRate', 'totalDroppedFrames', 'totalSkippedBackpressure', 'backpressureEventCount', 'objectUrlCreateCount', 'objectUrlRevokeCount', 'objectUrlLiveEstimate', 'objectUrlRevokeDeficit']) {
    const value = metrics[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) blockers.push(`webrtc-real-ui-long-run-metric-required:${field}`);
  }
  if (stringField(handoff.blockedReason)) blockers.push('webrtc-real-ui-long-run-pass-must-not-keep-blocked-reason');
  return blockers;
}

function hasWebRtcRealUiRefCohesion(refs: JsonRecord): boolean {
  const hostSessionRef = stringField(refs.hostSessionRef);
  if (!hostSessionRef.startsWith('browser-host-session:')) return false;
  const sessionId = hostSessionRef.slice('browser-host-session:'.length);
  const expected: Record<string, string> = {
    rightPaneSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    metricsSamplesRef: `browser-host-session:${sessionId}/webrtc-metrics/samples`,
    decoderMetricsRef: `browser-host-session:${sessionId}/webrtc-metrics/decoder`,
    objectUrlMetricsRef: `browser-host-session:${sessionId}/webrtc-metrics/object-url-lifecycle`,
    actionChannelRef: `browser-host-session:${sessionId}/actions`,
  };
  return Object.entries(expected).every(([field, expectedRef]) => stringField(refs[field]) === expectedRef);
}

function hasWebRtcPassRefusalPolicy(handoff: JsonRecord): boolean {
  const policy = recordAt(handoff, ['passRefusalPolicy']);
  return valueAt(policy, ['candidateContractDoesNotPass']) === true
    && valueAt(policy, ['loopbackSmokeDoesNotPass']) === true
    && valueAt(policy, ['httpFrameRouteDoesNotPass']) === true
    && valueAt(policy, ['secondTruthSourceDoesNotPass']) === true
    && valueAt(policy, ['deterministicContractMetricsDoNotPass']) === true;
}

function validateNativePlatformBenchmarkResults(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  if (manifest.schemaVersion !== NATIVE_PLATFORM_BENCHMARK_SCHEMA) blockers.push('native-platform-benchmark-schema-mismatch');
  if (stringAt(manifest, ['owner']) !== 'BrowserHostSession') blockers.push('native-platform-benchmark-owner-must-be-browser-host-session');
  if (valueAt(manifest, ['singleInteractiveTruth']) !== true) blockers.push('native-platform-benchmark-single-interactive-truth-required');
  if (valueAt(manifest, ['payloadPolicy', 'refsFirst']) !== true) blockers.push('native-platform-benchmark-refs-first-required');
  if ((numberAt(manifest, ['payloadPolicy', 'maxInlineEvidenceBytes']) ?? 1) !== 0) blockers.push('native-platform-inline-evidence-forbidden');
  const candidates = arrayAt(manifest, ['candidates']).map(recordFromUnknown);
  if (candidates.length === 0) blockers.push('native-platform-candidates-required');
  if (!hasNativePlatformRefusalPolicy(manifest)) blockers.push('native-platform-refusal-policy-required');
  blockers.push(...validateNativePlatformSupportFlags(manifest));

  const benchmarkClaim = valueAt(manifest, ['benchmarkClaim']) === true;
  const status = stringAt(manifest, ['status']);
  const runnerStatus = stringAt(manifest, ['runner', 'status']);
  const allCandidatesPassed = candidates.length > 0 && candidates.every(hasRealNativePlatformCandidatePass);
  if (benchmarkClaim || status === 'passed' || runnerStatus === 'passed') {
    if (!allCandidatesPassed || status !== 'passed' || runnerStatus !== 'passed') {
      blockers.push('native-platform-benchmark-must-not-claim-pass-without-real-results');
    }
    if (stringAt(manifest, ['decisionGate', 'status']) !== 'ready-for-human-decision') {
      blockers.push('native-platform-decision-gate-must-be-ready-only-after-real-results');
    }
  }
  if (!benchmarkClaim && (status === 'passed' || runnerStatus === 'passed')) {
    blockers.push('native-platform-pass-status-must-set-benchmark-claim');
  }

  for (const candidate of candidates) {
    const id = stringField(candidate.id) || 'unknown';
    const candidateClaimsPass = valueAt(candidate, ['benchmarkClaim']) === true || stringField(candidate.status) === 'passed';
    if (candidateClaimsPass && !hasRealNativePlatformCandidatePass(candidate)) {
      blockers.push('native-platform-candidate-must-not-claim-benchmark-pass');
      blockers.push(`native-platform-candidate-must-not-pass-without-real-result:${id}`);
    }
    for (const section of arrayAt(candidate, ['metricSections']).map(recordFromUnknown)) {
      if (valueAt(section, ['inlineEvidence']) !== 'forbidden') blockers.push(`native-platform-inline-section-evidence-forbidden:${id}`);
      if (stringArrayAt(section, ['resultRefs']).length === 0) blockers.push(`native-platform-section-ref-required:${id}`);
    }
  }
  return blockers;
}

function hasRealNativePlatformCandidatePass(candidate: JsonRecord): boolean {
  if (stringField(candidate.status) !== 'passed' || valueAt(candidate, ['benchmarkClaim']) !== true) return false;
  const adapterCommandRef = stringField(candidate.adapterCommandRef);
  if (!adapterCommandRef.startsWith('env:SCIFORGE_BROWSER_NATIVE_ADAPTER_')) return false;
  if (valueAt(candidate, ['realAdapterResult']) !== true) return false;
  const adapterRunRef = stringField(candidate.adapterRunRef);
  const id = stringField(candidate.id);
  if (!id || !isRealNativePlatformAdapterRunRef(adapterRunRef, id)) return false;
  const proofRefs = recordAt(candidate, ['adapterProofRefs']);
  if (valueAt(proofRefs, ['proofMode']) !== 'real-native-adapter-run') return false;
  if (!isBrowserHostSessionRef(stringField(proofRefs.browserHostSessionRef))) return false;
  if (!isSessionScopedBrowserHostRef(stringField(proofRefs.liveSurfaceRef), stringField(proofRefs.browserHostSessionRef))) return false;
  if (!isRealNativePlatformProofRef(stringField(proofRefs.nativeAdapterSurfaceRef), id, 'native-adapter-surface')) return false;
  if (!isRealNativePlatformProofRef(stringField(proofRefs.actionTraceRef), id, 'action-trace')) return false;
  if (!isRealNativePlatformProofRef(stringField(proofRefs.platformResultRef), id, 'platform-summary')) return false;
  const diagnosticRefs = stringArrayAt(candidate, ['diagnosticRefs']);
  if (diagnosticRefs.some((ref) => hasNonRealNativePlatformProofToken(ref))) return false;
  const sections = arrayAt(candidate, ['metricSections']).map(recordFromUnknown);
  if (sections.length !== REAL_NATIVE_PLATFORM_METRIC_SECTIONS.length) return false;
  return sections.every((section) => (
    stringField(section.status) === 'passed'
      && valueAt(section, ['evidenceMode']) === 'bounded-summary-ref'
      && valueAt(section, ['inlineEvidence']) === 'forbidden'
      && stringArrayAt(section, ['resultRefs']).length > 0
      && stringArrayAt(section, ['resultRefs']).every((ref) => (
        isRealNativePlatformMetricRef(ref, id, stringField(section.section))
      ))
  ));
}

function isBrowserHostSessionRef(value: string): boolean {
  return /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}$/.test(value)
    && !hasNonRealNativePlatformProofToken(value);
}

function isSessionScopedBrowserHostRef(value: string, sessionRef: string): boolean {
  return /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}\/[a-zA-Z0-9_.:-]{1,80}$/.test(value)
    && value.startsWith(`${sessionRef}/`)
    && !hasNonRealNativePlatformProofToken(value);
}

function isRealNativePlatformAdapterRunRef(value: string, candidateId: string): boolean {
  return isRealNativePlatformProofRef(value, candidateId, 'platform-summary');
}

function isRealNativePlatformProofRef(value: string, candidateId: string, proofKind: string): boolean {
  return value.startsWith(`benchmark-result:${candidateId}:${proofKind}`)
    && /^[a-zA-Z0-9_./:-]{1,240}$/.test(value)
    && !hasNonRealNativePlatformProofToken(value);
}

function isRealNativePlatformMetricRef(value: string, candidateId: string, section: string): boolean {
  return REAL_NATIVE_PLATFORM_METRIC_SECTIONS.includes(section as typeof REAL_NATIVE_PLATFORM_METRIC_SECTIONS[number])
    && value.startsWith(`benchmark-result:${candidateId}:${section}:`)
    && /^[a-zA-Z0-9_./:-]{1,240}$/.test(value)
    && !hasNonRealNativePlatformProofToken(value);
}

function hasNonRealNativePlatformProofToken(value: string): boolean {
  return /blocked|fixture|schema-fixture|schema-validation-only|schema-only|no-real-native-adapter|partial/i.test(value);
}

function hasNativePlatformRefusalPolicy(manifest: JsonRecord): boolean {
  const policy = recordAt(manifest, ['externalAdapterCommandContract', 'realProofRefusalPolicy']);
  return stringField(policy.currentProcessPlatform) === process.platform
    && stringField(policy.unsupportedPlatformStatus) === 'blocked'
    && stringField(policy.missingCommandStatus) === 'blocked'
    && stringField(policy.schemaFixtureStatus) === 'blocked'
    && stringField(policy.failedCommandStatus) === 'failed'
    && valueAt(policy, ['partialPlatformResultsDoNotPass']) === true
    && valueAt(policy, ['passRequiresEveryCandidateRealResult']) === true;
}

function validateNativePlatformSupportFlags(manifest: JsonRecord): string[] {
  const blockers: string[] = [];
  const commandEnv = recordAt(manifest, ['externalAdapterCommandContract', 'perCandidateCommandEnv']);
  for (const [candidateId, value] of Object.entries(commandEnv)) {
    const entry = recordFromUnknown(value);
    const expected = nativePlatformSupported(stringField(entry.platform));
    if (valueAt(entry, ['supportedOnCurrentPlatform']) !== expected) {
      blockers.push(`native-platform-supported-flag-mismatch:${candidateId}`);
    }
  }
  return blockers;
}

function nativePlatformSupported(platform: string): boolean {
  if (platform === 'cross-platform') return true;
  if (platform === 'macos') return process.platform === 'darwin';
  if (platform === 'windows') return process.platform === 'win32';
  if (platform === 'linux') return process.platform === 'linux';
  return false;
}

function hasInputOsUiRun(manifest: JsonRecord): boolean {
  const run = recordAt(manifest, ['osUiRun']);
  const sessionRef = stringField(run.browserHostSessionRef);
  const liveSurfaceRef = stringField(run.liveSurfaceRef);
  const auditRefs = stringArrayAt(run, ['auditRefs']);
  return stringField(run.productSurface) === 'right-pane-browser'
    && sessionRef.startsWith('browser-host-session:')
    && liveSurfaceRef.startsWith('browser-host-session:')
    && auditRefs.length >= 3
    && auditRefs.every((ref) => ref.startsWith('browser-host-session:'));
}

function hasInputComposerIsolationProof(manifest: JsonRecord): boolean {
  const audit = recordAt(manifest, ['osUiRun', 'composerAudit']);
  const inputRefs = stringArrayAt(audit, ['browserHostSessionInputRefs']);
  return (numberField(audit, 'shellComposerCapturedCharacters') ?? -1) === 0
    && (numberField(audit, 'shellComposerTargetedActions') ?? -1) === 0
    && stringField(audit.composerAuditRef).startsWith('browser-host-session:')
    && inputRefs.length >= 4
    && inputRefs.every((ref) => ref.startsWith('browser-host-session:'));
}

function hasInputOsUiAuditProofs(manifest: JsonRecord): boolean {
  const proofs = arrayAt(manifest, ['osUiRun', 'auditProofs']).map(recordFromUnknown);
  const proofKinds = new Set(proofs.map((proof) => stringField(proof.kind)));
  return ['window-focus-owner', 'ime-candidate-window-owner', 'system-clipboard-owner', 'selection-range-owner'].every((kind) => proofKinds.has(kind))
    && proofs.every((proof) => (
      stringField(proof.owner) === 'BrowserHostSession'
        && stringField(proof.auditRef).startsWith('browser-host-session:')
        && stringField(proof.browserHostSessionRef).startsWith('browser-host-session:')
        && stringField(proof.liveSurfaceRef).startsWith('browser-host-session:')
        && valueAt(proof, ['rawPayloadRecorded']) === false
        && stringField(proof.shellComposerTarget) === 'not-targeted'
    ));
}

function hasInputOsUiRunRefCohesion(manifest: JsonRecord): boolean {
  const run = recordAt(manifest, ['osUiRun']);
  const runScope = browserHostRefScope(stringField(run.browserHostSessionRef));
  if (!runScope || !browserHostRefBelongsToScope(stringField(run.liveSurfaceRef), runScope)) return false;
  const refs = [
    stringField(run.frameStreamRef),
    ...stringArrayAt(run, ['auditRefs']),
    ...arrayAt(run, ['auditProofs']).map(recordFromUnknown).flatMap((proof) => [
      stringField(proof.auditRef),
      stringField(proof.browserHostSessionRef),
      stringField(proof.liveSurfaceRef),
    ]),
    stringAt(run, ['composerAudit', 'composerAuditRef']),
    ...stringArrayAt(run, ['composerAudit', 'browserHostSessionInputRefs']),
    ...inputCapabilityProductActionRefs(manifest),
    ...inputCapabilityDetailRefs(recordAt(manifest, ['capabilities', 'ime'])),
    ...inputCapabilityDetailRefs(recordAt(manifest, ['capabilities', 'clipboard'])),
    ...inputCapabilityDetailRefs(recordAt(manifest, ['capabilities', 'selectionRange'])),
  ].filter(Boolean);
  return refs.length > 0 && refs.every((ref) => browserHostRefBelongsToScope(ref, runScope));
}

function hasInputImeProof(capability: JsonRecord): boolean {
  const details = recordAt(capability, ['details']);
  const phases = new Set(arrayAt(details, ['compositionEvents']).map((event) => stringAt(event, ['phase'])));
  return stringField(capability.status) === 'passed'
    && stringField(details.kind) === 'ime-composition'
    && valueAt(details, ['realImeCandidateWindowVerified']) === true
    && stringAt(details, ['candidateWindowEvidenceRef']).startsWith('browser-host-session:')
    && phases.has('compositionstart')
    && phases.has('compositionupdate')
    && phases.has('compositionend')
    && arrayAt(details, ['compositionEvents']).every((event) => (
      stringAt(event, ['owner']) === 'BrowserHostSession'
        && stringAt(event, ['eventRef']).startsWith('browser-host-session:')
        && valueAt(event, ['rawCompositionPayloadRecorded']) === false
        && stringAt(event, ['shellComposerTarget']) === 'not-targeted'
    ));
}

function hasInputClipboardProof(capability: JsonRecord): boolean {
  const details = recordAt(capability, ['details']);
  const operations = new Set(arrayAt(details, ['operations']).map((event) => stringAt(event, ['operation'])));
  return stringField(capability.status) === 'passed'
    && valueAt(capability, ['systemClipboardRoundTripVerified']) === true
    && stringField(details.kind) === 'clipboard-round-trip'
    && valueAt(details, ['systemClipboardRoundTripVerified']) === true
    && stringField(details.highRiskWriteConfirmation) === 'required-and-observed'
    && operations.has('copy')
    && operations.has('paste')
    && operations.has('cut')
    && arrayAt(details, ['operations']).every((event) => (
      stringAt(event, ['owner']) === 'BrowserHostSession'
        && stringAt(event, ['actionRef']).startsWith('browser-host-session:')
        && stringAt(event, ['roundTripRef']).startsWith('browser-host-session:')
        && (numberAt(event, ['payloadLength']) ?? 0) > 0
        && isBoundedHash(stringAt(event, ['payloadHashSha256']))
        && valueAt(event, ['rawClipboardPayloadRecorded']) === false
        && stringAt(event, ['shellComposerTarget']) === 'not-targeted'
    ));
}

function hasInputSelectionProof(capability: JsonRecord): boolean {
  const details = recordAt(capability, ['details']);
  const targets = new Set(stringArrayAt(details, ['targets']));
  return stringField(capability.status) === 'passed'
    && valueAt(capability, ['selectedLengthOnly']) === true
    && valueAt(capability, ['selectedHashOnly']) === true
    && stringField(details.kind) === 'selection-range'
    && targets.has('input')
    && targets.has('contenteditable')
    && targets.has('page-text')
    && arrayAt(details, ['ranges']).length >= 3
    && arrayAt(details, ['ranges']).every((range) => (
      stringAt(range, ['owner']) === 'BrowserHostSession'
        && stringAt(range, ['rangeRef']).startsWith('browser-host-session:')
        && (numberAt(range, ['selectedLength']) ?? 0) > 0
        && isBoundedHash(stringAt(range, ['selectedHashSha256']))
        && valueAt(range, ['rawSelectionTextRecorded']) === false
        && valueAt(range, ['rawDomRecorded']) === false
    ));
}

function inputCapabilityProductActionRefs(manifest: JsonRecord): string[] {
  return ['cursorCaret', 'mouse', 'keyboard', 'ime', 'clipboard', 'selectionRange']
    .flatMap((capabilityName) => stringArrayAt(manifest, ['capabilities', capabilityName, 'productActionRefs']));
}

function inputCapabilityDetailRefs(capability: JsonRecord): string[] {
  const details = recordAt(capability, ['details']);
  const kind = stringField(details.kind);
  if (kind === 'ime-composition') {
    return [
      stringField(details.candidateWindowEvidenceRef),
      ...arrayAt(details, ['compositionEvents']).map((event) => stringAt(event, ['eventRef'])),
    ].filter(Boolean);
  }
  if (kind === 'clipboard-round-trip') {
    return arrayAt(details, ['operations']).flatMap((operation) => [
      stringAt(operation, ['actionRef']),
      stringAt(operation, ['roundTripRef']),
    ]).filter(Boolean);
  }
  if (kind === 'selection-range') {
    return arrayAt(details, ['ranges']).map((range) => stringAt(range, ['rangeRef'])).filter(Boolean);
  }
  return [];
}

function hasMouseGestureOsUiRunRefCohesion(acceptance: JsonRecord): boolean {
  const run = recordAt(acceptance, ['osUiRun']);
  const runScope = browserHostRefScope(stringField(run.browserHostSessionRef));
  if (!runScope || !browserHostRefBelongsToScope(stringField(run.liveSurfaceRef), runScope)) return false;
  const refs = [
    stringAt(run, ['composerAudit', 'composerAuditRef']),
    ...arrayAt(run, ['auditProofs']).map(recordFromUnknown).flatMap((proof) => [
      stringField(proof.auditRef),
      stringField(proof.browserHostSessionRef),
      stringField(proof.liveSurfaceRef),
    ]),
  ].filter(Boolean);
  return refs.length > 0 && refs.every((ref) => browserHostRefBelongsToScope(ref, runScope));
}

function validateSharedBrowserEvidence(
  manifest: JsonRecord,
  label: 'bottleneck' | 'dogfood' | 'real-external-dogfood' | 'long-session' | 'webrtc-bridge' | 'native-platform-benchmark' | 'input-fidelity' | 'mouse-gesture',
): string[] {
  const blockers: string[] = [];
  const serialized = JSON.stringify(manifest);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) blockers.push(`${label}-manifest-must-stay-bounded`);
  if (/<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|iVBORw0KGgo/i.test(serialized)) {
    blockers.push(`${label}-raw-payloads-forbidden`);
  }
  if (/"(?:screenshotData|screenshotBase64|screenshotInline|screenshotBytes|domSnapshotPayload|rawDomPayload|providerBody|providerRequest|providerResponse|rawProviderResponse|clipboardText|selectionText|compositionText|rawPayload)"\s*:/i.test(serialized)) {
    blockers.push(`${label}-raw-payload-keys-forbidden`);
  }
  const forbidden = recordAt(manifest, ['forbiddenEvidence']);
  if (Object.values(forbidden).some((value) => value !== false)) blockers.push(`${label}-forbidden-evidence-flags-must-be-false`);
  const fallbacks = recordAt(manifest, ['forbiddenFallbacks']);
  if (Object.values(fallbacks).some((value) => value !== false)) blockers.push(`${label}-forbidden-fallbacks-must-be-false`);
  return blockers;
}

function assertLatencyCategories(categories: unknown[], required: string[], blockers: string[]): void {
  const byCategory = new Map(categories.map((entry) => [stringField(recordField(entry, 'category')), recordFromUnknown(entry)]));
  for (const category of required) {
    const entry = byCategory.get(category);
    if (!entry || (numberField(entry, 'sampleCount') ?? 0) <= 0) blockers.push(`latency-category-missing:${category}`);
    if (entry && (numberField(entry, 'p95Ms') ?? 0) > (numberField(entry, 'maxMs') ?? 0)) blockers.push('latency-p95-must-not-exceed-max');
  }
}

function assertLatencyRecord(record: JsonRecord, required: string[], blockers: string[]): void {
  for (const category of required) {
    const entry = recordFromUnknown(record[category]);
    if ((numberField(entry, 'sampleCount') ?? 0) <= 0) blockers.push(`latency-category-missing:${category}`);
    if ((numberField(entry, 'p95Ms') ?? 0) > (numberField(entry, 'maxMs') ?? 0)) blockers.push('latency-p95-must-not-exceed-max');
  }
}

function assertObjectUrlCounts(memory: JsonRecord, rightPaneObjectUrls: JsonRecord, blockers: string[]): void {
  const created = numberField(memory, 'objectUrlCreateCountBeforeRestart') ?? 0;
  const revoked = numberField(memory, 'objectUrlRevokeCountBeforeRestart') ?? 0;
  const live = numberField(memory, 'objectUrlLiveEstimateBeforeRestart') ?? 0;
  const maxLive = numberField(memory, 'objectUrlMaxLiveEstimateBeforeRestart') ?? 0;
  const deficit = numberField(memory, 'objectUrlRevokeDeficitBeforeRestart') ?? 0;
  if (created < 0 || revoked < 0 || live < 0 || maxLive < live) blockers.push('object-url-counts-must-be-nonnegative');
  if (deficit !== Math.max(0, created - revoked) || live !== deficit) blockers.push('object-url-counts-must-balance');
  if (numberField(rightPaneObjectUrls, 'createCount') !== created
    || numberField(rightPaneObjectUrls, 'revokeCount') !== revoked
    || numberField(rightPaneObjectUrls, 'liveEstimate') !== live
    || numberField(rightPaneObjectUrls, 'maxLiveEstimate') !== maxLive
    || numberField(rightPaneObjectUrls, 'revokeDeficit') !== deficit) {
    blockers.push('object-url-right-pane-and-memoryish-counts-must-match');
  }
}

function assertSessionScopedRef(
  manifest: JsonRecord,
  path: Array<string | number>,
  sessionId: string,
  suffix: string,
  blockers: string[],
  code: string,
): void {
  const ref = stringAt(manifest, path);
  if (!sessionId || ref !== `browser-host-session:${sessionId}/${suffix}`) blockers.push(code);
}

function assertOptionalSessionScopedRef(
  manifest: JsonRecord,
  path: Array<string | number>,
  sessionId: string,
  suffix: string,
  blockers: string[],
  code: string,
): void {
  const ref = stringAt(manifest, path);
  if (ref && (!sessionId || ref !== `browser-host-session:${sessionId}/${suffix}`)) blockers.push(code);
}

function hasLowLevelDragRoute(actions: string[]): boolean {
  return actions.includes('mouse-down') && actions.includes('mouse-up') && (actions.includes('mouse-move') || actions.includes('cursor'));
}

function boundedCountsContain(value: unknown, path: Array<string | number>, expected: string): boolean {
  return arrayAt(value, path)
    .map(recordFromUnknown)
    .some((entry) => stringField(entry.value) === expected && (numberField(entry, 'count') ?? 0) > 0);
}

function isBoundedHash(value: string): boolean {
  return /^[a-f0-9]{16,64}$/.test(value);
}

function browserHostRefScope(ref: string): string | undefined {
  if (!ref.startsWith('browser-host-session:')) return undefined;
  const slash = ref.lastIndexOf('/');
  return slash > 'browser-host-session:'.length ? ref.slice(0, slash) : undefined;
}

function browserHostRefBelongsToScope(ref: string, scope: string): boolean {
  return ref === scope || ref.startsWith(`${scope}/`);
}

async function readRealExternalDogfoodManifest(): Promise<JsonRecord> {
  try {
    return await readManifest(REAL_EXTERNAL_DOGFOOD_MANIFEST);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return {
      schemaVersion: REAL_EXTERNAL_DOGFOOD_SCHEMA,
      status: 'blocked',
      runId: 'real-external-dogfood-not-generated',
      observedAt: new Date(0).toISOString(),
      shell: 'web-right-pane',
      targetEvidence: {
        mode: 'blocked-no-target-config',
        configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
        realExternalSiteClaim: false,
        hardcodedSitePassClaim: false,
        rawUrlCaptured: false,
        rawDomCaptured: false,
      },
      browserHostSession: {
        id: '',
        refs: {},
      },
      interactionCoverage: {
        openUrl: false,
        liveFrameVisible: false,
        scrollAttempted: false,
        reloadAttempted: false,
        textInputAttempted: false,
      },
      fallbackCounts: {
        iframe: 0,
        proxy: 0,
        systemPopup: 0,
        httpFrameLiveView: 0,
      },
      actionTimingSummary: [],
      blockedReason: 'real external dogfood artifact not generated in this checkout.',
      forbiddenFallbacks: {
        iframe: false,
        proxy: false,
        systemPopup: false,
        httpFrameLiveView: false,
        rawDom: false,
        base64: false,
      },
    };
  }
}

async function readManifest(path: string): Promise<JsonRecord> {
  let lastParseError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const text = await readFile(path, 'utf8');
    assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_MANIFEST_BYTES, `${path} must stay bounded`);
    try {
      return JSON.parse(text) as JsonRecord;
    } catch (error) {
      lastParseError = error;
      if (!(error instanceof SyntaxError) || attempt === 4) break;
      await delay(25 * (attempt + 1));
    }
  }
  throw lastParseError;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
}

function valueAt(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function setPath(value: JsonRecord, path: Array<string | number>, next: unknown): void {
  const parent = valueAt(value, path.slice(0, -1));
  if (parent && typeof parent === 'object') {
    (parent as Record<string | number, unknown>)[path[path.length - 1]] = next;
  }
}

function stringAt(value: unknown, path: Array<string | number>): string {
  return stringField(valueAt(value, path));
}

function numberAt(value: unknown, path: Array<string | number>): number | undefined {
  return numberField(recordFromUnknown({ value: valueAt(value, path) }), 'value');
}

function arrayAt(value: unknown, path: Array<string | number>): unknown[] {
  const item = valueAt(value, path);
  return Array.isArray(item) ? item : [];
}

function recordAt(value: unknown, path: Array<string | number>): JsonRecord {
  return recordFromUnknown(valueAt(value, path));
}

function stringArrayAt(value: unknown, path: Array<string | number>): string[] {
  return arrayAt(value, path).filter((item): item is string => typeof item === 'string');
}

function numberArrayAt(value: unknown, path: Array<string | number>): number[] {
  return arrayAt(value, path).filter((item): item is number => Number.isFinite(item));
}

function recordFromUnknown(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function recordField(value: unknown, field: string): unknown {
  return recordFromUnknown(value)[field];
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: JsonRecord, field: string): number | undefined {
  const item = value[field];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}
