import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
  VIRTUAL_SCREEN_VIEWER_COMPONENT_ID,
} from './manifest';

export const VIRTUAL_APP_SCREEN_ATTACH_STATES = [
  'attached',
  'replay',
  'no-session',
  'adapter-unavailable',
  'observe-only',
  'blocked',
  'requires-handoff',
  'error',
] as const;

export type VirtualAppScreenAttachState = typeof VIRTUAL_APP_SCREEN_ATTACH_STATES[number];
export const VIRTUAL_SCREEN_REPLAY_PRESENTATION_MODE = 'replay-ref-inspector' as const;
export const VIRTUAL_SCREEN_LIVE_PRESENTATION_MODE = 'live-surface-ref' as const;

export type VirtualScreenRejectedInputKind =
  | 'inline-screenshot'
  | 'inline-image'
  | 'raw-json'
  | 'raw-trace'
  | 'provider-route'
  | 'provider-params'
  | 'host-bridge'
  | 'executor-params'
  | 'scheduler-params'
  | 'unsafe-ref'
  | 'unsupported-transport'
  | 'unsupported-payload-field';

export interface VirtualScreenRejectedInput {
  field: string;
  label: string;
  kind: VirtualScreenRejectedInputKind;
}

export interface VirtualScreenIsolationFlags {
  affectsPhysicalDisplay?: boolean;
  requiresFocusSteal?: boolean;
  sharedSystemInputUsed?: boolean;
  systemPointerMoved?: boolean;
  systemKeyboardEventsSent?: boolean;
  backgroundRenderable?: boolean;
  singleInteractiveTruth?: boolean;
  secondInteractiveSurfacePresent?: boolean;
  diagnosticOnly?: boolean;
}

export interface VirtualScreenFrame {
  ref: string;
  screenRef?: string;
  label?: string;
  status?: string;
  frameUrl?: string;
  frameDataRef?: string;
  framePreviewUrl?: string;
  thumbnailPreviewUrl?: string;
  safePreviewUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  rawUrl?: string;
  screenshotRef?: string;
  beforeEvidenceRef?: string;
  afterEvidenceRef?: string;
  evidenceRef?: string;
  cursorOverlayRefs?: string[];
  leaseOwnerRefs?: string[];
  proposalRef?: string;
  blockedReason?: string;
  errorReason?: string;
}

export interface VirtualScreenCursor {
  actorId: string;
  cursorId?: string;
  label?: string;
  color?: string;
  x?: number;
  y?: number;
  state?: string;
}

export interface VirtualScreenLeaseOwner {
  ref: string;
  label?: string;
  status?: string;
  ownerRef?: string;
  scopeRef?: string;
}

export interface VirtualScreenEvent {
  label: string;
  ref: string;
  status?: string;
}

export type VirtualScreenInputIntentKind =
  | 'click'
  | 'type_text'
  | 'drag'
  | 'scroll'
  | 'hotkey'
  | 'menu_command';

export type VirtualScreenPointerButton = 'left' | 'right' | 'middle';

export interface VirtualScreenInputIntentCommand {
  kind: VirtualScreenInputIntentKind;
  xRatio?: number;
  yRatio?: number;
  startXRatio?: number;
  startYRatio?: number;
  endXRatio?: number;
  endYRatio?: number;
  button?: VirtualScreenPointerButton;
  clickCount?: number;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  menuCommand?: string;
}

export interface VirtualScreenPayload {
  title?: string;
  status?: string;
  attachState?: VirtualAppScreenAttachState;
  surfaceMode?: 'live' | 'replay' | 'empty';
  displayGroupRef?: string;
  screenRef?: string;
  liveSurfaceRef?: string;
  surfaceTransport?: 'webrtc' | 'native-frame-stream';
  platformDriverRef?: string;
  platformDriverStatus?: string;
  visibleScreenRefs?: string[];
  visibleCursorRefs?: string[];
  targetAppRef?: string;
  targetWindowRef?: string;
  sessionRef?: string;
  frameStreamRef?: string;
  frameRef?: string;
  frameRefs?: VirtualScreenFrame[];
  currentFrameRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  beforeAfterFrameRefs?: string[];
  actorCursorRefs?: string[];
  annotationOverlayRefs?: string[];
  annotationProposalRefs?: string[];
  inputIntentRefs?: string[];
  executorEventRefs?: string[];
  cursorOverlayRefs?: string[];
  leaseOwnerRefs?: VirtualScreenLeaseOwner[];
  proposalRefs?: string[];
  proposals?: Array<Record<string, unknown>>;
  inputLeaseRef?: string;
  actionAdapterRef?: string;
  adapterReadinessRef?: string;
  replayRef?: string;
  evidenceLedgerRef?: string;
  artifactRefs?: string[];
  verificationRefs?: string[];
  guiPresentRefs?: string[];
  beforeEvidenceRef?: string;
  afterEvidenceRef?: string;
  completionEvidenceRef?: string;
  blockedRef?: string;
  errorRef?: string;
  blockedReason?: string;
  errorReason?: string;
  permissionRef?: string;
  permissionStatus?: string;
  permissionRequired?: boolean;
  permissionGranted?: boolean;
  sharedInputAllowed?: boolean;
  leaseStatus?: string;
  stopRef?: string;
  cancelLeaseRef?: string;
  handoffRef?: string;
  screen?: { width?: number; height?: number; label?: string };
  actorCursors?: VirtualScreenCursor[];
  isolation?: Record<string, unknown>;
  isolationFlags?: VirtualScreenIsolationFlags;
  runSummary?: Record<string, unknown>;
  events?: VirtualScreenEvent[];
  rejectedInputs?: VirtualScreenRejectedInput[];
  onTerminalEquivalentText?: (event: { commandText: string; label: string; targetRef?: string }) => void;
}

const allowedPayloadFields = new Set([
  'title',
  'status',
  'attachState',
  'surfaceMode',
  'displayGroupRef',
  'screenRef',
  'liveSurfaceRef',
  'surfaceTransport',
  'platformDriverRef',
  'platformDriverStatus',
  'visibleScreenRefs',
  'visibleCursorRefs',
  'targetAppRef',
  'targetWindowRef',
  'sessionRef',
  'frameStreamRef',
  'frameRef',
  'frameRefs',
  'frames',
  'currentFrameRef',
  'beforeFrameRef',
  'afterFrameRef',
  'beforeAfterFrameRefs',
  'actorCursorRefs',
  'annotationOverlayRefs',
  'annotationProposalRefs',
  'inputIntentRef',
  'inputIntentRefs',
  'executorEventRef',
  'executorEventRefs',
  'inputLeaseRef',
  'actionAdapterRef',
  'adapterReadinessRef',
  'replayRef',
  'evidenceLedgerRef',
  'artifactRefs',
  'verificationRefs',
  'guiPresentRefs',
  'beforeEvidenceRef',
  'afterEvidenceRef',
  'completionEvidenceRef',
  'blockedRef',
  'errorRef',
  'blockedReason',
  'errorReason',
  'permissionRef',
  'permissionStatus',
  'permissionRequired',
  'permissionGranted',
  'sharedInputAllowed',
  'leaseStatus',
  'stopRef',
  'cancelLeaseRef',
  'handoffRef',
  'screen',
  'actorCursors',
  'isolation',
  'isolationFlags',
  'events',
  'onTerminalEquivalentText',
]);

