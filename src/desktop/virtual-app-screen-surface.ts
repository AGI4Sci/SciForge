export type DesktopVirtualAppScreenSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopVirtualAppScreenSurfaceState = {
  ok: boolean;
  owner: 'VirtualAppScreenSurface';
  presenterRole: 'observe-only-host-ref-presenter';
  surfaceMode: 'live';
  liveSurfaceTransport: 'native-frame-stream' | 'webrtc';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  sessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  surfaceTransportRef: string;
  evidenceLedgerRef: string;
  bounds?: DesktopVirtualAppScreenSurfaceBounds;
  visible: boolean;
  reason?: string;
};

export type DesktopVirtualAppScreenSurfaceResult =
  | DesktopVirtualAppScreenSurfaceState
  | { ok: false; reason: string };

type DesktopVirtualAppScreenSurfaceRequest = Record<string, unknown>;

type NormalizedDesktopVirtualAppScreenSurfaceRequest = {
  sessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  surfaceTransportRef: string;
  evidenceLedgerRef: string;
  surfaceTransport: 'native-frame-stream' | 'webrtc';
  bounds?: DesktopVirtualAppScreenSurfaceBounds;
};

const NATIVE_HOST_REF_PREFIX = 'computer-use:native-host/';
const PROVIDER_LIFECYCLE_REF_FIELDS = new Set([
  'screenRef',
  'providerSessionOwnerRef',
  'providerSessionReconnectRef',
  'providerExecuted',
  'providerSessionRevalidated',
]);

export function createDesktopVirtualAppScreenSurfacePresenter() {
  const presentations = new Map<string, DesktopVirtualAppScreenSurfaceState>();

  function attach(value: unknown): DesktopVirtualAppScreenSurfaceResult {
    const normalized = validateDesktopVirtualAppScreenSurfaceRequest(value, { requireBounds: true });
    if ('reason' in normalized) return blockedVirtualAppScreenSurfaceState(normalized.reason);
    const state = stateFromVirtualAppScreenSurfaceRequest(normalized, true);
    presentations.set(normalized.sessionRef, state);
    return state;
  }

  function present(value: unknown): DesktopVirtualAppScreenSurfaceResult {
    return attach(value);
  }

  function detach(value: unknown): DesktopVirtualAppScreenSurfaceResult {
    const normalized = validateDesktopVirtualAppScreenSurfaceRequest(value, { requireBounds: false });
    if ('reason' in normalized) return blockedVirtualAppScreenSurfaceState(normalized.reason);
    const state = stateFromVirtualAppScreenSurfaceRequest(normalized, false);
    presentations.set(normalized.sessionRef, state);
    return state;
  }

  return {
    attach,
    present,
    detach,
    state(sessionRef: string): DesktopVirtualAppScreenSurfaceState | undefined {
      return presentations.get(sessionRef);
    },
  };
}

