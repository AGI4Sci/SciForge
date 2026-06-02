import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
} from '../../src/runtime/browser-host-session-types.js';
import {
  createBrowserHostWebRtcTransportBridgeManifest,
  validateBrowserHostWebRtcTransportBridgeManifest,
} from '../../src/runtime/browser-host-webrtc-transport.js';
import {
  createBrowserHostWebRtcTransportCandidate,
  type BrowserHostWebRtcContractSession,
  type BrowserHostWebRtcMetricSample,
} from '../../src/runtime/browser-host-webrtc-transport-contract.js';

const BRIDGE_SMOKE_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-bridge-smoke.v1' as const;
const BRIDGE_SMOKE_ARTIFACT_MODE = 'bounded-refs-and-contract-summary' as const;
const MAX_BRIDGE_SMOKE_ARTIFACT_BYTES = 48_000;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-host-webrtc-transport-bridge');
const manifestPath = resolve(artifactDir, 'manifest.json');

type WebRtcBridgeRightPaneRefusal = {
  status: 'blocked';
  claimScope: 'legacy-transport-diagnostic-only';
  passClaim: false;
  required: {
    liveSurfaceTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
  };
  observed: {
    transportEvidenceKind: 'webrtc-bridge-candidate';
    liveSurfaceTransport: 'host-stream';
    liveSurfaceTransportCandidate: 'webrtc-data-channel';
    singleInteractiveTruth: true;
    secondTruthSource: false;
  };
  passRefusalPolicy: {
    candidateContractDoesNotPass: true;
    loopbackSmokeDoesNotPass: true;
    httpFrameRouteDoesNotPass: true;
    secondTruthSourceDoesNotPass: true;
  };
};

