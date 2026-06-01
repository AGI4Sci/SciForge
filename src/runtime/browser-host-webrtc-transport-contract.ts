import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  type BrowserHostSessionState,
} from './browser-host-session-types.js';

export const BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-contract.v1' as const;
export const BROWSER_HOST_WEBRTC_TRANSPORT_METRICS_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-metrics.v1' as const;
export const BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA = 'sciforge.browser-host-session.webrtc-transport-feasibility.v1' as const;

export type BrowserHostWebRtcTransportKind = 'webrtc-data-channel' | 'webrtc-video-track';

export type BrowserHostWebRtcContractSession = Pick<
  BrowserHostSessionState,
  'id' | 'owner' | 'providerId' | 'status' | 'liveSurfaceRef' | 'liveSurfaceTransport' | 'frameStreamRef' | 'singleInteractiveTruth'
>;

export interface BrowserHostWebRtcTransportRefs {
  hostSessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef?: string;
  transportRef: string;
  signalingRef: string;
  metricsRef: string;
}

export interface BrowserHostWebRtcMetricSample {
  sequence: number;
  observedAtMs: number;
  captureMs?: number;
  encodeMs?: number;
  networkMs?: number;
  decodeMs?: number;
  renderMs?: number;
  endToEndMs?: number;
  frameBytes?: number;
  bufferedBytes?: number;
  maxBufferedBytes?: number;
  droppedSinceLastFrame?: number;
  skippedBackpressure?: number;
  skippedBusy?: number;
  skippedRecentInput?: number;
}

export interface BrowserHostWebRtcMetricsSummary {
  schemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_METRICS_SCHEMA;
  sampleCount: number;
  firstSequence?: number;
  lastSequence?: number;
  sequenceGapCount: number;
  p95CaptureMs: number;
  p95EncodeMs: number;
  p95NetworkMs: number;
  p95DecodeMs: number;
  p95RenderMs: number;
  p95EndToEndMs: number;
  totalDroppedFrames: number;
  totalSkippedBackpressure: number;
  totalSkippedBusy: number;
  totalSkippedRecentInput: number;
  backpressureEventCount: number;
  maxObservedBufferedBytes: number;
  maxConfiguredBufferedBytes: number;
  maxFrameBytes: number;
  dropRate: number;
}

export type BrowserHostWebRtcMediaContract =
  | {
    kind: 'webrtc-data-channel';
    dataChannelLabel: 'browser-host-webrtc-frames';
    dataChannelRef: string;
    framePayloadMode: 'encoded-frame-ref';
  }
  | {
    kind: 'webrtc-video-track';
    videoTrackRef: string;
    framePayloadMode: 'browser-video-track';
  };

export interface BrowserHostWebRtcTransportCandidate {
  schemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA;
  kind: BrowserHostWebRtcTransportKind;
  owner: 'BrowserHostSession';
  browserHostSession: BrowserHostWebRtcContractSession;
  refs: BrowserHostWebRtcTransportRefs;
  signaling: {
    mode: 'refs-first';
    sdpRef: string;
    iceCandidateRef: string;
    inlineSdp: false;
    inlineIceCandidates: false;
  };
  adapter: {
    role: 'display-input-adapter';
    shell: 'web-shell';
    renderTarget: 'canvas';
    forbiddenLiveBackings: {
      iframe: false;
      proxy: false;
      domCapture: false;
      httpFrameLiveFallback: false;
      secondViewer: false;
      systemPopup: false;
    };
    rawFramePayloads: false;
  };
  input: {
    owner: 'BrowserHostSession';
    actionChannelRef: string;
    hotPathCapture: 'none';
    ackMode: 'bounded-action-ack';
  };
  media: BrowserHostWebRtcMediaContract;
  metrics: BrowserHostWebRtcMetricsSummary;
}

export interface BrowserHostWebRtcTransportValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics?: BrowserHostWebRtcMetricsSummary;
}

