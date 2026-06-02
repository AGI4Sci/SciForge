import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  type BrowserHostSessionAction,
} from './browser-host-session-types.js';
import {
  BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA,
  BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA,
  browserHostWebRtcTransportFeasibilityReport,
  browserHostWebRtcTransportRefs,
  validateBrowserHostWebRtcTransportCandidate,
  type BrowserHostWebRtcMediaContract,
  type BrowserHostWebRtcMetricsSummary,
  type BrowserHostWebRtcTransportCandidate,
  type BrowserHostWebRtcTransportFeasibilityReport,
  type BrowserHostWebRtcTransportRefs,
} from './browser-host-webrtc-transport-contract.js';

export const BROWSER_HOST_WEBRTC_TRANSPORT_BRIDGE_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-bridge.v1' as const;
export const BROWSER_HOST_WEBRTC_FRAME_REF_MESSAGE_SCHEMA = 'sciforge.browser-host-session.webrtc-frame-ref-message.v1' as const;

export const BROWSER_HOST_WEBRTC_BRIDGE_ACTIONS = [
  'navigate',
  'back',
  'forward',
  'reload',
  'stop',
  'click',
  'double-click',
  'mouse-down',
  'mouse-move',
  'mouse-up',
  'drag',
  'type',
  'press',
  'scroll',
  'cursor',
  'close',
] as const satisfies readonly BrowserHostSessionAction[];

export interface BrowserHostWebRtcTransportBridgeRefs extends BrowserHostWebRtcTransportRefs {
  bridgeRef: string;
  candidateRef: string;
  feasibilityReportRef: string;
  frameMessageListRef: string;
  actionChannelRef: string;
}

export interface BrowserHostWebRtcTransportBridgeSignalingRefs {
  mode: 'refs-first';
  signalingRef: string;
  sdpRef: string;
  iceCandidateRef: string;
  inlineSdp: false;
  inlineIceCandidates: false;
}

export interface BrowserHostWebRtcTransportBridgeMetricsRefs {
  metricsRef: string;
  summaryRef: string;
  samplesRef: string;
  inlineSamples: false;
  summary: BrowserHostWebRtcMetricsSummary;
}

export interface BrowserHostWebRtcTransportBridgeActionChannel {
  owner: 'BrowserHostSession';
  integrationPoint: 'BrowserHostSessionManager.act';
  hostSessionRef: string;
  actionChannelRef: string;
  acceptedActions: readonly BrowserHostSessionAction[];
  hotPathCapture: 'none';
  ackMode: 'bounded-action-ack';
}

export interface BrowserHostWebRtcRightPaneHandoffContract {
  status: 'candidate-contract';
  claim: 'bridge-to-right-pane-canvas-handoff-only';
  claimScope: 'candidate-only';
  owner: 'BrowserHostSession';
  shell: 'web-shell';
  rightPaneSurfaceOwner: 'BrowserHostSession';
  productSurface: 'right-pane-browser';
  renderTarget: 'canvas';
  frameRenderer: 'canvas-binary';
  frameTransport: 'webrtc-data-channel';
  fallbackTransport: 'websocket-binary';
  liveSurfaceTransportCandidate: 'webrtc-data-channel';
  hostSessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  actionChannelRef: string;
  metricsSummaryRef: string;
  inlineFrameBytes: false;
  inlineSignals: false;
  rawDomCaptured: false;
  secondViewer: false;
  secondTruthSource: false;
  httpFrameLiveFallback: false;
  iframe: false;
  proxy: false;
  snapshotViewer: false;
  fullyPassedClaim: false;
  realUiWebRtcPassClaim: false;
  loopbackEvidenceOnly: false;
  httpFrameRouteClaim: false;
}

export interface BrowserHostWebRtcRealLongRunHandoffContract {
  schemaVersion: 'sciforge.browser-host-session.webrtc-transport-real-long-run-handoff.v1';
  status: 'blocked';
  blockedReason: string;
  benchmarkClaim: false;
  owner: 'BrowserHostSession';
  source: 'contract-smoke-not-real-ui-run';
  realUiRun: false;
  secondTruthSource: false;
  rawPayloadsCaptured: false;
  refs: {
    hostSessionRef: string;
    bridgeRef: string;
    transportRef: string;
    metricsSummaryRef: string;
    metricsSamplesRef: string;
    decoderMetricsRef: string;
    objectUrlMetricsRef: string;
    rightPaneSurfaceRef: string;
    actionChannelRef: string;
  };
  requiredMetrics: readonly string[];
  deterministicContractMetrics: {
    sampleCount: number;
    p95EndToEndMs: number;
    p95DecodeMs: number;
    totalDroppedFrames: number;
    totalSkippedBackpressure: number;
    totalSkippedRecentInput: number;
    backpressureEventCount: number;
    dropRate: number;
  };
  realRunProofRequirements: {
    source: 'real-right-pane-ui-webrtc-run';
    realUiRun: true;
    productSurface: 'right-pane-browser';
    transportEvidenceKind: 'real-ui-webrtc-data-channel-live-stack';
    hostSessionRefPrefix: 'browser-host-session:';
    rightPaneSurfaceRefPrefix: 'browser-host-session:';
    metricsSamplesRefPrefix: 'browser-host-session:';
    decoderMetricsRefPrefix: 'browser-host-session:';
    objectUrlMetricsRefPrefix: 'browser-host-session:';
    minSampleCount: 120;
    requiredBoundedMetrics: readonly string[];
  };
  payloadPolicy: {
    refsFirst: true;
    inlineSamples: false;
    rawFramePayloads: false;
    rawSignals: false;
    rawDom: false;
  };
  passRefusalPolicy: {
    candidateContractDoesNotPass: true;
    loopbackSmokeDoesNotPass: true;
    httpFrameRouteDoesNotPass: true;
    secondTruthSourceDoesNotPass: true;
    deterministicContractMetricsDoNotPass: true;
  };
}