const rejectedInputLabels: Array<[string, string, VirtualScreenRejectedInputKind]> = [
  ['rawScreenshot', 'inline screenshot', 'inline-screenshot'],
  ['screenshot', 'inline screenshot', 'inline-screenshot'],
  ['screenshotBase64', 'base64 image payload', 'inline-image'],
  ['imageBase64', 'base64 image payload', 'inline-image'],
  ['base64Screenshot', 'base64 image payload', 'inline-image'],
  ['frameBase64', 'base64 image payload', 'inline-image'],
  ['frameData', 'base64 image payload', 'inline-image'],
  ['rawFrame', 'base64 image payload', 'inline-image'],
  ['rawTrace', 'raw trace payload', 'raw-trace'],
  ['traceJson', 'raw trace payload', 'raw-trace'],
  ['rawJson', 'raw JSON payload', 'raw-json'],
  ['rawJSON', 'raw JSON payload', 'raw-json'],
  ['providerJson', 'raw provider payload', 'raw-json'],
  ['providerPayload', 'raw provider payload', 'raw-json'],
  ['providerRoute', 'provider route', 'provider-route'],
  ['providerParams', 'provider parameters', 'provider-params'],
  ['providerConfig', 'provider parameters', 'provider-params'],
  ['providerUrl', 'provider route', 'provider-route'],
  ['providerURL', 'provider route', 'provider-route'],
  ['streamUrl', 'provider route', 'provider-route'],
  ['streamURL', 'provider route', 'provider-route'],
  ['liveSurfaceUrl', 'provider route', 'provider-route'],
  ['liveSurfaceURL', 'provider route', 'provider-route'],
  ['transportSdp', 'raw transport payload', 'raw-json'],
  ['transportOffer', 'raw transport payload', 'raw-json'],
  ['transportAnswer', 'raw transport payload', 'raw-json'],
  ['iceCandidates', 'raw transport payload', 'raw-json'],
  ['provider', 'provider parameters', 'provider-params'],
  ['hostBridge', 'host bridge parameters', 'host-bridge'],
  ['executorLease', 'executor parameters', 'executor-params'],
  ['executorLeaseParams', 'executor parameters', 'executor-params'],
  ['executorParams', 'executor parameters', 'executor-params'],
  ['actionExecutorParams', 'executor parameters', 'executor-params'],
  ['schedulerParams', 'scheduler parameters', 'scheduler-params'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function s(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isInlineOrUnsafeRef(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('//')
    || normalized.startsWith('/')
    || normalized.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(normalized)
  );
}

function safeRef(value: unknown, field: string, rejected: VirtualScreenRejectedInput[]): string | undefined {
  const ref = s(value);
  if (!ref) return undefined;
  if (isInlineOrUnsafeRef(ref)) {
    rejected.push({ field, label: 'unsafe ref value', kind: 'unsafe-ref' });
    return undefined;
  }
  return ref;
}

function safeRefArray(value: unknown, field: string, rejected: VirtualScreenRejectedInput[]): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((entry, index) => safeRef(entry, `${field}[${index}]`, rejected)));
}

function normalizeAttachState(value: unknown): VirtualAppScreenAttachState | undefined {
  const state = s(value)?.replace('requires-user-handoff', 'requires-handoff');
  return VIRTUAL_APP_SCREEN_ATTACH_STATES.includes(state as VirtualAppScreenAttachState)
    ? state as VirtualAppScreenAttachState
    : undefined;
}

function normalizeSurfaceTransport(value: unknown, rejected: VirtualScreenRejectedInput[]): VirtualScreenPayload['surfaceTransport'] {
  const transport = s(value);
  if (!transport) return undefined;
  if (
    transport === 'native-frame-stream'
    || transport === 'webrtc'
  ) return transport;
  rejected.push({ field: 'surfaceTransport', label: 'unsupported platform surface transport', kind: 'unsupported-transport' });
  return undefined;
}

function normalizeSurfaceMode(value: unknown): VirtualScreenPayload['surfaceMode'] {
  const mode = s(value);
  return mode === 'live' || mode === 'replay' || mode === 'empty' ? mode : undefined;
}

function normalizeStatus(value: unknown) {
  const status = s(value);
  if (!status || isInlineOrUnsafeRef(status)) return undefined;
  return status.length > 80 ? `${status.slice(0, 77)}...` : status;
}

function normalizeIsolationFlags(value: unknown): VirtualScreenIsolationFlags | undefined {
  const raw = isRecord(value) ? value : {};
  const flags = {
    affectsPhysicalDisplay: bool(raw.affectsPhysicalDisplay),
    requiresFocusSteal: bool(raw.requiresFocusSteal),
    sharedSystemInputUsed: bool(raw.sharedSystemInputUsed),
    systemPointerMoved: bool(raw.systemPointerMoved),
    systemKeyboardEventsSent: bool(raw.systemKeyboardEventsSent),
    backgroundRenderable: bool(raw.backgroundRenderable),
    singleInteractiveTruth: bool(raw.singleInteractiveTruth),
    secondInteractiveSurfacePresent: bool(raw.secondInteractiveSurfacePresent),
    diagnosticOnly: bool(raw.diagnosticOnly),
  };
  return Object.values(flags).some((entry) => entry !== undefined) ? flags : undefined;
}

function normalizeFrameRecords(value: unknown, field: string, rejected: VirtualScreenRejectedInput[]): VirtualScreenFrame[] {
  if (!Array.isArray(value)) return [];
  const frames: VirtualScreenFrame[] = [];
  for (const [index, entry] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (typeof entry === 'string') {
      const ref = safeRef(entry, prefix, rejected);
      if (ref) frames.push({ ref });
      continue;
    }
    if (!isRecord(entry)) {
      rejected.push({ field: prefix, label: 'unsupported payload field', kind: 'unsupported-payload-field' });
      continue;
    }
    const ref = safeRef(entry.ref ?? entry.frameRef ?? entry.screenshotRef ?? entry.frameDataRef, `${prefix}.ref`, rejected);
    if (!ref) continue;
    frames.push({
      ref,
      screenRef: safeRef(entry.screenRef, `${prefix}.screenRef`, rejected),
      label: normalizeStatus(entry.label),
      status: normalizeStatus(entry.status),
      frameDataRef: safeRef(entry.frameDataRef, `${prefix}.frameDataRef`, rejected),
      screenshotRef: safeRef(entry.screenshotRef, `${prefix}.screenshotRef`, rejected),
      beforeEvidenceRef: safeRef(entry.beforeEvidenceRef, `${prefix}.beforeEvidenceRef`, rejected),
      afterEvidenceRef: safeRef(entry.afterEvidenceRef, `${prefix}.afterEvidenceRef`, rejected),
      evidenceRef: safeRef(entry.evidenceRef, `${prefix}.evidenceRef`, rejected),
      cursorOverlayRefs: safeRefArray(entry.cursorOverlayRefs, `${prefix}.cursorOverlayRefs`, rejected),
      leaseOwnerRefs: safeRefArray(entry.leaseOwnerRefs, `${prefix}.leaseOwnerRefs`, rejected),
      proposalRef: safeRef(entry.proposalRef ?? entry.actionProposalRef, `${prefix}.proposalRef`, rejected),
      blockedReason: normalizeStatus(entry.blockedReason),
      errorReason: normalizeStatus(entry.errorReason),
    });
  }
  return frames;
}

function normalizeEventRecords(value: unknown, field: string, rejected: VirtualScreenRejectedInput[]): VirtualScreenEvent[] {
  if (!Array.isArray(value)) return [];
  const events: VirtualScreenEvent[] = [];
  for (const [index, entry] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (!isRecord(entry)) {
      rejected.push({ field: prefix, label: 'unsupported payload field', kind: 'unsupported-payload-field' });
      continue;
    }
    const ref = safeRef(entry.ref, `${prefix}.ref`, rejected);
    const label = normalizeStatus(entry.label);
    if (ref && label) events.push({ ref, label, status: normalizeStatus(entry.status) });
  }
  return events;
}