export interface BrowserHostWebRtcTransportFeasibilityReport {
  schemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA;
  candidateSchemaVersion: typeof BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA;
  kind: BrowserHostWebRtcTransportKind;
  owner: 'BrowserHostSession';
  sessionId: string;
  refs: BrowserHostWebRtcTransportRefs;
  adapter: Pick<BrowserHostWebRtcTransportCandidate['adapter'], 'role' | 'shell' | 'renderTarget' | 'forbiddenLiveBackings'>;
  input: BrowserHostWebRtcTransportCandidate['input'];
  media: BrowserHostWebRtcMediaContract;
  metrics: BrowserHostWebRtcMetricsSummary;
  validation: BrowserHostWebRtcTransportValidationResult;
  refsFirst: true;
  singleInteractiveTruth: true;
  secondTruthSource: false;
  rawPayloadsCaptured: false;
}

export function browserHostWebRtcTransportRefs(sessionId: string): BrowserHostWebRtcTransportRefs {
  return {
    hostSessionRef: `browser-host-session:${sessionId}`,
    liveSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    frameStreamRef: `browser-host-session:${sessionId}/frame-stream`,
    transportRef: `browser-host-session:${sessionId}/webrtc-transport`,
    signalingRef: `browser-host-session:${sessionId}/webrtc-signaling`,
    metricsRef: `browser-host-session:${sessionId}/webrtc-metrics`,
  };
}

export function createBrowserHostWebRtcTransportCandidate(input: {
  session: BrowserHostWebRtcContractSession;
  kind: BrowserHostWebRtcTransportKind;
  samples: BrowserHostWebRtcMetricSample[];
}): BrowserHostWebRtcTransportCandidate {
  const refs = browserHostWebRtcTransportRefs(input.session.id);
  return {
    schemaVersion: BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA,
    kind: input.kind,
    owner: 'BrowserHostSession',
    browserHostSession: {
      ...input.session,
      liveSurfaceRef: input.session.liveSurfaceRef ?? refs.liveSurfaceRef,
      frameStreamRef: input.session.frameStreamRef ?? refs.frameStreamRef,
    },
    refs,
    signaling: {
      mode: 'refs-first',
      sdpRef: `${refs.signalingRef}/sdp`,
      iceCandidateRef: `${refs.signalingRef}/ice-candidates`,
      inlineSdp: false,
      inlineIceCandidates: false,
    },
    adapter: {
      role: 'display-input-adapter',
      shell: 'web-shell',
      renderTarget: 'canvas',
      forbiddenLiveBackings: {
        iframe: false,
        proxy: false,
        domCapture: false,
        httpFrameLiveFallback: false,
        secondViewer: false,
        systemPopup: false,
      },
      rawFramePayloads: false,
    },
    input: {
      owner: 'BrowserHostSession',
      actionChannelRef: `browser-host-session:${input.session.id}/actions`,
      hotPathCapture: 'none',
      ackMode: 'bounded-action-ack',
    },
    media: browserHostWebRtcMediaContract(input.session.id, input.kind),
    metrics: summarizeBrowserHostWebRtcTransportMetrics(input.samples),
  };
}