export interface BrowserHostWebRtcFrameRefMessage {
  schemaVersion: typeof BROWSER_HOST_WEBRTC_FRAME_REF_MESSAGE_SCHEMA;
  type: 'browser-host-frame-ref';
  sequence: number;
  transportRef: string;
  mediaRef: string;
  frameRef: string;
  metricsSampleRef: string;
  payloadMode: BrowserHostWebRtcMediaContract['framePayloadMode'];
  rawFramePayload: false;
  inlineFrameBytes: false;
}

export interface BrowserHostWebRtcTransportBridgeManifest {
  schemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_BRIDGE_SCHEMA;
  observedAt: string;
  owner: 'BrowserHostSession';
  providerId: typeof BROWSER_HOST_SESSION_PROVIDER_ID;
  sessionId: string;
  candidateSchemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA;
  feasibilitySchemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA;
  refs: BrowserHostWebRtcTransportBridgeRefs;
  browserHostSession: BrowserHostWebRtcTransportCandidate['browserHostSession'];
  signaling: BrowserHostWebRtcTransportBridgeSignalingRefs;
  media: BrowserHostWebRtcMediaContract;
  metrics: BrowserHostWebRtcTransportBridgeMetricsRefs;
  actionChannel: BrowserHostWebRtcTransportBridgeActionChannel;
  rightPaneHandoff: BrowserHostWebRtcRightPaneHandoffContract;
  realP95DropBackpressureLongRunHandoff: BrowserHostWebRtcRealLongRunHandoffContract;
  frameMessages: BrowserHostWebRtcFrameRefMessage[];
  bridge: {
    adapterRole: 'display-input-adapter';
    shell: 'web-shell';
    renderTarget: 'canvas';
    liveSurfaceTransport: 'host-stream';
    candidateRef: string;
    feasibilityReportRef: string;
    candidateValidationOk: boolean;
    productIntegration: 'BrowserHostSession-owner-transport-bridge';
    secondViewer: false;
    rawPayloadsCaptured: false;
    forbiddenLiveBackings: BrowserHostWebRtcTransportCandidate['adapter']['forbiddenLiveBackings'];
  };
  source: {
    candidate: BrowserHostWebRtcTransportCandidate;
    feasibilityReport: BrowserHostWebRtcTransportFeasibilityReport;
  };
  refsFirst: true;
  singleInteractiveTruth: true;
  secondTruthSource: false;
  rawPayloadsCaptured: false;
}

export interface BrowserHostWebRtcTransportBridgeValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function browserHostWebRtcTransportBridgeRefs(sessionId: string): BrowserHostWebRtcTransportBridgeRefs {
  const refs = browserHostWebRtcTransportRefs(sessionId);
  return {
    ...refs,
    bridgeRef: `${refs.transportRef}/bridge`,
    candidateRef: `${refs.transportRef}/candidate`,
    feasibilityReportRef: `${refs.transportRef}/feasibility-report`,
    frameMessageListRef: `${refs.transportRef}/frame-ref-messages`,
    actionChannelRef: `browser-host-session:${sessionId}/actions`,
  };
}