function validateDesktopVirtualAppScreenSurfaceRequest(
  value: unknown,
  options: { requireBounds: boolean },
): NormalizedDesktopVirtualAppScreenSurfaceRequest | { reason: string } {
  if (!isRecord(value)) return { reason: 'virtual-app-screen-surface-request-invalid' };
  const rawReason = rawPayloadReason(value);
  if (rawReason) return { reason: rawReason };
  for (const field of PROVIDER_LIFECYCLE_REF_FIELDS) {
    if (field in value) return { reason: `provider-lifecycle-field-forbidden:${field}` };
  }
  if (textField(value.kind) !== 'right-pane-virtual-app-screen-surface') {
    return { reason: 'virtual-app-screen-surface-kind-invalid' };
  }

  const nativeRefFields = [
    'sessionRef',
    'hostSessionRef',
    'surfaceOwnerRef',
    'displayOwnerRef',
    'liveSurfaceRef',
    'frameStreamRef',
    'currentFrameRef',
    'liveBindingAttachGrantRef',
    'grantValidationRef',
    'surfaceTransportRef',
    'platformDriverRef',
    'evidenceLedgerRef',
  ];
  for (const field of nativeRefFields) {
    if (field in value && value[field] !== undefined) {
      const reason = validateNativeHostLiveRef(value[field], field);
      if (reason) return { reason };
    }
  }
  for (const field of ['sessionRef', 'liveSurfaceRef', 'frameStreamRef', 'currentFrameRef', 'liveBindingAttachGrantRef', 'grantValidationRef', 'surfaceTransportRef', 'platformDriverRef', 'evidenceLedgerRef']) {
    if (!textField(value[field])) return { reason: `missing-live-ref:${field}` };
  }
  if (!readyStatus(textField(value.liveBindingAttachGrantStatus)) && !readyStatus(textField(value.grantValidationStatus))) {
    return { reason: 'host-grant-not-validated' };
  }
  if (!readyStatus(textField(value.platformDriverStatus))) return { reason: 'platform-driver-not-ready' };

  const surfaceTransport = textField(value.surfaceTransport);
  if (surfaceTransport !== 'native-frame-stream' && surfaceTransport !== 'webrtc') {
    return { reason: 'surface-transport-invalid' };
  }
  const sequence = isRecord(value.currentFrameSequence) ? value.currentFrameSequence : undefined;
  if (!sequence) return { reason: 'current-frame-sequence-missing' };
  const sequenceRefReason = validateNativeHostLiveRef(sequence.ref, 'currentFrameSequence.ref');
  if (sequenceRefReason) return { reason: sequenceRefReason };
  const sequenceNumber = typeof sequence.sequence === 'number' && Number.isFinite(sequence.sequence) && sequence.sequence >= 0
    ? sequence.sequence
    : undefined;
  if (sequenceNumber === undefined) return { reason: 'current-frame-sequence-invalid' };

  const descriptor = isRecord(value.surfaceTransportDescriptor) ? value.surfaceTransportDescriptor : undefined;
  if (!descriptor) return { reason: 'surface-transport-descriptor-missing' };
  const descriptorReason = validateSurfaceTransportDescriptor(descriptor, {
    liveSurfaceRef: value.liveSurfaceRef as string,
    frameStreamRef: value.frameStreamRef as string,
    currentFrameRef: value.currentFrameRef as string,
    surfaceTransportRef: value.surfaceTransportRef as string,
    surfaceTransport,
    currentFrameSequence: sequenceNumber,
  });
  if (descriptorReason) return { reason: descriptorReason };

  const bounds = normalizeVirtualAppScreenSurfaceBounds(value.bounds);
  if (options.requireBounds && !bounds) return { reason: 'presentation-bounds-invalid' };
  return {
    sessionRef: value.sessionRef as string,
    liveSurfaceRef: value.liveSurfaceRef as string,
    frameStreamRef: value.frameStreamRef as string,
    currentFrameRef: value.currentFrameRef as string,
    surfaceTransportRef: value.surfaceTransportRef as string,
    evidenceLedgerRef: value.evidenceLedgerRef as string,
    surfaceTransport,
    ...(bounds ? { bounds } : {}),
  };
}

function validateSurfaceTransportDescriptor(
  descriptor: Record<string, unknown>,
  expected: {
    liveSurfaceRef: string;
    frameStreamRef: string;
    currentFrameRef: string;
    surfaceTransportRef: string;
    surfaceTransport: 'native-frame-stream' | 'webrtc';
    currentFrameSequence: number;
  },
): string | undefined {
  for (const field of [
    'surfaceTransportRef',
    'liveSurfaceRef',
    'frameStreamRef',
    'currentFrameRef',
    'frameTransportContractRef',
    'frameTelemetryRef',
    'mediaChannelRef',
    'dataChannelRef',
  ]) {
    if (field in descriptor && descriptor[field] !== undefined) {
      const reason = validateNativeHostLiveRef(descriptor[field], `surfaceTransportDescriptor.${field}`);
      if (reason) return reason;
    }
  }
  if (descriptor.diagnosticOnly !== false) return 'diagnostic-surface-forbidden';
  if (descriptor.productFallback !== false) return 'fallback-surface-forbidden';
  if (descriptor.singleInteractiveTruth !== true) return 'single-interactive-truth-required';
  if (descriptor.liveSurfaceRef !== expected.liveSurfaceRef) return 'surface-transport-descriptor-mismatch:liveSurfaceRef';
  if (descriptor.frameStreamRef !== expected.frameStreamRef) return 'surface-transport-descriptor-mismatch:frameStreamRef';
  if (descriptor.currentFrameRef !== expected.currentFrameRef) return 'surface-transport-descriptor-mismatch:currentFrameRef';
  if (descriptor.surfaceTransportRef !== expected.surfaceTransportRef) return 'surface-transport-descriptor-mismatch:surfaceTransportRef';
  if (typeof descriptor.transport === 'string' && descriptor.transport !== expected.surfaceTransport) {
    return 'surface-transport-descriptor-mismatch:transport';
  }
  if (descriptor.currentFrameSequence !== expected.currentFrameSequence) {
    return 'surface-transport-descriptor-mismatch:currentFrameSequence';
  }
  return undefined;
}