export function summarizeBrowserHostWebRtcTransportMetrics(samples: BrowserHostWebRtcMetricSample[]): BrowserHostWebRtcMetricsSummary {
  const normalized = samples
    .filter((sample) => Number.isFinite(sample.sequence))
    .map((sample) => ({
      sequence: Math.max(0, Math.round(sample.sequence)),
      observedAtMs: nonNegative(sample.observedAtMs),
      captureMs: nonNegative(sample.captureMs),
      encodeMs: nonNegative(sample.encodeMs),
      networkMs: nonNegative(sample.networkMs),
      decodeMs: nonNegative(sample.decodeMs),
      renderMs: nonNegative(sample.renderMs),
      endToEndMs: nonNegative(sample.endToEndMs),
      frameBytes: nonNegative(sample.frameBytes),
      bufferedBytes: nonNegative(sample.bufferedBytes),
      maxBufferedBytes: nonNegative(sample.maxBufferedBytes),
      droppedSinceLastFrame: nonNegative(sample.droppedSinceLastFrame),
      skippedBackpressure: nonNegative(sample.skippedBackpressure),
      skippedBusy: nonNegative(sample.skippedBusy),
      skippedRecentInput: nonNegative(sample.skippedRecentInput),
    }))
    .sort((left, right) => left.sequence - right.sequence);
  const totalDroppedFrames = sum(normalized.map((sample) => sample.droppedSinceLastFrame));
  const sampleCount = normalized.length;
  return {
    schemaVersion: BROWSER_HOST_WEBRTC_TRANSPORT_METRICS_SCHEMA,
    sampleCount,
    firstSequence: normalized[0]?.sequence,
    lastSequence: normalized.at(-1)?.sequence,
    sequenceGapCount: sequenceGapCount(normalized.map((sample) => sample.sequence)),
    p95CaptureMs: percentile(normalized.map((sample) => sample.captureMs), 0.95),
    p95EncodeMs: percentile(normalized.map((sample) => sample.encodeMs), 0.95),
    p95NetworkMs: percentile(normalized.map((sample) => sample.networkMs), 0.95),
    p95DecodeMs: percentile(normalized.map((sample) => sample.decodeMs), 0.95),
    p95RenderMs: percentile(normalized.map((sample) => sample.renderMs), 0.95),
    p95EndToEndMs: percentile(normalized.map((sample) => sample.endToEndMs), 0.95),
    totalDroppedFrames,
    totalSkippedBackpressure: sum(normalized.map((sample) => sample.skippedBackpressure)),
    totalSkippedBusy: sum(normalized.map((sample) => sample.skippedBusy)),
    totalSkippedRecentInput: sum(normalized.map((sample) => sample.skippedRecentInput)),
    backpressureEventCount: normalized.filter((sample) => sample.skippedBackpressure > 0 || (sample.maxBufferedBytes > 0 && sample.bufferedBytes >= sample.maxBufferedBytes)).length,
    maxObservedBufferedBytes: max(normalized.map((sample) => sample.bufferedBytes)),
    maxConfiguredBufferedBytes: max(normalized.map((sample) => sample.maxBufferedBytes)),
    maxFrameBytes: max(normalized.map((sample) => sample.frameBytes)),
    dropRate: sampleCount + totalDroppedFrames > 0 ? roundRatio(totalDroppedFrames / (sampleCount + totalDroppedFrames)) : 0,
  };
}

export function validateBrowserHostWebRtcTransportCandidate(value: unknown): BrowserHostWebRtcTransportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const record = objectRecord(value);
  if (!record) {
    return { ok: false, errors: ['candidate must be an object'], warnings };
  }
  const candidate = record as unknown as BrowserHostWebRtcTransportCandidate;
  if (candidate.schemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_CONTRACT_SCHEMA) errors.push('schemaVersion must be WebRTC transport contract v1');
  if (candidate.kind !== 'webrtc-data-channel' && candidate.kind !== 'webrtc-video-track') errors.push('kind must be webrtc-data-channel or webrtc-video-track');
  if (candidate.owner !== 'BrowserHostSession') errors.push('owner must remain BrowserHostSession');

  const session = objectRecord(candidate.browserHostSession);
  const sessionId = typeof session?.id === 'string' ? session.id : undefined;
  if (!sessionId) {
    errors.push('browserHostSession.id is required');
  } else {
    const expectedRefs = browserHostWebRtcTransportRefs(sessionId);
    validateSession(candidate.browserHostSession, errors);
    validateRefs(candidate.refs, expectedRefs, errors);
    validateSignaling(candidate.signaling, expectedRefs, errors);
    validateInput(candidate.input, sessionId, errors);
    validateMedia(candidate.media, candidate.kind, sessionId, errors);
  }
  validateAdapter(candidate.adapter, errors);
  validateMetrics(candidate.metrics, errors, warnings);
  collectRawPayloadViolations(value, '$', errors, new WeakSet<object>());
  return { ok: errors.length === 0, errors, warnings, metrics: candidate.metrics };
}

export function browserHostWebRtcTransportFeasibilityReport(candidate: BrowserHostWebRtcTransportCandidate): BrowserHostWebRtcTransportFeasibilityReport {
  return {
    schemaVersion: BROWSER_HOST_WEBRTC_TRANSPORT_FEASIBILITY_SCHEMA,
    candidateSchemaVersion: candidate.schemaVersion,
    kind: candidate.kind,
    owner: 'BrowserHostSession',
    sessionId: candidate.browserHostSession.id,
    refs: candidate.refs,
    adapter: {
      role: candidate.adapter.role,
      shell: candidate.adapter.shell,
      renderTarget: candidate.adapter.renderTarget,
      forbiddenLiveBackings: candidate.adapter.forbiddenLiveBackings,
    },
    input: candidate.input,
    media: candidate.media,
    metrics: candidate.metrics,
    validation: validateBrowserHostWebRtcTransportCandidate(candidate),
    refsFirst: true,
    singleInteractiveTruth: true,
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  };
}