export function createBrowserHostWebRtcTransportBridgeManifest(input: {
  candidate: BrowserHostWebRtcTransportCandidate;
  feasibilityReport?: BrowserHostWebRtcTransportFeasibilityReport;
  observedAt?: string;
  maxFrameMessages?: number;
}): BrowserHostWebRtcTransportBridgeManifest {
  const sessionId = input.candidate.browserHostSession.id;
  const refs = browserHostWebRtcTransportBridgeRefs(sessionId);
  const feasibilityReport = input.feasibilityReport ?? browserHostWebRtcTransportFeasibilityReport(input.candidate);
  const candidateValidation = validateBrowserHostWebRtcTransportCandidate(input.candidate);
  return {
    schemaVersion: BROWSER_HOST_WEBRTC_TRANSPORT_BRIDGE_SCHEMA,
    observedAt: input.observedAt ?? new Date().toISOString(),
    owner: 'BrowserHostSession',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    sessionId,
    candidateSchemaVersion: input.candidate.schemaVersion,
    feasibilitySchemaVersion: feasibilityReport.schemaVersion,
    refs,
    browserHostSession: input.candidate.browserHostSession,
    signaling: {
      mode: 'refs-first',
      signalingRef: refs.signalingRef,
      sdpRef: input.candidate.signaling.sdpRef,
      iceCandidateRef: input.candidate.signaling.iceCandidateRef,
      inlineSdp: false,
      inlineIceCandidates: false,
    },
    media: input.candidate.media,
    metrics: {
      metricsRef: refs.metricsRef,
      summaryRef: `${refs.metricsRef}/summary`,
      samplesRef: `${refs.metricsRef}/samples`,
      inlineSamples: false,
      summary: input.candidate.metrics,
    },
    actionChannel: {
      owner: 'BrowserHostSession',
      integrationPoint: 'BrowserHostSessionManager.act',
      hostSessionRef: refs.hostSessionRef,
      actionChannelRef: refs.actionChannelRef,
      acceptedActions: BROWSER_HOST_WEBRTC_BRIDGE_ACTIONS,
      hotPathCapture: 'none',
      ackMode: 'bounded-action-ack',
    },
    rightPaneHandoff: {
      status: 'candidate-contract',
      claim: 'bridge-to-right-pane-canvas-handoff-only',
      claimScope: 'candidate-only',
      owner: 'BrowserHostSession',
      shell: 'web-shell',
      rightPaneSurfaceOwner: 'BrowserHostSession',
      productSurface: 'right-pane-browser',
      renderTarget: 'canvas',
      frameRenderer: 'canvas-binary',
      frameTransport: 'webrtc-data-channel',
      fallbackTransport: 'websocket-binary',
      liveSurfaceTransportCandidate: 'webrtc-data-channel',
      hostSessionRef: refs.hostSessionRef,
      liveSurfaceRef: refs.liveSurfaceRef,
      frameStreamRef: refs.frameStreamRef ?? `browser-host-session:${sessionId}/frame-stream`,
      actionChannelRef: refs.actionChannelRef,
      metricsSummaryRef: `${refs.metricsRef}/summary`,
      inlineFrameBytes: false,
      inlineSignals: false,
      rawDomCaptured: false,
      secondViewer: false,
      secondTruthSource: false,
      httpFrameLiveFallback: false,
      iframe: false,
      proxy: false,
      snapshotViewer: false,
      fullyPassedClaim: false,
      realUiWebRtcPassClaim: false,
      loopbackEvidenceOnly: false,
      httpFrameRouteClaim: false,
    },
    realP95DropBackpressureLongRunHandoff: browserHostWebRtcRealLongRunHandoffContract(input.candidate, refs),
    frameMessages: browserHostWebRtcFrameRefMessages(input.candidate, refs, input.maxFrameMessages),
    bridge: {
      adapterRole: input.candidate.adapter.role,
      shell: input.candidate.adapter.shell,
      renderTarget: input.candidate.adapter.renderTarget,
      liveSurfaceTransport: 'host-stream',
      candidateRef: refs.candidateRef,
      feasibilityReportRef: refs.feasibilityReportRef,
      candidateValidationOk: candidateValidation.ok,
      productIntegration: 'BrowserHostSession-owner-transport-bridge',
      secondViewer: false,
      rawPayloadsCaptured: false,
      forbiddenLiveBackings: input.candidate.adapter.forbiddenLiveBackings,
    },
    source: {
      candidate: input.candidate,
      feasibilityReport,
    },
    refsFirst: true,
    singleInteractiveTruth: true,
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  };
}