test('BrowserHostSession WebRTC transport bridge manifest keeps signaling, frame messages, metrics, and input refs-first', () => {
  const candidate = createBrowserHostWebRtcTransportCandidate({
    session: deterministicSession('webrtc-bridge-positive'),
    kind: 'webrtc-data-channel',
    samples: deterministicSamples(),
  });
  const manifest = createBrowserHostWebRtcTransportBridgeManifest({
    candidate,
    observedAt: '2026-06-02T00:00:00.000Z',
    maxFrameMessages: 3,
  });
  const validation = validateBrowserHostWebRtcTransportBridgeManifest(manifest);

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.owner, 'BrowserHostSession');
  assert.equal(manifest.providerId, BROWSER_HOST_SESSION_PROVIDER_ID);
  assert.equal(manifest.refs.hostSessionRef, 'browser-host-session:webrtc-bridge-positive');
  assert.equal(manifest.refs.bridgeRef, 'browser-host-session:webrtc-bridge-positive/webrtc-transport/bridge');
  assert.equal(manifest.signaling.mode, 'refs-first');
  assert.equal(manifest.signaling.inlineSdp, false);
  assert.equal(manifest.signaling.inlineIceCandidates, false);
  assert.equal(manifest.metrics.inlineSamples, false);
  assert.equal(manifest.metrics.summary.sampleCount, 4);
  assert.equal(manifest.metrics.summary.totalDroppedFrames, 4);
  assert.equal(manifest.metrics.summary.totalSkippedBackpressure, 1);
  assert.equal(manifest.metrics.summary.totalSkippedRecentInput, 2);
  assert.equal(manifest.metrics.summary.backpressureEventCount, 1);
  assert.equal(manifest.actionChannel.owner, 'BrowserHostSession');
  assert.equal(manifest.actionChannel.integrationPoint, 'BrowserHostSessionManager.act');
  assert.equal(manifest.actionChannel.hotPathCapture, 'none');
  assert.ok(manifest.actionChannel.acceptedActions.includes('type'));
  assert.ok(manifest.actionChannel.acceptedActions.includes('drag'));
  assert.equal(manifest.rightPaneHandoff.status, 'candidate-contract');
  assert.equal(manifest.rightPaneHandoff.claim, 'bridge-to-right-pane-canvas-handoff-only');
  assert.equal(manifest.rightPaneHandoff.claimScope, 'candidate-only');
  assert.equal(manifest.rightPaneHandoff.owner, 'BrowserHostSession');
  assert.equal(manifest.rightPaneHandoff.rightPaneSurfaceOwner, 'BrowserHostSession');
  assert.equal(manifest.rightPaneHandoff.productSurface, 'right-pane-browser');
  assert.equal(manifest.rightPaneHandoff.renderTarget, 'canvas');
  assert.equal(manifest.rightPaneHandoff.frameRenderer, 'canvas-binary');
  assert.equal(manifest.rightPaneHandoff.frameTransport, 'webrtc-data-channel');
  assert.equal(manifest.rightPaneHandoff.fallbackTransport, 'websocket-binary');
  assert.equal(manifest.rightPaneHandoff.liveSurfaceTransportCandidate, 'webrtc-data-channel');
  assert.equal(manifest.rightPaneHandoff.hostSessionRef, manifest.refs.hostSessionRef);
  assert.equal(manifest.rightPaneHandoff.liveSurfaceRef, manifest.refs.liveSurfaceRef);
  assert.equal(manifest.rightPaneHandoff.frameStreamRef, manifest.refs.frameStreamRef);
  assert.equal(manifest.rightPaneHandoff.actionChannelRef, manifest.refs.actionChannelRef);
  assert.equal(manifest.rightPaneHandoff.metricsSummaryRef, manifest.metrics.summaryRef);
  assert.equal(manifest.rightPaneHandoff.inlineFrameBytes, false);
  assert.equal(manifest.rightPaneHandoff.inlineSignals, false);
  assert.equal(manifest.rightPaneHandoff.rawDomCaptured, false);
  assert.equal(manifest.rightPaneHandoff.secondViewer, false);
  assert.equal(manifest.rightPaneHandoff.secondTruthSource, false);
  assert.equal(manifest.rightPaneHandoff.httpFrameLiveFallback, false);
  assert.equal(manifest.rightPaneHandoff.iframe, false);
  assert.equal(manifest.rightPaneHandoff.proxy, false);
  assert.equal(manifest.rightPaneHandoff.snapshotViewer, false);
  assert.equal(manifest.rightPaneHandoff.fullyPassedClaim, false);
  assert.equal(manifest.rightPaneHandoff.realUiWebRtcPassClaim, false);
  assert.equal(manifest.rightPaneHandoff.loopbackEvidenceOnly, false);
  assert.equal(manifest.rightPaneHandoff.httpFrameRouteClaim, false);
  assert.equal(manifest.frameMessages.length, 3);
  assert.ok(manifest.frameMessages.every((message) => message.rawFramePayload === false && message.inlineFrameBytes === false));
  assert.equal(manifest.bridge.productIntegration, 'BrowserHostSession-owner-transport-bridge');
  assert.equal(manifest.bridge.secondViewer, false);
  assert.equal(manifest.bridge.rawPayloadsCaptured, false);
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.singleInteractiveTruth, true);
  assert.equal(manifest.secondTruthSource, false);
  assert.equal(manifest.rawPayloadsCaptured, false);

  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /data:image|;base64,|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(serialized, /\bv=0\r?\n|a=candidate:|candidate:[0-9]+ [0-9]+ udp/i);

	  const evidence = {
	    schemaVersion: BRIDGE_SMOKE_SCHEMA,
	    status: 'diagnostic',
	    observedAt: new Date().toISOString(),
	    refsFirst: true,
	    artifactPayloadMode: BRIDGE_SMOKE_ARTIFACT_MODE,
	    claimScope: 'legacy-transport-diagnostic-only',
	    rightPaneLiveAcceptance: legacyWebRtcBridgeRightPaneRefusal(),
	    refs: {
      hostSessionRef: manifest.refs.hostSessionRef,
      bridgeRef: manifest.refs.bridgeRef,
      candidateRef: manifest.refs.candidateRef,
      feasibilityReportRef: manifest.refs.feasibilityReportRef,
      signalingRef: manifest.refs.signalingRef,
      sdpRef: manifest.signaling.sdpRef,
      iceCandidateRef: manifest.signaling.iceCandidateRef,
      frameMessageListRef: manifest.refs.frameMessageListRef,
      actionChannelRef: manifest.refs.actionChannelRef,
      metricsSummaryRef: manifest.metrics.summaryRef,
      metricsSamplesRef: manifest.metrics.samplesRef,
    },
    boundedEvidence: {
      maxFrameMessages: manifest.frameMessages.length,
      bridgeContractInline: true,
      sourceContractInline: true,
      inputPriorityContractInline: true,
      rightPaneHandoffInline: true,
      realLongRunHandoffInline: true,
      inlinePayloadsCaptured: false,
      rawSignalsCaptured: false,
      rawFramePayloadsCaptured: false,
      rawDomCaptured: false,
      screenshotsCaptured: false,
      base64Captured: false,
      externalUrlCaptured: false,
    },
    inputPriorityContract: {
      schemaVersion: 'sciforge.browser-host-session.webrtc-transport-input-priority-handoff.v1',
      status: 'contract-only',
      owner: 'BrowserHostSession',
      actionChannelRef: manifest.refs.actionChannelRef,
      frameMessageListRef: manifest.refs.frameMessageListRef,
      hotPathCapture: manifest.actionChannel.hotPathCapture,
      highFrequencyActions: ['mouse-move', 'scroll', 'type'],
      staleCapturePolicy: 'drop-or-skip-stale-frame-capture-before-input-ack',
      screenshotQueuedBeforeInput: false,
      rawPayloadsCaptured: false,
      secondTruthSource: false,
      boundary: 'bounded-bridge-contract-not-real-ui-webrtc-stack',
    },
    rightPaneHandoffContract: {
      schemaVersion: 'sciforge.browser-host-session.webrtc-right-pane-handoff.v1',
      status: 'candidate-contract',
      claim: 'bridge-to-right-pane-canvas-handoff-only',
      claimScope: manifest.rightPaneHandoff.claimScope,
      owner: manifest.rightPaneHandoff.owner,
      rightPaneSurfaceOwner: manifest.rightPaneHandoff.rightPaneSurfaceOwner,
      productSurface: manifest.rightPaneHandoff.productSurface,
      frameRenderer: manifest.rightPaneHandoff.frameRenderer,
      frameTransport: manifest.rightPaneHandoff.frameTransport,
      liveSurfaceTransportCandidate: manifest.rightPaneHandoff.liveSurfaceTransportCandidate,
      fallbackTransport: manifest.rightPaneHandoff.fallbackTransport,
      refs: {
        hostSessionRef: manifest.rightPaneHandoff.hostSessionRef,
        liveSurfaceRef: manifest.rightPaneHandoff.liveSurfaceRef,
        frameStreamRef: manifest.rightPaneHandoff.frameStreamRef,
        actionChannelRef: manifest.rightPaneHandoff.actionChannelRef,
        metricsSummaryRef: manifest.rightPaneHandoff.metricsSummaryRef,
      },
      noSecondViewer: manifest.rightPaneHandoff.secondViewer === false && manifest.rightPaneHandoff.secondTruthSource === false,
      noHttpFrameLiveFallback: manifest.rightPaneHandoff.httpFrameLiveFallback === false,
      noInlineSignals: manifest.rightPaneHandoff.inlineSignals === false,
      noInlineFrameBytes: manifest.rightPaneHandoff.inlineFrameBytes === false,
      fullyPassedClaim: false,
      realUiWebRtcPassClaim: false,
      loopbackEvidenceOnly: false,
      httpFrameRouteClaim: false,
      boundary: 'right-pane-contract-recognizes-webrtc-data-channel-candidate-but-does-not-claim-real-ui-webrtc-long-run-pass',
    },
    realP95DropBackpressureLongRunHandoff: {
      schemaVersion: 'sciforge.browser-host-session.webrtc-transport-real-long-run-handoff.v1',
      status: 'blocked',
      blockedReason: 'real-ui-webrtc-stack-and-long-run-runner-not-implemented-in-this-smoke',
      benchmarkClaim: false,
      owner: 'BrowserHostSession',
      source: 'contract-smoke-not-real-ui-run',
      realUiRun: false,
      secondTruthSource: false,
      rawPayloadsCaptured: false,
      refs: {
        hostSessionRef: manifest.refs.hostSessionRef,
        bridgeRef: manifest.refs.bridgeRef,
        transportRef: manifest.refs.transportRef,
        metricsSummaryRef: manifest.metrics.summaryRef,
        metricsSamplesRef: manifest.metrics.samplesRef,
        rightPaneSurfaceRef: manifest.refs.liveSurfaceRef,
        actionChannelRef: manifest.refs.actionChannelRef,
      },
      requiredMetrics: [
        'sampleCount',
        'p95CaptureMs',
        'p95EncodeMs',
        'p95NetworkMs',
        'p95DecodeMs',
        'p95RenderMs',
        'p95EndToEndMs',
        'totalDroppedFrames',
        'totalSkippedBackpressure',
        'totalSkippedRecentInput',
        'backpressureEventCount',
        'dropRate',
      ],
      deterministicContractMetrics: {
        sampleCount: manifest.metrics.summary.sampleCount,
        p95EndToEndMs: manifest.metrics.summary.p95EndToEndMs,
        totalDroppedFrames: manifest.metrics.summary.totalDroppedFrames,
        totalSkippedBackpressure: manifest.metrics.summary.totalSkippedBackpressure,
        totalSkippedRecentInput: manifest.metrics.summary.totalSkippedRecentInput,
        backpressureEventCount: manifest.metrics.summary.backpressureEventCount,
        dropRate: manifest.metrics.summary.dropRate,
      },
      realRunProofRequirements: {
        source: 'real-right-pane-ui-webrtc-run',
        realUiRun: true,
        productSurface: 'right-pane-browser',
        transportEvidenceKind: 'real-ui-webrtc-data-channel-live-stack',
        hostSessionRefPrefix: 'browser-host-session:',
        rightPaneSurfaceRefPrefix: 'browser-host-session:',
        metricsSamplesRefPrefix: 'browser-host-session:',
        decoderMetricsRefPrefix: 'browser-host-session:',
        objectUrlMetricsRefPrefix: 'browser-host-session:',
        minSampleCount: 120,
        requiredBoundedMetrics: [
          'p95EndToEndMs',
          'p95DecodeMs',
          'dropRate',
          'totalDroppedFrames',
          'totalSkippedBackpressure',
          'backpressureEventCount',
          'objectUrlCreateCount',
          'objectUrlRevokeCount',
          'objectUrlLiveEstimate',
          'objectUrlRevokeDeficit',
        ],
      },
      payloadPolicy: {
        refsFirst: true,
        inlineSamples: false,
        rawFramePayloads: false,
        rawSignals: false,
        rawDom: false,
      },
      passRefusalPolicy: {
        candidateContractDoesNotPass: true,
        loopbackSmokeDoesNotPass: true,
        httpFrameRouteDoesNotPass: true,
        secondTruthSourceDoesNotPass: true,
        deterministicContractMetricsDoNotPass: true,
      },
    },
    bridge: manifest,
    validation,
    forbiddenEvidence: {
      inlineSdp: false,
      inlineIceCandidates: false,
      rawFramePayloads: false,
      rawDom: false,
      iframe: false,
      proxy: false,
      secondViewer: false,
      systemPopup: false,
      screenshot: false,
      externalUrl: false,
    },
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-host-webrtc-transport-bridge.test.ts',
  };
  assert.equal(evidence.inputPriorityContract.screenshotQueuedBeforeInput, false);
  assert.equal(evidence.inputPriorityContract.status, 'contract-only');
  assert.equal(evidence.rightPaneHandoffContract.status, 'candidate-contract');
  assert.equal(evidence.rightPaneHandoffContract.frameTransport, 'webrtc-data-channel');
  assert.equal(evidence.rightPaneHandoffContract.noSecondViewer, true);
  assert.equal(evidence.rightPaneHandoffContract.fullyPassedClaim, false);
  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.status, 'blocked');
  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.benchmarkClaim, false);
	  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.realUiRun, false);
	  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.realRunProofRequirements.minSampleCount, 120);
	  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.deterministicContractMetrics.totalDroppedFrames, 4);
	  assert.equal(evidence.realP95DropBackpressureLongRunHandoff.deterministicContractMetrics.totalSkippedBackpressure, 1);
	  assertLegacyWebRtcBridgeRightPaneRefusal(evidence.rightPaneLiveAcceptance);
	  return writeEvidence(evidence);
	});