function rejectedInputLabelForKey(key: string): Omit<VirtualScreenRejectedInput, 'field'> | undefined {
  const exact = rejectedInputLabels.find(([field]) => field === key);
  if (exact) return { label: exact[1], kind: exact[2] };
  if (/base64|raw.*(?:screenshot|frame|image)|screenshot.*raw/i.test(key)) {
    return { label: 'base64 image payload', kind: 'inline-image' };
  }
  if (/provider|model|apiKey|authorization|credential|token|secret|password/i.test(key)) {
    return { label: 'provider parameters', kind: 'provider-params' };
  }
  if (/sdp|iceCandidates|transportOffer|transportAnswer/i.test(key)) {
    return { label: 'raw transport payload', kind: 'raw-json' };
  }
  if (/bridge/i.test(key)) {
    return { label: 'host bridge parameters', kind: 'host-bridge' };
  }
  if (/executor|execute/i.test(key)) {
    return { label: 'executor parameters', kind: 'executor-params' };
  }
  if (/scheduler/i.test(key)) {
    return { label: 'scheduler parameters', kind: 'scheduler-params' };
  }
  if (/trace|rawJson|rawJSON/i.test(key)) {
    return { label: 'raw trace payload', kind: 'raw-trace' };
  }
  return undefined;
}

function collectRejectedInputs(value: unknown, fieldPrefix = '', rejected: VirtualScreenRejectedInput[] = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRejectedInputs(entry, `${fieldPrefix}[${index}]`, rejected));
    return rejected;
  }
  if (!isRecord(value)) return rejected;
  for (const [key, entry] of Object.entries(value)) {
    const field = fieldPrefix ? `${fieldPrefix}.${key}` : key;
    const topLevelAllowed = !fieldPrefix && allowedPayloadFields.has(key);
    const knownRejection = topLevelAllowed ? undefined : rejectedInputLabelForKey(key);
    if (!topLevelAllowed) {
      if (knownRejection) {
        rejected.push({ field, label: knownRejection.label, kind: knownRejection.kind });
      } else if (!fieldPrefix) {
        rejected.push({ field, label: 'unsupported payload field', kind: 'unsupported-payload-field' });
      }
    }
    if (typeof entry === 'string' && isInlineOrUnsafeRef(entry) && !topLevelAllowed) {
      rejected.push({ field, label: 'unsafe ref value', kind: 'unsafe-ref' });
    }
    if (isRecord(entry) || Array.isArray(entry)) collectRejectedInputs(entry, field, rejected);
  }
  return rejected;
}