export function validateBrowserHostWebRtcTransportBridgeManifest(value: unknown): BrowserHostWebRtcTransportBridgeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifest = objectRecord(value);
  if (!manifest) {
    return { ok: false, errors: ['bridge manifest must be an object'], warnings };
  }

  if (manifest.schemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_BRIDGE_SCHEMA) errors.push('schemaVersion must be WebRTC transport bridge v1');
  if (manifest.owner !== 'BrowserHostSession') errors.push('owner must remain BrowserHostSession');
  if (manifest.providerId !== BROWSER_HOST_SESSION_PROVIDER_ID) errors.push('providerId must be sciforge.browser-host-session');
  if (manifest.candidateSchemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA) errors.push('candidateSchemaVersion must be WebRTC transport contract v1');
  if (manifest.feasibilitySchemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA) errors.push('feasibilitySchemaVersion must be WebRTC feasibility v1');
  if (manifest.refsFirst !== true) errors.push('refsFirst must be true');
  if (manifest.singleInteractiveTruth !== true) errors.push('singleInteractiveTruth must be true');
  if (manifest.secondTruthSource !== false) errors.push('secondTruthSource must be false');
  if (manifest.rawPayloadsCaptured !== false) errors.push('rawPayloadsCaptured must be false');

  const sessionId = typeof manifest.sessionId === 'string' ? manifest.sessionId : undefined;
  if (!sessionId) {
    errors.push('sessionId is required');
  } else {
    validateBridgeRefs(manifest.refs, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
    validateBridgeSignaling(manifest.signaling, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
    validateBridgeActionChannel(manifest.actionChannel, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
    validateRightPaneHandoff(manifest.rightPaneHandoff, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
    validateRealLongRunHandoff(manifest.realP95DropBackpressureLongRunHandoff, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
    validateBridgeFrameMessages(manifest.frameMessages, manifest.media, browserHostWebRtcTransportBridgeRefs(sessionId), errors);
  }

  const source = objectRecord(manifest.source);
  const candidateValidation = validateBrowserHostWebRtcTransportCandidate(source?.candidate);
  if (!candidateValidation.ok) errors.push(...candidateValidation.errors.map((error) => `source.candidate: ${error}`));
  warnings.push(...candidateValidation.warnings.map((warning) => `source.candidate: ${warning}`));
  validateBridgeSourceReport(source?.feasibilityReport, sessionId, errors);
  validateBridgeMetrics(manifest.metrics, source?.candidate, errors);
  validateBridgeAdapter(manifest.bridge, errors);
  collectInlinePayloadViolations(value, '$', errors, new WeakSet<object>());
  return { ok: errors.length === 0, errors, warnings };
}

function browserHostWebRtcFrameRefMessages(
  candidate: BrowserHostWebRtcTransportCandidate,
  refs: BrowserHostWebRtcTransportBridgeRefs,
  maxFrameMessages = 5,
): BrowserHostWebRtcFrameRefMessage[] {
  const count = Math.max(1, Math.min(maxFrameMessages, candidate.metrics.sampleCount || 1));
  const mediaRef = browserHostWebRtcMediaRef(candidate.media);
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      schemaVersion: BROWSER_HOST_WEBRTC_FRAME_REF_MESSAGE_SCHEMA,
      type: 'browser-host-frame-ref',
      sequence,
      transportRef: refs.transportRef,
      mediaRef,
      frameRef: `${refs.frameMessageListRef}/${String(sequence).padStart(4, '0')}`,
      metricsSampleRef: `${refs.metricsRef}/samples/${String(sequence).padStart(4, '0')}`,
      payloadMode: candidate.media.framePayloadMode,
      rawFramePayload: false,
      inlineFrameBytes: false,
    };
  });
}

function browserHostWebRtcRealLongRunHandoffContract(
  candidate: BrowserHostWebRtcTransportCandidate,
  refs: BrowserHostWebRtcTransportBridgeRefs,
): BrowserHostWebRtcRealLongRunHandoffContract {
  return {
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
      hostSessionRef: refs.hostSessionRef,
      bridgeRef: refs.bridgeRef,
      transportRef: refs.transportRef,
      metricsSummaryRef: `${refs.metricsRef}/summary`,
      metricsSamplesRef: `${refs.metricsRef}/samples`,
      decoderMetricsRef: `${refs.metricsRef}/decoder`,
      objectUrlMetricsRef: `${refs.metricsRef}/object-url-lifecycle`,
      rightPaneSurfaceRef: refs.liveSurfaceRef,
      actionChannelRef: refs.actionChannelRef,
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
      'objectUrlCreateCount',
      'objectUrlRevokeCount',
      'objectUrlLiveEstimate',
      'objectUrlRevokeDeficit',
    ],
    deterministicContractMetrics: {
      sampleCount: candidate.metrics.sampleCount,
      p95EndToEndMs: candidate.metrics.p95EndToEndMs,
      p95DecodeMs: candidate.metrics.p95DecodeMs,
      totalDroppedFrames: candidate.metrics.totalDroppedFrames,
      totalSkippedBackpressure: candidate.metrics.totalSkippedBackpressure,
      totalSkippedRecentInput: candidate.metrics.totalSkippedRecentInput,
      backpressureEventCount: candidate.metrics.backpressureEventCount,
      dropRate: candidate.metrics.dropRate,
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
  };
}

function browserHostWebRtcMediaRef(media: BrowserHostWebRtcMediaContract): string {
  return media.kind === 'webrtc-data-channel' ? media.dataChannelRef : media.videoTrackRef;
}

function validateBridgeRefs(refs: unknown, expected: BrowserHostWebRtcTransportBridgeRefs, errors: string[]): void {
  const record = objectRecord(refs);
  if (!record) {
    errors.push('refs are required');
    return;
  }
  for (const key of [
    'hostSessionRef',
    'liveSurfaceRef',
    'frameStreamRef',
    'transportRef',
    'signalingRef',
    'metricsRef',
    'bridgeRef',
    'candidateRef',
    'feasibilityReportRef',
    'frameMessageListRef',
    'actionChannelRef',
  ] as const) {
    if (record[key] !== expected[key]) errors.push(`refs.${key} must be ${expected[key]}`);
  }
}

function validateBridgeSignaling(signaling: unknown, refs: BrowserHostWebRtcTransportBridgeRefs, errors: string[]): void {
  const record = objectRecord(signaling);
  if (!record) {
    errors.push('signaling refs are required');
    return;
  }
  if (record.mode !== 'refs-first') errors.push('signaling.mode must be refs-first');
  if (record.signalingRef !== refs.signalingRef) errors.push('signaling.signalingRef must be the BrowserHostSession signaling ref');
  if (record.sdpRef !== `${refs.signalingRef}/sdp`) errors.push('signaling.sdpRef must be a BrowserHostSession ref');
  if (record.iceCandidateRef !== `${refs.signalingRef}/ice-candidates`) errors.push('signaling.iceCandidateRef must be a BrowserHostSession ref');
  if (record.inlineSdp !== false) errors.push('signaling.inlineSdp must be false');
  if (record.inlineIceCandidates !== false) errors.push('signaling.inlineIceCandidates must be false');
}

function validateBridgeActionChannel(actionChannel: unknown, refs: BrowserHostWebRtcTransportBridgeRefs, errors: string[]): void {
  const record = objectRecord(actionChannel);
  if (!record) {
    errors.push('actionChannel is required');
    return;
  }
  if (record.owner !== 'BrowserHostSession') errors.push('actionChannel.owner must remain BrowserHostSession');
  if (record.integrationPoint !== 'BrowserHostSessionManager.act') errors.push('actionChannel.integrationPoint must be BrowserHostSessionManager.act');
  if (record.hostSessionRef !== refs.hostSessionRef) errors.push('actionChannel.hostSessionRef must target the BrowserHostSession');
  if (record.actionChannelRef !== refs.actionChannelRef) errors.push('actionChannel.actionChannelRef must target BrowserHostSession actions');
  if (record.hotPathCapture !== 'none') errors.push('actionChannel.hotPathCapture must be none');
  if (record.ackMode !== 'bounded-action-ack') errors.push('actionChannel.ackMode must be bounded-action-ack');
  const acceptedActions = Array.isArray(record.acceptedActions) ? record.acceptedActions : [];
  for (const action of BROWSER_HOST_WEBRTC_BRIDGE_ACTIONS) {
    if (!acceptedActions.includes(action)) errors.push(`actionChannel.acceptedActions must include ${action}`);
  }
}

function validateRightPaneHandoff(handoff: unknown, refs: BrowserHostWebRtcTransportBridgeRefs, errors: string[]): void {
  const record = objectRecord(handoff);
  if (!record) {
    errors.push('rightPaneHandoff is required');
    return;
  }
  const expected: Record<string, unknown> = {
    status: 'candidate-contract',
    claim: 'bridge-to-right-pane-canvas-handoff-only',
    claimScope: 'candidate-only',
    owner: 'BrowserHostSession',
    shell: 'web-shell',
    rightPaneSurfaceOwner: 'BrowserHostSession',
    productSurface: 'right-pane-browser',
    renderTarget: 'canvas',
    frameRenderer: 'canvas-binary',
    frameTransport: 'webrtc-data-channel',
    fallbackTransport: 'websocket-binary',
    liveSurfaceTransportCandidate: 'webrtc-data-channel',
    hostSessionRef: refs.hostSessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    actionChannelRef: refs.actionChannelRef,
    metricsSummaryRef: `${refs.metricsRef}/summary`,
    inlineFrameBytes: false,
    inlineSignals: false,
    rawDomCaptured: false,
    secondViewer: false,
    secondTruthSource: false,
    httpFrameLiveFallback: false,
    iframe: false,
    proxy: false,
    snapshotViewer: false,
    fullyPassedClaim: false,
    realUiWebRtcPassClaim: false,
    loopbackEvidenceOnly: false,
    httpFrameRouteClaim: false,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) errors.push(`rightPaneHandoff.${key} must be ${String(value)}`);
  }
}