test('BrowserHostSession WebRTC transport bridge validator rejects inline payloads and second viewers', () => {
  const candidate = createBrowserHostWebRtcTransportCandidate({
    session: deterministicSession('webrtc-bridge-negative'),
    kind: 'webrtc-video-track',
    samples: deterministicSamples(),
  });
  const manifest = createBrowserHostWebRtcTransportBridgeManifest({ candidate });
  const invalid = {
    ...manifest,
    refsFirst: false,
    signaling: {
      ...manifest.signaling,
      inlineSdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
      inlineIceCandidates: true,
    },
    frameMessages: [{
      ...manifest.frameMessages[0],
      rawFramePayload: 'data:image/png;base64,fixture',
      inlineFrameBytes: true,
    }],
    bridge: {
      ...manifest.bridge,
      secondViewer: true,
      forbiddenLiveBackings: {
        ...manifest.bridge.forbiddenLiveBackings,
        secondViewer: true,
      },
    },
    rightPaneHandoff: {
      ...manifest.rightPaneHandoff,
      claimScope: 'real-ui-pass',
      fullyPassedClaim: true,
      realUiWebRtcPassClaim: true,
      loopbackEvidenceOnly: true,
      httpFrameRouteClaim: true,
      secondViewer: true,
      secondTruthSource: true,
      httpFrameLiveFallback: true,
      iframe: true,
      proxy: true,
      inlineSignals: true,
      inlineFrameBytes: true,
    },
    rawDom: '<iframe src="/api/sciforge/browser/proxy"></iframe>',
  };

  const validation = validateBrowserHostWebRtcTransportBridgeManifest(invalid);
  const errors = validation.errors.join('\n');
  assert.equal(validation.ok, false);
  assert.match(errors, /refsFirst must be true/);
  assert.match(errors, /signaling.inlineSdp must be false/);
  assert.match(errors, /signaling.inlineIceCandidates must be false/);
  assert.match(errors, /frameMessages\[0\]\.rawFramePayload must be false/);
  assert.match(errors, /frameMessages\[0\]\.inlineFrameBytes must be false/);
  assert.match(errors, /bridge.secondViewer must be false/);
  assert.match(errors, /bridge.forbiddenLiveBackings.secondViewer must be false/);
  assert.match(errors, /rightPaneHandoff.fullyPassedClaim must be false/);
  assert.match(errors, /rightPaneHandoff.realUiWebRtcPassClaim must be false/);
  assert.match(errors, /rightPaneHandoff.loopbackEvidenceOnly must be false/);
  assert.match(errors, /rightPaneHandoff.httpFrameRouteClaim must be false/);
  assert.match(errors, /rightPaneHandoff.secondViewer must be false/);
  assert.match(errors, /rightPaneHandoff.secondTruthSource must be false/);
  assert.match(errors, /rightPaneHandoff.httpFrameLiveFallback must be false/);
  assert.match(errors, /rightPaneHandoff.iframe must be false/);
  assert.match(errors, /rightPaneHandoff.proxy must be false/);
  assert.match(errors, /rightPaneHandoff.inlineSignals must be false/);
  assert.match(errors, /rightPaneHandoff.inlineFrameBytes must be false/);
  assert.match(errors, /inline payload|represented by a ref/);
});