function uniqueRejectedInputs(rejected: VirtualScreenRejectedInput[]) {
  const seen = new Set<string>();
  return rejected
    .filter((warning) => {
      const key = `${warning.kind}:${warning.field}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.field.localeCompare(right.field));
}

function gateStatus(value: string | undefined) {
  return value?.trim().toLowerCase();
}

function hasGateStatus(value: string | undefined, statuses: string[]) {
  const normalized = gateStatus(value);
  return Boolean(normalized && statuses.includes(normalized));
}

function isBlockedGateStatus(value: string | undefined) {
  return hasGateStatus(value, [
    'blocked',
    'denied',
    'disabled',
    'error',
    'failed',
    'missing',
    'not-granted',
    'not-installed',
    'revoked',
    'unavailable',
  ]);
}

function isObserveOnlyGateStatus(value: string | undefined) {
  return hasGateStatus(value, [
    'diagnostic',
    'observe-only',
    'pending',
    'read-only',
    'waiting',
  ]);
}

function permissionReady(payload: Pick<VirtualScreenPayload, 'permissionGranted' | 'permissionStatus'>) {
  if (payload.permissionGranted === true) return true;
  return hasGateStatus(payload.permissionStatus, ['available', 'granted', 'ready']);
}

function platformDriverReady(payload: Pick<VirtualScreenPayload, 'platformDriverRef' | 'platformDriverStatus'>) {
  return Boolean(
    payload.platformDriverRef
    && hasGateStatus(payload.platformDriverStatus, ['attached', 'available', 'ready', 'running']),
  );
}

function hasUnsafeIsolation(isolation: VirtualScreenPayload['isolationFlags']) {
  return Boolean(
    isolation?.affectsPhysicalDisplay === true
    || isolation?.requiresFocusSteal === true
    || isolation?.sharedSystemInputUsed === true
    || isolation?.systemPointerMoved === true
    || isolation?.systemKeyboardEventsSent === true
    || isolation?.singleInteractiveTruth === false
    || isolation?.secondInteractiveSurfacePresent === true,
  );
}

function hasCompleteNativeIsolation(isolation: VirtualScreenPayload['isolationFlags']) {
  return Boolean(
    isolation?.backgroundRenderable === true
    && isolation.affectsPhysicalDisplay === false
    && isolation.requiresFocusSteal === false
    && isolation.sharedSystemInputUsed === false
    && isolation.systemPointerMoved === false
    && isolation.systemKeyboardEventsSent === false
    && isolation.singleInteractiveTruth === true
    && isolation.secondInteractiveSurfacePresent === false
    && isolation.diagnosticOnly === false,
  );
}

function hasBlockedPlatformGate(payload: Omit<VirtualScreenPayload, 'attachState' | 'rejectedInputs'>) {
  return Boolean(
    (payload.permissionRequired === true && !permissionReady(payload))
    || payload.permissionGranted === false
    || isBlockedGateStatus(payload.permissionStatus)
    || isBlockedGateStatus(payload.platformDriverStatus)
    || payload.sharedInputAllowed === true
    || hasUnsafeIsolation(payload.isolationFlags),
  );
}

function hasObserveOnlyPlatformGate(payload: Omit<VirtualScreenPayload, 'attachState' | 'rejectedInputs'>) {
  return Boolean(
    isObserveOnlyGateStatus(payload.permissionStatus)
    || isObserveOnlyGateStatus(payload.platformDriverStatus)
    || !platformDriverReady(payload)
    || !payload.liveSurfaceRef
    || !payload.surfaceTransport
    || !hasCompleteNativeIsolation(payload.isolationFlags),
  );
}

function deriveAttachState(payload: Omit<VirtualScreenPayload, 'attachState' | 'rejectedInputs'>, explicit: VirtualAppScreenAttachState | undefined): VirtualAppScreenAttachState {
  if (payload.errorRef || payload.status === 'error' || explicit === 'error') return 'error';
  if (payload.blockedRef || payload.status === 'blocked' || explicit === 'blocked' || hasBlockedPlatformGate(payload)) return 'blocked';
  if (payload.status === 'requires-handoff' || explicit === 'requires-handoff') return 'requires-handoff';
  if (!payload.sessionRef && (payload.currentFrameRef || payload.replayRef || payload.frameRefs?.length)) return 'replay';
  if (!payload.sessionRef) return 'no-session';
  if (payload.status === 'observe-only' || explicit === 'observe-only' || hasObserveOnlyPlatformGate(payload)) return 'observe-only';
  if (explicit && explicit !== 'attached') return explicit;
  if (!payload.adapterReadinessRef || payload.status === 'adapter-unavailable') return 'adapter-unavailable';
  if (!payload.inputLeaseRef || !payload.actionAdapterRef) return 'observe-only';
  return 'attached';
}

function payloadFromProps(props: UIComponentRendererProps): VirtualScreenPayload {
  const artifactData = isRecord(props.artifact?.data) ? props.artifact.data : {};
  const slotProps = isRecord(props.slot.props) ? props.slot.props : {};
  return normalizePayload({ ...artifactData, ...slotProps });
}

function normalizePayload(value: Record<string, unknown>): VirtualScreenPayload {
  const rejectedInputs = collectRejectedInputs(value);
  const frameRefs = [
    ...normalizeFrameRecords(value.frameRefs, 'frameRefs', rejectedInputs),
    ...normalizeFrameRecords(value.frames, 'frames', rejectedInputs),
  ];
  const frameRef = safeRef(value.frameRef, 'frameRef', rejectedInputs);
  const currentFrameRef = safeRef(value.currentFrameRef, 'currentFrameRef', rejectedInputs)
    ?? frameRef
    ?? frameRefs[0]?.ref;
  const payloadWithoutAttachState = {
    title: normalizeStatus(value.title),
    status: normalizeStatus(value.status),
    displayGroupRef: safeRef(value.displayGroupRef, 'displayGroupRef', rejectedInputs),
    screenRef: safeRef(value.screenRef, 'screenRef', rejectedInputs),
    liveSurfaceRef: safeRef(value.liveSurfaceRef, 'liveSurfaceRef', rejectedInputs),
    surfaceTransport: normalizeSurfaceTransport(value.surfaceTransport, rejectedInputs),
    platformDriverRef: safeRef(value.platformDriverRef, 'platformDriverRef', rejectedInputs),
    platformDriverStatus: normalizeStatus(value.platformDriverStatus),
    visibleScreenRefs: safeRefArray(value.visibleScreenRefs, 'visibleScreenRefs', rejectedInputs),
    visibleCursorRefs: safeRefArray(value.visibleCursorRefs, 'visibleCursorRefs', rejectedInputs),
    targetAppRef: safeRef(value.targetAppRef, 'targetAppRef', rejectedInputs),
    targetWindowRef: safeRef(value.targetWindowRef, 'targetWindowRef', rejectedInputs),
    sessionRef: safeRef(value.sessionRef, 'sessionRef', rejectedInputs),
    frameStreamRef: safeRef(value.frameStreamRef, 'frameStreamRef', rejectedInputs),
    frameRef,
    frameRefs,
    currentFrameRef,
    beforeFrameRef: safeRef(value.beforeFrameRef, 'beforeFrameRef', rejectedInputs),
    afterFrameRef: safeRef(value.afterFrameRef, 'afterFrameRef', rejectedInputs),
    beforeAfterFrameRefs: safeRefArray(value.beforeAfterFrameRefs, 'beforeAfterFrameRefs', rejectedInputs),
    actorCursorRefs: safeRefArray(value.actorCursorRefs, 'actorCursorRefs', rejectedInputs),
    annotationOverlayRefs: safeRefArray(value.annotationOverlayRefs, 'annotationOverlayRefs', rejectedInputs),
    annotationProposalRefs: safeRefArray(value.annotationProposalRefs, 'annotationProposalRefs', rejectedInputs),
    inputIntentRefs: uniqueStrings([
      safeRef(value.inputIntentRef, 'inputIntentRef', rejectedInputs),
      ...safeRefArray(value.inputIntentRefs, 'inputIntentRefs', rejectedInputs),
    ]),
    executorEventRefs: uniqueStrings([
      safeRef(value.executorEventRef, 'executorEventRef', rejectedInputs),
      ...safeRefArray(value.executorEventRefs, 'executorEventRefs', rejectedInputs),
    ]),
    inputLeaseRef: safeRef(value.inputLeaseRef, 'inputLeaseRef', rejectedInputs),
    actionAdapterRef: safeRef(value.actionAdapterRef, 'actionAdapterRef', rejectedInputs),
    adapterReadinessRef: safeRef(value.adapterReadinessRef, 'adapterReadinessRef', rejectedInputs),
    replayRef: safeRef(value.replayRef, 'replayRef', rejectedInputs),
    evidenceLedgerRef: safeRef(value.evidenceLedgerRef, 'evidenceLedgerRef', rejectedInputs),
    artifactRefs: safeRefArray(value.artifactRefs, 'artifactRefs', rejectedInputs),
    verificationRefs: safeRefArray(value.verificationRefs, 'verificationRefs', rejectedInputs),
    guiPresentRefs: safeRefArray(value.guiPresentRefs, 'guiPresentRefs', rejectedInputs),
    beforeEvidenceRef: safeRef(value.beforeEvidenceRef, 'beforeEvidenceRef', rejectedInputs),
    afterEvidenceRef: safeRef(value.afterEvidenceRef, 'afterEvidenceRef', rejectedInputs),
    completionEvidenceRef: safeRef(value.completionEvidenceRef, 'completionEvidenceRef', rejectedInputs),
    blockedRef: safeRef(value.blockedRef, 'blockedRef', rejectedInputs),
    errorRef: safeRef(value.errorRef, 'errorRef', rejectedInputs),
    blockedReason: normalizeStatus(value.blockedReason),
    errorReason: normalizeStatus(value.errorReason),
    permissionRef: safeRef(value.permissionRef, 'permissionRef', rejectedInputs),
    permissionStatus: normalizeStatus(value.permissionStatus),
    permissionRequired: bool(value.permissionRequired),
    permissionGranted: bool(value.permissionGranted),
    sharedInputAllowed: bool(value.sharedInputAllowed),
    leaseStatus: normalizeStatus(value.leaseStatus),
    stopRef: safeRef(value.stopRef, 'stopRef', rejectedInputs),
    cancelLeaseRef: safeRef(value.cancelLeaseRef, 'cancelLeaseRef', rejectedInputs),
    handoffRef: safeRef(value.handoffRef, 'handoffRef', rejectedInputs),
    screen: normalizeScreen(value.screen),
    isolationFlags: normalizeIsolationFlags(value.isolationFlags ?? value.isolation),
    events: normalizeEventRecords(value.events, 'events', rejectedInputs),
    onTerminalEquivalentText: typeof value.onTerminalEquivalentText === 'function'
      ? value.onTerminalEquivalentText as VirtualScreenPayload['onTerminalEquivalentText']
      : undefined,
  };
  const attachState = deriveAttachState(payloadWithoutAttachState, normalizeAttachState(value.attachState ?? value.status));
  return {
    ...payloadWithoutAttachState,
    attachState,
    surfaceMode: deriveSurfaceMode(payloadWithoutAttachState, attachState, normalizeSurfaceMode(value.surfaceMode)),
    rejectedInputs: uniqueRejectedInputs(rejectedInputs),
  };
}

function deriveSurfaceMode(
  payload: Omit<VirtualScreenPayload, 'attachState' | 'rejectedInputs' | 'surfaceMode'>,
  attachState: VirtualAppScreenAttachState,
  explicit: VirtualScreenPayload['surfaceMode'],
): VirtualScreenPayload['surfaceMode'] {
  if (canRepresentLiveSurface(payload, attachState)) return 'live';
  if (explicit === 'empty' && !payload.currentFrameRef && !payload.replayRef && !payload.frameRefs?.length && !payload.frameStreamRef && !payload.liveSurfaceRef) return 'empty';
  if (explicit === 'replay') return 'replay';
  if (attachState === 'no-session' && !payload.currentFrameRef && !payload.replayRef && !payload.frameRefs?.length && !payload.frameStreamRef) return 'empty';
  return payload.currentFrameRef || payload.replayRef || payload.frameRefs?.length || payload.frameStreamRef ? 'replay' : 'empty';
}

function canRepresentLiveSurface(
  payload: Omit<VirtualScreenPayload, 'attachState' | 'rejectedInputs' | 'surfaceMode'>,
  attachState: VirtualAppScreenAttachState,
) {
  if (attachState !== 'attached' && attachState !== 'observe-only') return false;
  if (!payload.sessionRef || !payload.liveSurfaceRef || !payload.surfaceTransport) return false;
  if (!platformDriverReady(payload) || hasBlockedPlatformGate(payload)) return false;
  return true;
}

function normalizeScreen(value: unknown): VirtualScreenPayload['screen'] {
  if (!isRecord(value)) return undefined;
  const screen = {
    width: positiveNumber(value.width),
    height: positiveNumber(value.height),
    label: s(value.label),
  };
  return screen.width || screen.height || screen.label ? screen : undefined;
}

function materializedFrameUrl(frameRef: string | undefined) {
  return frameRef ? `/api/sciforge/preview/raw?ref=${encodeURIComponent(frameRef)}` : undefined;
}

function terminalQuote(value: string) {
  return JSON.stringify(value);
}

function ratio(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value)).toFixed(4);
}

function positiveFiniteFrameDimension(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return `${value}`;
}

function shouldIncludeFrameDimensions(kind: VirtualScreenInputIntentKind) {
  return kind === 'click'
    || kind === 'drag'
    || kind === 'scroll'
    || kind === 'hotkey'
    || kind === 'type_text';
}

function canRequestInputIntent(payload: VirtualScreenPayload) {
  return Boolean(
    payload.attachState === 'attached'
    && payload.sessionRef
    && payload.liveSurfaceRef
    && payload.surfaceTransport
    && platformDriverReady(payload)
    && permissionReady(payload)
    && !hasBlockedPlatformGate(payload)
    && payload.currentFrameRef
    && payload.inputLeaseRef
    && payload.actionAdapterRef
    && payload.adapterReadinessRef
    && hasCompleteNativeIsolation(payload.isolationFlags),
  );
}

function inputIntentTargetRef(payload: VirtualScreenPayload) {
  return payload.sessionRef ?? payload.screenRef ?? payload.targetWindowRef ?? payload.targetAppRef;
}

export function buildVirtualScreenInputIntentCommand(
  payload: VirtualScreenPayload,
  action: VirtualScreenInputIntentCommand,
): string | undefined {
  if (!canRequestInputIntent(payload)) return undefined;
  const includeFrameDimensions = shouldIncludeFrameDimensions(action.kind);
  const candidateFrameWidth = includeFrameDimensions ? positiveFiniteFrameDimension(payload.screen?.width) : undefined;
  const candidateFrameHeight = includeFrameDimensions ? positiveFiniteFrameDimension(payload.screen?.height) : undefined;
  const frameWidth = candidateFrameWidth && candidateFrameHeight ? candidateFrameWidth : undefined;
  const frameHeight = candidateFrameWidth && candidateFrameHeight ? candidateFrameHeight : undefined;
  const parts = [
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    `--kind ${action.kind}`,
    `--session-ref ${terminalQuote(payload.sessionRef ?? '')}`,
    payload.screenRef ? `--screen-ref ${terminalQuote(payload.screenRef)}` : undefined,
    payload.targetAppRef ? `--target-app-ref ${terminalQuote(payload.targetAppRef)}` : undefined,
    payload.targetWindowRef ? `--target-window-ref ${terminalQuote(payload.targetWindowRef)}` : undefined,
    `--frame-ref ${terminalQuote(payload.currentFrameRef ?? '')}`,
    `--input-lease-ref ${terminalQuote(payload.inputLeaseRef ?? '')}`,
    `--action-adapter-ref ${terminalQuote(payload.actionAdapterRef ?? '')}`,
    `--adapter-readiness-ref ${terminalQuote(payload.adapterReadinessRef ?? '')}`,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    frameWidth ? `--frame-width ${frameWidth}` : undefined,
    frameHeight ? `--frame-height ${frameHeight}` : undefined,
    ratio(action.xRatio) ? `--x-ratio ${ratio(action.xRatio)}` : undefined,
    ratio(action.yRatio) ? `--y-ratio ${ratio(action.yRatio)}` : undefined,
    ratio(action.startXRatio) ? `--start-x-ratio ${ratio(action.startXRatio)}` : undefined,
    ratio(action.startYRatio) ? `--start-y-ratio ${ratio(action.startYRatio)}` : undefined,
    ratio(action.endXRatio) ? `--end-x-ratio ${ratio(action.endXRatio)}` : undefined,
    ratio(action.endYRatio) ? `--end-y-ratio ${ratio(action.endYRatio)}` : undefined,
    action.button ? `--button ${action.button}` : undefined,
    typeof action.clickCount === 'number' && action.clickCount > 1 ? `--click-count ${Math.min(3, Math.round(action.clickCount))}` : undefined,
    typeof action.deltaX === 'number' && Number.isFinite(action.deltaX) ? `--delta-x ${Math.round(action.deltaX)}` : undefined,
    typeof action.deltaY === 'number' && Number.isFinite(action.deltaY) ? `--delta-y ${Math.round(action.deltaY)}` : undefined,
    action.key ? `--key ${terminalQuote(action.key)}` : undefined,
    action.text ? `--text ${terminalQuote(action.text)}` : undefined,
    action.menuCommand ? `--menu-command ${terminalQuote(action.menuCommand)}` : undefined,
  ].filter(Boolean);
  return parts.join(' ');
}

function emitVirtualScreenInputIntent(
  payload: VirtualScreenPayload,
  action: VirtualScreenInputIntentCommand,
  label: string,
) {
  const commandText = buildVirtualScreenInputIntentCommand(payload, action);
  const targetRef = inputIntentTargetRef(payload);
  if (!commandText || !targetRef) return;
  payload.onTerminalEquivalentText?.({ commandText, label, targetRef });
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function virtualScreenFramePoint(
  target: HTMLImageElement,
  event: React.MouseEvent<HTMLImageElement> | React.PointerEvent<HTMLImageElement> | React.WheelEvent<HTMLImageElement>,
) {
  const rect = target.getBoundingClientRect();
  const xRatio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
  const yRatio = rect.height ? (event.clientY - rect.top) / rect.height : 0;
  return {
    xRatio: clampNumber(xRatio, 0, 1),
    yRatio: clampNumber(yRatio, 0, 1),
  };
}

function virtualScreenMouseButton(button: number): VirtualScreenPointerButton {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}

function virtualScreenPointerDistance(
  target: HTMLImageElement,
  point: { xRatio: number; yRatio: number },
) {
  const startX = Number(target.dataset.intentStartXRatio ?? point.xRatio);
  const startY = Number(target.dataset.intentStartYRatio ?? point.yRatio);
  return Math.hypot(point.xRatio - startX, point.yRatio - startY);
}

function cleanupVirtualScreenPointer(target: HTMLImageElement) {
  delete target.dataset.intentPointerDown;
  delete target.dataset.intentPointerButton;
  delete target.dataset.intentStartXRatio;
  delete target.dataset.intentStartYRatio;
}

function focusVirtualScreenKeyboardInput(target: HTMLElement, point?: { clientX: number; clientY: number }) {
  const frame = target.parentElement;
  const input = frame?.querySelector<HTMLTextAreaElement>('.virtual-screen-keyboard-input');
  if (input && frame && point) {
    const frameRect = frame.getBoundingClientRect();
    const localX = clampNumber(point.clientX - frameRect.left, 0, Math.max(0, frameRect.width - 16));
    const localY = clampNumber(point.clientY - frameRect.top - 13, 0, Math.max(0, frameRect.height - 28));
    input.style.left = `${Math.round(localX)}px`;
    input.style.top = `${Math.round(localY)}px`;
    input.style.width = `${Math.round(Math.max(48, frameRect.width - localX - 8))}px`;
    input.style.height = '28px';
    input.value = '';
    input.dataset.sentValue = '';
  }
  input?.focus({ preventScroll: true });
}

function sendVirtualScreenInputText(
  input: HTMLTextAreaElement,
  payload: VirtualScreenPayload,
  compositionText = '',
) {
  const sentValue = input.dataset.sentValue ?? '';
  const value = input.value || compositionText;
  const text = value.startsWith(sentValue) ? value.slice(sentValue.length) : value || compositionText;
  input.dataset.sentValue = input.value || value;
  if (text) emitVirtualScreenInputIntent(payload, { kind: 'type_text', text }, 'Screen type');
}

function virtualScreenKeyboardAction(event: React.KeyboardEvent): { kind: 'type_text'; text: string } | { kind: 'hotkey'; key: string } | undefined {
  if (event.key === 'Dead' || event.nativeEvent.isComposing) return undefined;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) return { kind: 'type_text', text: event.key };
  const modifierPrefix = [
    event.ctrlKey ? 'Control' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey && event.key.length !== 1 ? 'Shift' : '',
  ].filter(Boolean).join('+');
  const key = virtualScreenPressKey(event.key);
  if (!key) return undefined;
  return { kind: 'hotkey', key: modifierPrefix ? `${modifierPrefix}+${key}` : key };
}

function virtualScreenPressKey(key: string) {
  if (key === ' ') return 'Space';
  const allowed = new Set([
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'Escape',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]);
  if (allowed.has(key)) return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return undefined;
}

function virtualScreenKeyboardHotkeyAction(event: React.KeyboardEvent): { kind: 'hotkey'; key: string } | undefined {
  if (event.key === 'Dead' || event.nativeEvent.isComposing) return undefined;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) return undefined;
  const action = virtualScreenKeyboardAction(event);
  return action?.kind === 'hotkey' ? action : undefined;
}

function mirrorVirtualScreenSpecialKey(input: HTMLTextAreaElement, key: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (key === 'Backspace' && start > 0) {
    const nextStart = start === end ? start - 1 : start;
    input.value = `${input.value.slice(0, nextStart)}${input.value.slice(end)}`;
    input.setSelectionRange(nextStart, nextStart);
    input.dataset.sentValue = input.value;
    return;
  }
  if (key === 'Delete' && start < input.value.length) {
    const nextEnd = start === end ? end + 1 : end;
    input.value = `${input.value.slice(0, start)}${input.value.slice(nextEnd)}`;
    input.setSelectionRange(start, start);
    input.dataset.sentValue = input.value;
    return;
  }
  if (key === 'ArrowLeft') input.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1));
  if (key === 'ArrowRight') input.setSelectionRange(Math.min(input.value.length, end + 1), Math.min(input.value.length, end + 1));
  if (key === 'Home') input.setSelectionRange(0, 0);
  if (key === 'End') input.setSelectionRange(input.value.length, input.value.length);
}

function command(label: string, commandText: string, targetRef: string | undefined, onTerminalEquivalentText: VirtualScreenPayload['onTerminalEquivalentText']) {
  return (
    <button
      type="button"
      data-event="virtual-screen-terminal-equivalent-text"
      data-command-text={commandText}
      disabled={!targetRef}
      onClick={() => targetRef ? onTerminalEquivalentText?.({ commandText, label, targetRef }) : undefined}
    >
      {label}
    </button>
  );
}

function refChip(label: string, ref: string | undefined) {
  if (!ref) return null;
  return (
    <span className="virtual-screen-ref-chip">
      <strong>{label}</strong>
      <code>{ref}</code>
    </span>
  );
}

function refList(label: string, refs: string[]) {
  if (!refs.length) return null;
  return (
    <span className="virtual-screen-ref-chip">
      <strong>{label}</strong>
      {refs.map((ref) => <code key={ref}>{ref}</code>)}
    </span>
  );
}

function statusChip(label: string, value: string | boolean | undefined) {
  if (value === undefined) return null;
  return (
    <span className="virtual-screen-ref-chip">
      <strong>{label}</strong>
      <code>{String(value)}</code>
    </span>
  );
}

function attachStateCopy(state: VirtualAppScreenAttachState) {
  const copy: Record<VirtualAppScreenAttachState, { title: string; detail: string }> = {
    attached: {
      title: 'VirtualAppScreen attached',
      detail: 'A local native app session is attached through the platform virtual display truth source.',
    },
    replay: {
      title: 'VirtualAppScreen replay',
      detail: 'A refs-first frame or replay bundle is available; it is evidence, not an alternate control path.',
    },
    'no-session': {
      title: 'No VirtualAppScreen session',
      detail: 'No active app screen session ref is attached.',
    },
    'adapter-unavailable': {
      title: 'Adapter unavailable',
      detail: 'Scoped action adapter readiness is missing or reports unavailable.',
    },
    'observe-only': {
      title: 'Observe-only',
      detail: 'The platform surface can be observed, but input is closed until driver, permission, lease, and isolation refs are all ready.',
    },
    blocked: {
      title: 'VirtualAppScreen blocked',
      detail: 'Platform permission, driver, or isolation requirements are not satisfied; resolve the blocked ref before control.',
    },
    'requires-handoff': {
      title: 'User handoff required',
      detail: 'This target cannot be controlled through isolated platform virtual display input.',
    },
    error: {
      title: 'VirtualAppScreen error',
      detail: 'A bounded error ref is available for diagnosis.',
    },
  };
  return copy[state];
}

function isolationRows(isolation: VirtualScreenPayload['isolationFlags']) {
  const rows = [
    ['affects physical display', isolation?.affectsPhysicalDisplay],
    ['requires focus steal', isolation?.requiresFocusSteal],
    ['shared input', isolation?.sharedSystemInputUsed],
    ['system pointer', isolation?.systemPointerMoved],
    ['system keyboard', isolation?.systemKeyboardEventsSent],
    ['background renderable', isolation?.backgroundRenderable],
    ['single interactive truth', isolation?.singleInteractiveTruth],
    ['second interactive surface', isolation?.secondInteractiveSurfacePresent],
    ['diagnostic only', isolation?.diagnosticOnly],
  ] as const;
  return rows.map(([label, value]) => (
    <span key={label} data-isolation-flag={label} data-isolation-value={String(value ?? 'unknown')}>
      {label}: <strong>{String(value ?? 'unknown')}</strong>
    </span>
  ));
}

function cursorRefStyle(index: number): React.CSSProperties {
  const left = 18 + (index % 4) * 18;
  const top = 22 + (index % 3) * 20;
  return {
    left: `${left}%`,
    top: `${top}%`,
    '--cursor-color': index % 2 ? '#059669' : '#2563eb',
  } as React.CSSProperties;
}

interface TimelineRow {
  kind: string;
  ref: string;
  activeFrame?: boolean;
}

function pushTimelineRow(rows: TimelineRow[], kind: string, ref: string | undefined, activeFrame = false) {
  if (!ref) return;
  const key = `${kind}:${ref}`;
  if (rows.some((row) => `${row.kind}:${row.ref}` === key)) return;
  rows.push({ kind, ref, activeFrame });
}

function frameTimeline(payload: VirtualScreenPayload) {
  const rows: TimelineRow[] = [];
  pushTimelineRow(rows, 'display-group', payload.displayGroupRef);
  pushTimelineRow(rows, 'screen', payload.screenRef);
  pushTimelineRow(rows, 'target-app', payload.targetAppRef);
  pushTimelineRow(rows, 'target-window', payload.targetWindowRef);
  pushTimelineRow(rows, 'live-surface', payload.liveSurfaceRef);
  pushTimelineRow(rows, 'platform-driver', payload.platformDriverRef);
  pushTimelineRow(rows, 'frame-stream', payload.frameStreamRef);
  for (const frame of payload.frameRefs ?? []) pushTimelineRow(rows, frame.ref === payload.currentFrameRef ? 'current-frame' : 'frame', frame.ref, frame.ref === payload.currentFrameRef);
  pushTimelineRow(rows, 'before', payload.beforeFrameRef);
  pushTimelineRow(rows, 'current-frame', payload.currentFrameRef, true);
  pushTimelineRow(rows, 'after', payload.afterFrameRef);
  for (const ref of payload.beforeAfterFrameRefs ?? []) pushTimelineRow(rows, 'before-after', ref);
  pushTimelineRow(rows, 'before-evidence', payload.beforeEvidenceRef);
  pushTimelineRow(rows, 'after-evidence', payload.afterEvidenceRef);
  pushTimelineRow(rows, 'completion-evidence', payload.completionEvidenceRef);
  for (const ref of payload.actorCursorRefs ?? []) pushTimelineRow(rows, 'actor-cursor', ref);
  for (const ref of payload.annotationOverlayRefs ?? []) pushTimelineRow(rows, 'annotation', ref);
  for (const ref of payload.annotationProposalRefs ?? []) pushTimelineRow(rows, 'proposal', ref);
  for (const ref of payload.inputIntentRefs ?? []) pushTimelineRow(rows, 'input-intent', ref);
  for (const ref of payload.executorEventRefs ?? []) pushTimelineRow(rows, 'executor-event', ref);
  pushTimelineRow(rows, 'adapter-readiness', payload.adapterReadinessRef);
  pushTimelineRow(rows, 'permission', payload.permissionRef);
  pushTimelineRow(rows, 'replay', payload.replayRef);
  pushTimelineRow(rows, 'evidence-ledger', payload.evidenceLedgerRef);
  pushTimelineRow(rows, 'blocked', payload.blockedRef);
  pushTimelineRow(rows, 'error', payload.errorRef);
  for (const event of payload.events ?? []) pushTimelineRow(rows, event.label, event.ref);
  return rows;
}

export function renderVirtualScreenViewer(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const currentFrameUrl = materializedFrameUrl(payload.currentFrameRef);
  const attachState = payload.attachState ?? 'no-session';
  const surfaceMode = payload.surfaceMode ?? (payload.currentFrameRef || payload.replayRef || payload.frameRefs?.length || payload.frameStreamRef ? 'replay' : 'empty');
  const presentationMode = surfaceMode === 'live'
    ? VIRTUAL_SCREEN_LIVE_PRESENTATION_MODE
    : surfaceMode === 'replay'
      ? VIRTUAL_SCREEN_REPLAY_PRESENTATION_MODE
      : 'empty';
  const attachCopy = attachStateCopy(attachState);
  const title = payload.title ?? props.slot.title ?? 'VirtualAppScreen';
  const timeline = frameTimeline(payload);
  const observeTargetRef = payload.sessionRef ?? payload.targetWindowRef ?? payload.targetAppRef;
  const stopTargetRef = payload.stopRef ?? payload.sessionRef;
  const handoffTargetRef = payload.handoffRef ?? payload.sessionRef;
  const inputIntentReady = canRequestInputIntent(payload);

  if (attachState === 'no-session' && !payload.targetAppRef && !payload.targetWindowRef && !(payload.rejectedInputs ?? []).length) {
    return (
      <div
        className="virtual-screen-viewer"
        data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID}
        data-render-boundary="presentation-only"
        data-presentation-mode="empty"
        data-status="empty"
        data-attach-state="no-session"
        data-screen-surface-mode="empty"
        data-placeholder-evidence="false"
      >
        {ComponentEmptyState ? (
          <ComponentEmptyState componentId={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} artifactType={props.artifact?.type ?? VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE} detail="VirtualAppScreen attach state: no-session." />
        ) : (
          <p>VirtualAppScreen attach state: no-session.</p>
        )}
      </div>
    );
  }

  return (
    <div
      className="virtual-screen-viewer"
      data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID}
      data-render-boundary="presentation-only"
      data-presentation-mode={presentationMode}
      data-status={payload.status ?? attachState}
      data-attach-state={attachState}
      data-screen-surface-mode={surfaceMode}
      data-platform-driver-status={payload.platformDriverStatus}
      data-permission-status={payload.permissionStatus}
      data-shared-input-allowed={payload.sharedInputAllowed === undefined ? undefined : String(payload.sharedInputAllowed)}
    >
      <header className="virtual-screen-toolbar">
        <div>
          <strong>{title}</strong>
          <span>{payload.targetWindowRef ?? payload.targetAppRef ?? payload.sessionRef ?? attachCopy.title}</span>
        </div>
        <div className="virtual-screen-toolbar-actions">
          {command('Observe', `/computer-use observe --session-ref ${JSON.stringify(observeTargetRef ?? '')}`, observeTargetRef, payload.onTerminalEquivalentText)}
          {command('Replay', `/computer-use replay --replay-ref ${JSON.stringify(payload.replayRef ?? '')}`, payload.replayRef, payload.onTerminalEquivalentText)}
          {command('Stop', `/computer-use stop --session-ref ${JSON.stringify(stopTargetRef ?? '')}`, stopTargetRef, payload.onTerminalEquivalentText)}
          {attachState === 'requires-handoff'
            ? command('Handoff', `/computer-use handoff --session-ref ${JSON.stringify(handoffTargetRef ?? '')}`, handoffTargetRef, payload.onTerminalEquivalentText)
            : null}
          {surfaceMode === 'live' ? <span data-screen-presentation-mode={VIRTUAL_SCREEN_LIVE_PRESENTATION_MODE}>Live surface</span> : null}
          {surfaceMode === 'replay' ? <span data-screen-presentation-mode={VIRTUAL_SCREEN_REPLAY_PRESENTATION_MODE}>Replay/ref inspector</span> : null}
          <span>{attachState}</span>
        </div>
      </header>
      <section className="virtual-screen-stage" aria-label="Computer Use VirtualAppScreen">
        <div
          className="virtual-screen-frame"
          data-frame-evidence={payload.currentFrameRef ? 'ref' : 'none'}
          data-input-intent-ready={inputIntentReady ? 'true' : 'false'}
          data-command-boundary="terminal-equivalent-input-intent"
          data-live-surface-ref={payload.liveSurfaceRef}
          data-surface-transport={payload.surfaceTransport}
          data-platform-driver-ref={payload.platformDriverRef}
          data-platform-driver-status={payload.platformDriverStatus}
          data-permission-ref={payload.permissionRef}
          data-permission-status={payload.permissionStatus}
        >
          {payload.currentFrameRef && currentFrameUrl ? (
            <>
              <img
                className="virtual-screen-frame-image"
                src={currentFrameUrl}
                alt="VirtualAppScreen current frame"
                data-event="virtual-screen-input-intent-request"
                data-frame-ref={payload.currentFrameRef}
                data-frame-stream-ref={payload.frameStreamRef}
                data-frame-stream-mode="ref-only"
                data-live-surface-ref={payload.liveSurfaceRef}
                data-surface-transport={payload.surfaceTransport}
                data-platform-driver-ref={payload.platformDriverRef}
                data-platform-driver-status={payload.platformDriverStatus}
                data-permission-ref={payload.permissionRef}
                data-permission-status={payload.permissionStatus}
                data-screen-surface-mode={surfaceMode}
                data-target-app-ref={payload.targetAppRef}
                data-target-window-ref={payload.targetWindowRef}
                data-input-intent-ready={inputIntentReady ? 'true' : 'false'}
                tabIndex={inputIntentReady ? 0 : -1}
                draggable={false}
                role="application"
                aria-label="VirtualAppScreen interactive frame"
                onFocus={(event) => {
                  if (inputIntentReady) focusVirtualScreenKeyboardInput(event.currentTarget);
                }}
                onPointerDown={(event) => {
                  if (!inputIntentReady || event.button < 0 || event.button > 2) return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusVirtualScreenKeyboardInput(event.currentTarget, event);
                  const point = virtualScreenFramePoint(event.currentTarget, event);
                  const button = virtualScreenMouseButton(event.button);
                  event.currentTarget.dataset.intentPointerDown = 'true';
                  event.currentTarget.dataset.intentPointerButton = button;
                  event.currentTarget.dataset.intentStartXRatio = String(point.xRatio);
                  event.currentTarget.dataset.intentStartYRatio = String(point.yRatio);
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    // Pointer capture is best-effort; the input intent still records the scoped target.
                  }
                }}
                onPointerUp={(event) => {
                  if (!inputIntentReady || event.currentTarget.dataset.intentPointerDown !== 'true') return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusVirtualScreenKeyboardInput(event.currentTarget, event);
                  const point = virtualScreenFramePoint(event.currentTarget, event);
                  const button = (event.currentTarget.dataset.intentPointerButton as VirtualScreenPointerButton | undefined) ?? virtualScreenMouseButton(event.button);
                  const startXRatio = Number(event.currentTarget.dataset.intentStartXRatio ?? point.xRatio);
                  const startYRatio = Number(event.currentTarget.dataset.intentStartYRatio ?? point.yRatio);
                  const dragged = virtualScreenPointerDistance(event.currentTarget, point) >= 0.004;
                  emitVirtualScreenInputIntent(
                    payload,
                    dragged
                      ? {
                          kind: 'drag',
                          startXRatio,
                          startYRatio,
                          endXRatio: point.xRatio,
                          endYRatio: point.yRatio,
                          button,
                        }
                      : {
                          kind: 'click',
                          xRatio: point.xRatio,
                          yRatio: point.yRatio,
                          button,
                        },
                    dragged ? 'Screen drag' : 'Screen click',
                  );
                  cleanupVirtualScreenPointer(event.currentTarget);
                  try {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  } catch {
                    // The user agent may already have released capture after pointerup.
                  }
                }}
                onPointerCancel={(event) => {
                  if (!inputIntentReady || event.currentTarget.dataset.intentPointerDown !== 'true') return;
                  event.preventDefault();
                  event.stopPropagation();
                  cleanupVirtualScreenPointer(event.currentTarget);
                }}
                onLostPointerCapture={(event) => {
                  cleanupVirtualScreenPointer(event.currentTarget);
                }}
                onDoubleClick={(event) => {
                  if (!inputIntentReady) return;
                  event.preventDefault();
                  event.stopPropagation();
                  focusVirtualScreenKeyboardInput(event.currentTarget, event);
                  const point = virtualScreenFramePoint(event.currentTarget, event);
                  emitVirtualScreenInputIntent(payload, {
                    kind: 'click',
                    xRatio: point.xRatio,
                    yRatio: point.yRatio,
                    button: virtualScreenMouseButton(event.button),
                    clickCount: 2,
                  }, 'Screen double click');
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onWheel={(event) => {
                  if (!inputIntentReady) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const point = virtualScreenFramePoint(event.currentTarget, event);
                  emitVirtualScreenInputIntent(payload, {
                    kind: 'scroll',
                    xRatio: point.xRatio,
                    yRatio: point.yRatio,
                    deltaX: event.deltaX,
                    deltaY: event.deltaY,
                  }, 'Screen scroll');
                }}
                onKeyDown={(event) => {
                  if (!inputIntentReady) return;
                  const action = virtualScreenKeyboardAction(event);
                  event.preventDefault();
                  event.stopPropagation();
                  if (action) emitVirtualScreenInputIntent(payload, action, action.kind === 'hotkey' ? 'Screen hotkey' : 'Screen type');
                }}
                onKeyUp={(event) => {
                  if (!inputIntentReady) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
              />
              <textarea
                className="virtual-screen-keyboard-input"
                aria-label="VirtualAppScreen keyboard input"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                tabIndex={-1}
                disabled={!inputIntentReady}
                onCompositionStart={(event) => {
                  event.stopPropagation();
                  event.currentTarget.dataset.composing = 'true';
                }}
                onCompositionEnd={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.dataset.composing = '';
                  sendVirtualScreenInputText(event.currentTarget, payload, event.data);
                }}
                onInput={(event) => {
                  event.stopPropagation();
                  if (event.currentTarget.dataset.composing === 'true') return;
                  sendVirtualScreenInputText(event.currentTarget, payload);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  const action = virtualScreenKeyboardHotkeyAction(event);
                  if (!action) return;
                  event.preventDefault();
                  mirrorVirtualScreenSpecialKey(event.currentTarget, event.key);
                  emitVirtualScreenInputIntent(payload, action, 'Screen hotkey');
                }}
                onKeyUp={(event) => {
                  event.stopPropagation();
                }}
              />
            </>
          ) : (
            <div className="virtual-screen-empty-frame" data-attach-state={attachState} data-placeholder-evidence="false">
              <strong>{attachCopy.title}</strong>
              <span>{attachCopy.detail}</span>
            </div>
          )}
          {(payload.actorCursorRefs ?? []).map((ref, index) => (
            <span
              key={ref}
              className="virtual-screen-cursor"
              style={cursorRefStyle(index)}
              title={`actor cursor ${index + 1}`}
              data-actor-cursor-ref={ref}
              data-cursor-state="ref-only"
            >
              <i />
              <b>{`cursor ${index + 1}`}</b>
              <code>{ref}</code>
            </span>
          ))}
          {(payload.annotationOverlayRefs ?? []).map((ref, index) => (
            <span
              key={ref}
              className="virtual-screen-annotation-overlay"
              data-annotation-overlay-ref={ref}
              style={{ left: `${12 + index * 16}%`, top: `${68 - index * 8}%` }}
            >
              <code>{ref}</code>
            </span>
          ))}
        </div>
      </section>
      <footer className="virtual-screen-footer">
        <div className="virtual-screen-attach-state" data-attach-state={attachState} data-placeholder-evidence="false">
          <strong>{attachCopy.title}</strong>
          <span>{attachCopy.detail}</span>
          {payload.blockedReason ? <span data-blocked-reason={payload.blockedReason}>{payload.blockedReason}</span> : null}
          {payload.errorReason ? <span data-error-reason={payload.errorReason}>{payload.errorReason}</span> : null}
        </div>
        <div className="virtual-screen-refs">
          {refChip('display group', payload.displayGroupRef)}
          {refChip('screen', payload.screenRef)}
          {refChip('target app', payload.targetAppRef)}
          {refChip('target window', payload.targetWindowRef)}
          {refChip('session', payload.sessionRef)}
          {refChip('live surface', payload.liveSurfaceRef)}
          {statusChip('surface transport', payload.surfaceTransport)}
          {refChip('platform driver', payload.platformDriverRef)}
          {statusChip('platform driver status', payload.platformDriverStatus)}
          {refChip('frame stream', payload.frameStreamRef)}
          {refChip('current frame', payload.currentFrameRef)}
          {refChip('before', payload.beforeFrameRef)}
          {refChip('after', payload.afterFrameRef)}
          {refList('before/after', payload.beforeAfterFrameRefs ?? [])}
          {refChip('before evidence', payload.beforeEvidenceRef)}
          {refChip('after evidence', payload.afterEvidenceRef)}
          {refChip('completion evidence', payload.completionEvidenceRef)}
          {refList('actor cursors', payload.actorCursorRefs ?? [])}
          {refList('annotations', payload.annotationOverlayRefs ?? [])}
          {refList('proposals', payload.annotationProposalRefs ?? [])}
          {refList('input intents', payload.inputIntentRefs ?? [])}
          {refList('executor events', payload.executorEventRefs ?? [])}
          {refChip('input lease', payload.inputLeaseRef)}
          {statusChip('lease status', payload.leaseStatus)}
          {refChip('action adapter', payload.actionAdapterRef)}
          {refChip('adapter readiness', payload.adapterReadinessRef)}
          {refChip('permission', payload.permissionRef)}
          {statusChip('permission status', payload.permissionStatus)}
          {statusChip('permission required', payload.permissionRequired)}
          {statusChip('permission granted', payload.permissionGranted)}
          {statusChip('shared input allowed', payload.sharedInputAllowed)}
          {refChip('replay', payload.replayRef)}
          {refChip('evidence ledger', payload.evidenceLedgerRef)}
          {refList('artifacts', payload.artifactRefs ?? [])}
          {refList('verification', payload.verificationRefs ?? [])}
          {refList('gui present', payload.guiPresentRefs ?? [])}
          {refChip('blocked', payload.blockedRef)}
          {refChip('error', payload.errorRef)}
          {refChip('cancel lease', payload.cancelLeaseRef)}
        </div>
        {(payload.rejectedInputs ?? []).length ? (
          <div className="virtual-screen-rejected-inputs" data-unsafe-input-rejected="true" aria-label="Rejected Computer Use inputs">
            <strong>Rejected non-presentation inputs</strong>
            {(payload.rejectedInputs ?? []).map((warning) => (
              <span key={`${warning.kind}:${warning.field}`} data-rejection-kind={warning.kind} data-rejected-field={warning.field}>
                {warning.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="virtual-screen-isolation" aria-label="Computer Use isolation flags">
          {isolationRows(payload.isolationFlags)}
        </div>
        {timeline.length ? (
          <ol className="virtual-screen-timeline" aria-label="Computer Use replay timeline">
            {timeline.map((event, index) => (
              <li key={`${event.kind}:${event.ref}:${index}`} data-timeline-kind={event.kind} data-active-frame={event.activeFrame ? 'true' : undefined}>
                <span>{event.kind}</span>
                <code>{event.ref}</code>
              </li>
            ))}
          </ol>
        ) : null}
      </footer>
    </div>
  );
}