function validateRealLongRunHandoff(handoff: unknown, refs: BrowserHostWebRtcTransportBridgeRefs, errors: string[]): void {
  const record = objectRecord(handoff);
  if (!record) {
    errors.push('realP95DropBackpressureLongRunHandoff is required');
    return;
  }
  if (record.schemaVersion !== 'sciforge.browser-host-session.webrtc-transport-real-long-run-handoff.v1') {
    errors.push('realP95DropBackpressureLongRunHandoff.schemaVersion must be real long-run handoff v1');
  }
  if (record.owner !== 'BrowserHostSession') errors.push('realP95DropBackpressureLongRunHandoff.owner must remain BrowserHostSession');
  if (record.secondTruthSource !== false) errors.push('realP95DropBackpressureLongRunHandoff.secondTruthSource must be false');
  if (record.rawPayloadsCaptured !== false) errors.push('realP95DropBackpressureLongRunHandoff.rawPayloadsCaptured must be false');

  const handoffRefs = objectRecord(record.refs);
  const expectedRefs: Record<string, unknown> = {
    hostSessionRef: refs.hostSessionRef,
    bridgeRef: refs.bridgeRef,
    transportRef: refs.transportRef,
    metricsSummaryRef: `${refs.metricsRef}/summary`,
    metricsSamplesRef: `${refs.metricsRef}/samples`,
    decoderMetricsRef: `${refs.metricsRef}/decoder`,
    objectUrlMetricsRef: `${refs.metricsRef}/object-url-lifecycle`,
    rightPaneSurfaceRef: refs.liveSurfaceRef,
    actionChannelRef: refs.actionChannelRef,
  };
  if (!handoffRefs) {
    errors.push('realP95DropBackpressureLongRunHandoff.refs are required');
  } else {
    for (const [key, value] of Object.entries(expectedRefs)) {
      if (handoffRefs[key] !== value) errors.push(`realP95DropBackpressureLongRunHandoff.refs.${key} must be ${String(value)}`);
    }
  }

  const benchmarkClaim = record.benchmarkClaim === true;
  if (!benchmarkClaim) {
    if (record.status !== 'blocked') errors.push('realP95DropBackpressureLongRunHandoff nonpass status must be blocked');
    if (record.source !== 'contract-smoke-not-real-ui-run') errors.push('realP95DropBackpressureLongRunHandoff blocked source must be contract-smoke-not-real-ui-run');
    if (record.realUiRun !== false) errors.push('realP95DropBackpressureLongRunHandoff blocked realUiRun must be false');
    if (typeof record.blockedReason !== 'string' || record.blockedReason.length === 0) {
      errors.push('realP95DropBackpressureLongRunHandoff blockedReason is required while blocked');
    }
    validateRealRunProofRequirements(record.realRunProofRequirements, errors);
    validateRealRunPayloadPolicy(record.payloadPolicy, errors);
    validateRealRunPassRefusalPolicy(record.passRefusalPolicy, errors);
    return;
  }

  if (record.status !== 'passed'
    || record.source !== 'real-right-pane-ui-webrtc-run'
    || record.realUiRun !== true
    || record.productSurface !== 'right-pane-browser'
    || record.transportEvidenceKind !== 'real-ui-webrtc-data-channel-live-stack'
    || typeof record.blockedReason === 'string') {
    errors.push('realP95DropBackpressureLongRunHandoff pass requires real right-pane UI WebRTC proof');
  }
  validateRealLongRunRefCohesion(record.refs, errors);
  validateRealRunPassRefusalPolicy(record.passRefusalPolicy, errors);
  const metrics = objectRecord(record.realRunMetrics);
  if (!metrics) {
    errors.push('realP95DropBackpressureLongRunHandoff.realRunMetrics are required for pass');
  } else {
    const sampleCount = metrics.sampleCount;
    if (!isNonNegativeNumber(sampleCount) || sampleCount < 120) {
      errors.push('realP95DropBackpressureLongRunHandoff.realRunMetrics.sampleCount must be at least 120');
    }
    for (const field of [
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
    ] as const) {
      if (!isNonNegativeNumber(metrics[field])) errors.push(`realP95DropBackpressureLongRunHandoff.realRunMetrics.${field} is required for pass`);
    }
  }
}