function stateFromVirtualAppScreenSurfaceRequest(
  request: NormalizedDesktopVirtualAppScreenSurfaceRequest,
  visible: boolean,
): DesktopVirtualAppScreenSurfaceState {
  return {
    ok: true,
    owner: 'VirtualAppScreenSurface',
    presenterRole: 'observe-only-host-ref-presenter',
    surfaceMode: 'live',
    liveSurfaceTransport: request.surfaceTransport,
    singleInteractiveTruth: true,
    secondTruthSource: false,
    sessionRef: request.sessionRef,
    liveSurfaceRef: request.liveSurfaceRef,
    frameStreamRef: request.frameStreamRef,
    currentFrameRef: request.currentFrameRef,
    surfaceTransportRef: request.surfaceTransportRef,
    evidenceLedgerRef: request.evidenceLedgerRef,
    ...(visible && request.bounds ? { bounds: request.bounds } : {}),
    visible,
  };
}

function blockedVirtualAppScreenSurfaceState(reason: string): DesktopVirtualAppScreenSurfaceResult {
  return { ok: false, reason };
}

function validateNativeHostLiveRef(value: unknown, field: string): string | undefined {
  const ref = textField(value);
  if (!ref) return `missing-live-ref:${field}`;
  const unsafeReason = unsafeRefReason(ref, field);
  if (unsafeReason) return unsafeReason;
  if (!ref.startsWith(NATIVE_HOST_REF_PREFIX)) return `non-native-host-live-ref:${field}`;
  if (nonProductRef(ref)) return `non-product-live-ref:${field}`;
  return undefined;
}

function normalizeVirtualAppScreenSurfaceBounds(value: unknown): DesktopVirtualAppScreenSurfaceBounds | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function rawPayloadReason(value: unknown, path = ''): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const reason = rawPayloadReason(value[index], `${path}[${index}]`);
      if (reason) return reason;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string') return unsafeInlineStringReason(value, path);
    return undefined;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (/^(?:raw|rawPayload|rawScreenshot|payload|data|dataUrl|image|imageData|screenshot)$/i.test(key)) {
      return `raw-live-payload-forbidden:${nextPath}`;
    }
    if (/providerUrl|fixtureUrl|replayUrl/i.test(key)) return `raw-live-payload-forbidden:${nextPath}`;
    const reason = rawPayloadReason(entry, nextPath);
    if (reason) return reason;
  }
  return undefined;
}

function unsafeInlineStringReason(value: string, path: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('//')
    || normalized.includes(';base64,')
  ) return `raw-live-payload-forbidden:${path || 'value'}`;
  if (/authorization|bearer|api[_-]?key|password|secret|token/i.test(normalized)) {
    return `raw-live-payload-forbidden:${path || 'value'}`;
  }
  return undefined;
}

function unsafeRefReason(value: string, field: string): string | undefined {
  const inlineReason = unsafeInlineStringReason(value, field);
  if (inlineReason) return inlineReason;
  return undefined;
}

function nonProductRef(value: string): boolean {
  return /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|replay|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/i.test(value);
}

function readyStatus(value: string | undefined): boolean {
  return Boolean(value && /^(attached|available|granted|not-required|ready|running|valid|validated)$/i.test(value.trim()));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is DesktopVirtualAppScreenSurfaceRequest {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