function deterministicSession(id: string): BrowserHostWebRtcContractSession {
  return {
    id,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    liveSurfaceTransport: 'host-stream',
    liveSurfaceRef: `browser-host-session:${id}/live-surface`,
    frameStreamRef: `browser-host-session:${id}/frame-stream`,
    singleInteractiveTruth: true,
  };
}

function deterministicSamples(): BrowserHostWebRtcMetricSample[] {
  return Array.from({ length: 4 }, (_, index) => ({
    sequence: index + 1,
    observedAtMs: 1_000 + index * 16,
    captureMs: 3 + index,
    encodeMs: 4 + index,
    networkMs: 5 + index,
    decodeMs: 6 + index,
    renderMs: 4 + index,
    endToEndMs: 22 + index,
    frameBytes: 18_000 + index * 100,
    bufferedBytes: index === 1 ? 65_536 : index * 512,
    maxBufferedBytes: 65_536,
    droppedSinceLastFrame: [0, 1, 2, 1][index],
    skippedBackpressure: index === 1 ? 1 : 0,
    skippedBusy: index === 3 ? 1 : 0,
    skippedRecentInput: index === 2 ? 2 : 0,
  }));
}

function legacyWebRtcBridgeRightPaneRefusal(): WebRtcBridgeRightPaneRefusal {
  return {
    status: 'blocked',
    claimScope: 'legacy-transport-diagnostic-only',
    passClaim: false,
    required: {
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    observed: {
      transportEvidenceKind: 'webrtc-bridge-candidate',
      liveSurfaceTransport: 'host-stream',
      liveSurfaceTransportCandidate: 'webrtc-data-channel',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    passRefusalPolicy: {
      candidateContractDoesNotPass: true,
      loopbackSmokeDoesNotPass: true,
      httpFrameRouteDoesNotPass: true,
      secondTruthSourceDoesNotPass: true,
    },
  };
}

function assertLegacyWebRtcBridgeRightPaneRefusal(refusal: WebRtcBridgeRightPaneRefusal): void {
  assert.equal(refusal.status, 'blocked');
  assert.equal(refusal.claimScope, 'legacy-transport-diagnostic-only');
  assert.equal(refusal.passClaim, false);
  assert.equal(refusal.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(refusal.required.singleInteractiveTruth, true);
  assert.equal(refusal.required.secondTruthSource, false);
  assert.equal(refusal.observed.transportEvidenceKind, 'webrtc-bridge-candidate');
  assert.equal(refusal.observed.liveSurfaceTransport, 'host-stream');
  assert.equal(refusal.observed.liveSurfaceTransportCandidate, 'webrtc-data-channel');
  assert.equal(refusal.observed.singleInteractiveTruth, true);
  assert.equal(refusal.observed.secondTruthSource, false);
  assert.deepEqual(Object.values(refusal.passRefusalPolicy), [true, true, true, true]);
}

async function writeEvidence(evidence: unknown): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  assertBoundedRefsFirstArtifact(evidence);
  const record = objectRecord(evidence);
  if (record?.rightPaneLiveAcceptance) {
    assertLegacyWebRtcBridgeRightPaneRefusal(record.rightPaneLiveAcceptance as WebRtcBridgeRightPaneRefusal);
  }
  assertNoRawPayloads(text);
  await writeFile(manifestPath, text, 'utf8');
  const persistedText = await readFile(manifestPath, 'utf8');
  assertNoRawPayloads(persistedText);
  const persisted = JSON.parse(persistedText) as {
    refsFirst?: unknown;
    artifactPayloadMode?: unknown;
    bridge?: unknown;
    boundedEvidence?: { maxFrameMessages?: unknown };
  };
  assertBoundedRefsFirstArtifact(persisted);
  assert.equal(persisted.refsFirst, true);
  assert.equal(persisted.artifactPayloadMode, BRIDGE_SMOKE_ARTIFACT_MODE);
  assert.equal(persisted.boundedEvidence?.maxFrameMessages, 3);
  const persistedValidation = validateBrowserHostWebRtcTransportBridgeManifest(persisted.bridge);
  assert.equal(persistedValidation.ok, true, persistedValidation.errors.join('\n'));
}

function assertNoRawPayloads(text: string): void {
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_BRIDGE_SMOKE_ARTIFACT_BYTES, 'bridge smoke artifact must stay bounded');
  assert.doesNotMatch(text, /data:image|;base64,|<\s*(?:!doctype|html|body|iframe|webview)\b/i);
  assert.doesNotMatch(text, /\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas|image\/(?:png|jpeg|webp)/i);
  assert.doesNotMatch(text, /\bv=0\r?\n|a=candidate:|\bcandidate:[0-9]+ [0-9]+ udp/i);
  assert.doesNotMatch(text, /https?:\/\/|file:\/\/|\.png\b|\.jpe?g\b|\.webp\b/i);
}

function assertBoundedRefsFirstArtifact(value: unknown): void {
  const record = objectRecord(value);
  assert.ok(record, 'bridge smoke artifact must be an object');
  assert.equal(record.schemaVersion, BRIDGE_SMOKE_SCHEMA);
  assert.equal(record.refsFirst, true);
  assert.equal(record.artifactPayloadMode, BRIDGE_SMOKE_ARTIFACT_MODE);
  assert.equal(objectRecord(record.boundedEvidence)?.inlinePayloadsCaptured, false);
  assert.equal(objectRecord(record.boundedEvidence)?.screenshotsCaptured, false);
  assertNoForbiddenInlineArtifactFields(value, '$', new WeakSet<object>());
}

function assertNoForbiddenInlineArtifactFields(value: unknown, path: string, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    assertNoRawPayloads(JSON.stringify(value));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (isForbiddenInlineArtifactKey(key)) {
      assert.ok(
        child === false || child === '' || isAllowedSignalRef(key, child),
        `${childPath} must be false or represented by a bounded ref`,
      );
    }
    assertNoForbiddenInlineArtifactFields(child, childPath, seen);
  }
}

function isForbiddenInlineArtifactKey(key: string): boolean {
  return [
    'sdp',
    'sdpoffer',
    'sdpanswer',
    'inlinesdp',
    'inlinesdppayload',
    'icecandidate',
    'icecandidates',
    'inlineicecandidate',
    'inlineicecandidates',
    'inlineicecandidatepayload',
    'rawdom',
    'domsnapshot',
    'html',
    'htmlpayload',
    'base64',
    'dataurl',
    'framebytes',
    'framedata',
    'framepayload',
    'rawframe',
    'rawframepayload',
    'screenshot',
    'screenshotpath',
    'screenshotref',
    'screenshotrefs',
    'proxyurl',
    'iframeurl',
    'viewerurl',
    'externalurl',
  ].includes(key.toLowerCase());
}

function isAllowedSignalRef(key: string, value: unknown): boolean {
  return (
    typeof value === 'string'
    && /ref$/i.test(key)
    && /^browser-host-session:[^<>"'\s]+$/.test(value)
  );
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