function validateRealRunProofRequirements(requirements: unknown, errors: string[]): void {
  const record = objectRecord(requirements);
  if (!record) {
    errors.push('realP95DropBackpressureLongRunHandoff.realRunProofRequirements are required');
    return;
  }
  const expected: Record<string, unknown> = {
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
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) errors.push(`realP95DropBackpressureLongRunHandoff.realRunProofRequirements.${key} must be ${String(value)}`);
  }
  const required = Array.isArray(record.requiredBoundedMetrics) ? record.requiredBoundedMetrics : [];
  for (const field of ['p95EndToEndMs', 'p95DecodeMs', 'dropRate', 'totalDroppedFrames', 'totalSkippedBackpressure', 'backpressureEventCount', 'objectUrlCreateCount', 'objectUrlRevokeCount', 'objectUrlLiveEstimate', 'objectUrlRevokeDeficit']) {
    if (!required.includes(field)) errors.push(`realP95DropBackpressureLongRunHandoff.realRunProofRequirements.requiredBoundedMetrics must include ${field}`);
  }
}

function validateRealLongRunRefCohesion(refs: unknown, errors: string[]): void {
  const record = objectRecord(refs);
  if (!record) {
    errors.push('realP95DropBackpressureLongRunHandoff.refs are required for pass');
    return;
  }
  const hostSessionRef = typeof record.hostSessionRef === 'string' ? record.hostSessionRef : '';
  const sessionId = hostSessionRef.startsWith('browser-host-session:') ? hostSessionRef.slice('browser-host-session:'.length) : '';
  const expected: Record<string, string> = {
    hostSessionRef: `browser-host-session:${sessionId}`,
    bridgeRef: `browser-host-session:${sessionId}/webrtc-transport/bridge`,
    transportRef: `browser-host-session:${sessionId}/webrtc-transport`,
    metricsSummaryRef: `browser-host-session:${sessionId}/webrtc-metrics/summary`,
    metricsSamplesRef: `browser-host-session:${sessionId}/webrtc-metrics/samples`,
    decoderMetricsRef: `browser-host-session:${sessionId}/webrtc-metrics/decoder`,
    objectUrlMetricsRef: `browser-host-session:${sessionId}/webrtc-metrics/object-url-lifecycle`,
    rightPaneSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    actionChannelRef: `browser-host-session:${sessionId}/actions`,
  };
  if (!sessionId) {
    errors.push('realP95DropBackpressureLongRunHandoff.refs.hostSessionRef must be a BrowserHostSession ref');
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) errors.push(`realP95DropBackpressureLongRunHandoff.refs.${key} must be ${value}`);
  }
}