function browserHostWebRtcMediaContract(sessionId: string, kind: BrowserHostWebRtcTransportKind): BrowserHostWebRtcMediaContract {
  if (kind === 'webrtc-data-channel') {
    return {
      kind,
      dataChannelLabel: 'browser-host-webrtc-frames',
      dataChannelRef: `browser-host-session:${sessionId}/webrtc-data-channel/frames`,
      framePayloadMode: 'encoded-frame-ref',
    };
  }
  return {
    kind,
    videoTrackRef: `browser-host-session:${sessionId}/webrtc-video-track/live`,
    framePayloadMode: 'browser-video-track',
  };
}

function validateSession(session: BrowserHostWebRtcContractSession, errors: string[]): void {
  if (session.owner !== 'host') errors.push('browserHostSession.owner must remain host');
  if (session.providerId !== BROWSER_HOST_SESSION_PROVIDER_ID) errors.push('browserHostSession.providerId must be sciforge.browser-host-session');
  if (session.singleInteractiveTruth !== true) errors.push('browserHostSession.singleInteractiveTruth must be true');
  if (session.liveSurfaceTransport !== 'host-stream') errors.push('browserHostSession.liveSurfaceTransport must stay host-stream for Web shell WebRTC transport');
  const refs = browserHostWebRtcTransportRefs(session.id);
  if (session.liveSurfaceRef !== refs.liveSurfaceRef) errors.push('browserHostSession.liveSurfaceRef must stay inside the BrowserHostSession ref namespace');
  if (session.frameStreamRef !== undefined && session.frameStreamRef !== refs.frameStreamRef) errors.push('browserHostSession.frameStreamRef must stay inside the BrowserHostSession ref namespace');
}

function validateRefs(refs: BrowserHostWebRtcTransportRefs | undefined, expected: BrowserHostWebRtcTransportRefs, errors: string[]): void {
  const record = objectRecord(refs);
  if (!record) {
    errors.push('refs are required');
    return;
  }
  for (const key of ['hostSessionRef', 'liveSurfaceRef', 'transportRef', 'signalingRef', 'metricsRef'] as const) {
    if (record[key] !== expected[key]) errors.push(`refs.${key} must be ${expected[key]}`);
  }
  if (record.frameStreamRef !== undefined && record.frameStreamRef !== expected.frameStreamRef) errors.push(`refs.frameStreamRef must be ${expected.frameStreamRef}`);
}

function validateSignaling(signaling: BrowserHostWebRtcTransportCandidate['signaling'] | undefined, refs: BrowserHostWebRtcTransportRefs, errors: string[]): void {
  const record = objectRecord(signaling);
  if (!record) {
    errors.push('signaling is required');
    return;
  }
  if (record.mode !== 'refs-first') errors.push('signaling.mode must be refs-first');
  if (record.sdpRef !== `${refs.signalingRef}/sdp`) errors.push('signaling.sdpRef must be a BrowserHostSession ref');
  if (record.iceCandidateRef !== `${refs.signalingRef}/ice-candidates`) errors.push('signaling.iceCandidateRef must be a BrowserHostSession ref');
  if (record.inlineSdp !== false) errors.push('signaling.inlineSdp must be false');
  if (record.inlineIceCandidates !== false) errors.push('signaling.inlineIceCandidates must be false');
}

function validateAdapter(adapter: BrowserHostWebRtcTransportCandidate['adapter'] | undefined, errors: string[]): void {
  const record = objectRecord(adapter);
  if (!record) {
    errors.push('adapter is required');
    return;
  }
  if (record.role !== 'display-input-adapter') errors.push('adapter.role must be display-input-adapter');
  if (record.shell !== 'web-shell') errors.push('adapter.shell must be web-shell');
  if (record.renderTarget !== 'canvas') errors.push('adapter.renderTarget must be canvas');
  if (record.rawFramePayloads !== false) errors.push('adapter.rawFramePayloads must be false');
  const forbidden = objectRecord(record.forbiddenLiveBackings);
  if (!forbidden) {
    errors.push('adapter.forbiddenLiveBackings is required');
    return;
  }
  for (const key of ['iframe', 'proxy', 'domCapture', 'httpFrameLiveFallback', 'secondViewer', 'systemPopup'] as const) {
    if (forbidden[key] !== false) errors.push(`adapter.forbiddenLiveBackings.${key} must be false`);
  }
}