function validateRealRunPassRefusalPolicy(policy: unknown, errors: string[]): void {
  const record = objectRecord(policy);
  if (!record) {
    errors.push('realP95DropBackpressureLongRunHandoff.passRefusalPolicy is required');
    return;
  }
  for (const [key, value] of Object.entries({
    candidateContractDoesNotPass: true,
    loopbackSmokeDoesNotPass: true,
    httpFrameRouteDoesNotPass: true,
    secondTruthSourceDoesNotPass: true,
    deterministicContractMetricsDoNotPass: true,
  })) {
    if (record[key] !== value) errors.push(`realP95DropBackpressureLongRunHandoff.passRefusalPolicy.${key} must be ${String(value)}`);
  }
}

function validateRealRunPayloadPolicy(policy: unknown, errors: string[]): void {
  const record = objectRecord(policy);
  if (!record) {
    errors.push('realP95DropBackpressureLongRunHandoff.payloadPolicy is required');
    return;
  }
  for (const [key, value] of Object.entries({ refsFirst: true, inlineSamples: false, rawFramePayloads: false, rawSignals: false, rawDom: false })) {
    if (record[key] !== value) errors.push(`realP95DropBackpressureLongRunHandoff.payloadPolicy.${key} must be ${String(value)}`);
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateBridgeFrameMessages(
  frameMessages: unknown,
  media: unknown,
  refs: BrowserHostWebRtcTransportBridgeRefs,
  errors: string[],
): void {
  if (!Array.isArray(frameMessages)) {
    errors.push('frameMessages must be an array');
    return;
  }
  const mediaRecord = objectRecord(media);
  const expectedMediaRef = mediaRecord ? browserHostWebRtcMediaRef(mediaRecord as unknown as BrowserHostWebRtcMediaContract) : undefined;
  frameMessages.forEach((message, index) => {
    const record = objectRecord(message);
    const path = `frameMessages[${index}]`;
    if (!record) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (record.schemaVersion !== BROWSER_HOST_WEBRTC_FRAME_REF_MESSAGE_SCHEMA) errors.push(`${path}.schemaVersion must be WebRTC frame ref message v1`);
    if (record.type !== 'browser-host-frame-ref') errors.push(`${path}.type must be browser-host-frame-ref`);
    if (!isPositiveInteger(record.sequence)) errors.push(`${path}.sequence must be a positive integer`);
    if (record.transportRef !== refs.transportRef) errors.push(`${path}.transportRef must target the WebRTC transport ref`);
    if (expectedMediaRef && record.mediaRef !== expectedMediaRef) errors.push(`${path}.mediaRef must target the media ref`);
    if (typeof record.frameRef !== 'string' || !record.frameRef.startsWith(`${refs.frameMessageListRef}/`)) errors.push(`${path}.frameRef must be a frame message ref`);
    if (typeof record.metricsSampleRef !== 'string' || !record.metricsSampleRef.startsWith(`${refs.metricsRef}/samples/`)) errors.push(`${path}.metricsSampleRef must be a metrics sample ref`);
    if (record.rawFramePayload !== false) errors.push(`${path}.rawFramePayload must be false`);
    if (record.inlineFrameBytes !== false) errors.push(`${path}.inlineFrameBytes must be false`);
  });
}

function validateBridgeMetrics(metrics: unknown, candidate: unknown, errors: string[]): void {
  const record = objectRecord(metrics);
  const candidateRecord = objectRecord(candidate);
  if (!record) {
    errors.push('metrics refs are required');
    return;
  }
  const candidateMetrics = objectRecord(candidateRecord?.metrics);
  if (record.inlineSamples !== false) errors.push('metrics.inlineSamples must be false');
  if (!metricsSummaryMatchesCandidate(record.summary, candidateMetrics)) errors.push('metrics.summary must match the candidate metrics summary');
  if (typeof record.metricsRef !== 'string' || !record.metricsRef.endsWith('/webrtc-metrics')) errors.push('metrics.metricsRef must be a BrowserHostSession metrics ref');
  if (record.summaryRef !== `${record.metricsRef}/summary`) errors.push('metrics.summaryRef must be derived from metricsRef');
  if (record.samplesRef !== `${record.metricsRef}/samples`) errors.push('metrics.samplesRef must be derived from metricsRef');
}

function validateBridgeAdapter(bridge: unknown, errors: string[]): void {
  const record = objectRecord(bridge);
  if (!record) {
    errors.push('bridge adapter contract is required');
    return;
  }
  if (record.adapterRole !== 'display-input-adapter') errors.push('bridge.adapterRole must be display-input-adapter');
  if (record.shell !== 'web-shell') errors.push('bridge.shell must be web-shell');
  if (record.renderTarget !== 'canvas') errors.push('bridge.renderTarget must be canvas');
  if (record.liveSurfaceTransport !== 'host-stream') errors.push('bridge.liveSurfaceTransport must be host-stream');
  if (record.productIntegration !== 'BrowserHostSession-owner-transport-bridge') errors.push('bridge.productIntegration must describe the BrowserHostSession owner bridge');
  if (record.secondViewer !== false) errors.push('bridge.secondViewer must be false');
  if (record.rawPayloadsCaptured !== false) errors.push('bridge.rawPayloadsCaptured must be false');
  const forbidden = objectRecord(record.forbiddenLiveBackings);
  if (!forbidden) {
    errors.push('bridge.forbiddenLiveBackings is required');
    return;
  }
  for (const key of ['iframe', 'proxy', 'domCapture', 'httpFrameLiveFallback', 'secondViewer', 'systemPopup'] as const) {
    if (forbidden[key] !== false) errors.push(`bridge.forbiddenLiveBackings.${key} must be false`);
  }
}

function validateBridgeSourceReport(report: unknown, sessionId: string | undefined, errors: string[]): void {
  const record = objectRecord(report);
  if (!record) {
    errors.push('source.feasibilityReport is required');
    return;
  }
  if (record.schemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA) errors.push('source.feasibilityReport.schemaVersion must be WebRTC feasibility v1');
  if (record.owner !== 'BrowserHostSession') errors.push('source.feasibilityReport.owner must remain BrowserHostSession');
  if (sessionId && record.sessionId !== sessionId) errors.push('source.feasibilityReport.sessionId must match the bridge session');
  if (record.refsFirst !== true) errors.push('source.feasibilityReport.refsFirst must be true');
  if (record.singleInteractiveTruth !== true) errors.push('source.feasibilityReport.singleInteractiveTruth must be true');
  if (record.secondTruthSource !== false) errors.push('source.feasibilityReport.secondTruthSource must be false');
  if (record.rawPayloadsCaptured !== false) errors.push('source.feasibilityReport.rawPayloadsCaptured must be false');
}

function collectInlinePayloadViolations(value: unknown, path: string, errors: string[], seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (/data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b|\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas|\bv=0\r?\n|a=candidate:|candidate:[0-9]+ [0-9]+ udp/i.test(value)) {
      errors.push(`${path} contains inline payload or forbidden live backing text`);
    }
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
    if (isInlinePayloadKey(key) && child !== undefined && child !== false && child !== '') {
      errors.push(`${childPath} must be represented by a ref, not inline payload`);
    }
    collectInlinePayloadViolations(child, childPath, errors, seen);
  }
}

function isInlinePayloadKey(key: string): boolean {
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
    'proxyurl',
    'iframeurl',
    'viewerurl',
  ].includes(key.toLowerCase());
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function metricsSummaryMatchesCandidate(summary: unknown, candidateMetrics: Record<string, unknown> | undefined): boolean {
  const summaryRecord = objectRecord(summary);
  if (!summaryRecord || !candidateMetrics) return false;
  for (const key of [
    'schemaVersion',
    'sampleCount',
    'firstSequence',
    'lastSequence',
    'sequenceGapCount',
    'p95CaptureMs',
    'p95EncodeMs',
    'p95NetworkMs',
    'p95DecodeMs',
    'p95RenderMs',
    'p95EndToEndMs',
    'totalDroppedFrames',
    'totalSkippedBackpressure',
    'totalSkippedBusy',
    'totalSkippedRecentInput',
    'backpressureEventCount',
    'maxObservedBufferedBytes',
    'maxConfiguredBufferedBytes',
    'maxFrameBytes',
    'dropRate',
  ] as const) {
    if (summaryRecord[key] !== candidateMetrics[key]) return false;
  }
  return true;
}