function validateInput(input: BrowserHostWebRtcTransportCandidate['input'] | undefined, sessionId: string, errors: string[]): void {
  const record = objectRecord(input);
  if (!record) {
    errors.push('input contract is required');
    return;
  }
  if (record.owner !== 'BrowserHostSession') errors.push('input.owner must remain BrowserHostSession');
  if (record.actionChannelRef !== `browser-host-session:${sessionId}/actions`) errors.push('input.actionChannelRef must target the BrowserHostSession action channel');
  if (record.hotPathCapture !== 'none') errors.push('input.hotPathCapture must be none');
  if (record.ackMode !== 'bounded-action-ack') errors.push('input.ackMode must be bounded-action-ack');
}

function validateMedia(media: BrowserHostWebRtcMediaContract | undefined, kind: BrowserHostWebRtcTransportKind, sessionId: string, errors: string[]): void {
  const record = objectRecord(media);
  if (!record) {
    errors.push('media contract is required');
    return;
  }
  if (record.kind !== kind) errors.push('media.kind must match candidate.kind');
  if (kind === 'webrtc-data-channel') {
    if (record.dataChannelLabel !== 'browser-host-webrtc-frames') errors.push('media.dataChannelLabel must be browser-host-webrtc-frames');
    if (record.dataChannelRef !== `browser-host-session:${sessionId}/webrtc-data-channel/frames`) errors.push('media.dataChannelRef must be a BrowserHostSession ref');
    if (record.framePayloadMode !== 'encoded-frame-ref') errors.push('media.framePayloadMode must be encoded-frame-ref');
    return;
  }
  if (record.videoTrackRef !== `browser-host-session:${sessionId}/webrtc-video-track/live`) errors.push('media.videoTrackRef must be a BrowserHostSession ref');
  if (record.framePayloadMode !== 'browser-video-track') errors.push('media.framePayloadMode must be browser-video-track');
}

function validateMetrics(metrics: BrowserHostWebRtcMetricsSummary | undefined, errors: string[], warnings: string[]): void {
  const record = objectRecord(metrics);
  if (!record) {
    errors.push('metrics summary is required');
    return;
  }
  if (record.schemaVersion !== BROWSER_HOST_WEBRTC_TRANSPORT_METRICS_SCHEMA) errors.push('metrics.schemaVersion must be WebRTC transport metrics v1');
  for (const key of [
    'sampleCount',
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
    if (!isNonNegativeNumber(record[key])) errors.push(`metrics.${key} must be a non-negative number`);
  }
  if (record.sampleCount === 0) warnings.push('metrics.sampleCount is zero; feasibility report has no latency samples');
}

function collectRawPayloadViolations(value: unknown, path: string, errors: string[], seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (/data:image|base64|<\s*(?:!doctype|html|body|iframe|webview)\b|\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas|\bv=0\r?\n/i.test(value)) {
      errors.push(`${path} contains raw payload or forbidden live backing text`);
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
    if (isRawPayloadKey(key) && child !== undefined && child !== false && child !== '') {
      errors.push(`${childPath} must be represented by a ref, not inline payload`);
    }
    collectRawPayloadViolations(child, childPath, errors, seen);
  }
}

function isRawPayloadKey(key: string): boolean {
  return [
    'sdp',
    'sdpoffer',
    'sdpanswer',
    'inlinesdppayload',
    'icecandidates',
    'inlineicecandidatepayload',
    'rawdom',
    'domsnapshot',
    'html',
    'htmlpayload',
    'base64',
    'dataurl',
    'framedata',
    'framepayload',
    'rawframe',
    'proxyurl',
    'iframeurl',
    'viewerurl',
  ].includes(key.toLowerCase());
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function sequenceGapCount(sequences: number[]): number {
  let gaps = 0;
  for (let index = 1; index < sequences.length; index += 1) {
    if (sequences[index] !== sequences[index - 1] + 1) gaps += 1;
  }
  return gaps;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
