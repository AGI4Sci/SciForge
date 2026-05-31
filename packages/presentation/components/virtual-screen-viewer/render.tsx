import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
  VIRTUAL_SCREEN_VIEWER_COMPONENT_ID,
} from './manifest';

export interface VirtualScreenCursor {
  actorId?: string;
  cursorId?: string;
  label?: string;
  color?: string;
  x?: number;
  y?: number;
  state?: string;
}

export interface VirtualScreenFrame {
  ref: string;
  screenRef?: string;
  label?: string;
  status?: string;
  frameUrl?: string;
  frameDataRef?: string;
  screenshotRef?: string;
  framePreviewUrl?: string;
  thumbnailPreviewUrl?: string;
  rawUrl?: string;
  safePreviewUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  beforeEvidenceRef?: string;
  afterEvidenceRef?: string;
  evidenceRef?: string;
  cursorOverlayRefs?: string[];
  leaseOwnerRefs?: string[];
  proposalRef?: string;
  blockedReason?: string;
  errorReason?: string;
}

export interface VirtualScreenEvent {
  label?: string;
  ref?: string;
  status?: string;
  kind?: string;
  frameRef?: string;
  beforeEvidenceRef?: string;
  afterEvidenceRef?: string;
  cursorOverlayRef?: string;
  leaseOwnerRef?: string;
  proposalRef?: string;
}

export interface VirtualScreenLeaseOwner {
  ref: string;
  label?: string;
  status?: string;
  ownerRef?: string;
  scopeRef?: string;
}

export interface VirtualScreenProposal {
  ref: string;
  label?: string;
  status?: string;
  actorRef?: string;
  cursorRef?: string;
  frameRef?: string;
  approvalRef?: string;
  riskLevel?: string;
}

export interface VirtualScreenRunSummary {
  schemaVersion?: string;
  status?: string;
  runId?: string;
  validationRef?: string;
  currentBundleRef?: string;
  evidenceBundleIndexRef?: string;
  replayRef?: string;
  validationStatus?: string;
  validationOk?: boolean;
  sidecarBindingRef?: string;
  sidecarCapabilitiesRef?: string;
  sidecarDiscoveryRef?: string;
  sidecarBindingKind?: string;
  realNativeSidecarExecuted?: boolean;
  completionEligible?: boolean;
  screenCount?: number;
  actorCursorCount?: number;
  frameCount?: number;
  cursorOverlayCount?: number;
  schedulerLeaseCount?: number;
  targetCount?: number;
  blockedReason?: string;
}

type VirtualScreenRejectedInputKind =
  | 'inline-screenshot'
  | 'inline-image'
  | 'raw-json'
  | 'raw-trace'
  | 'provider-route'
  | 'provider-params'
  | 'desktop-bridge'
  | 'executor-lease'
  | 'scheduler-params'
  | 'unsafe-preview-url';

export interface VirtualScreenRejectedInput {
  field: string;
  label: string;
  kind: VirtualScreenRejectedInputKind;
}

export interface VirtualScreenPayload {
  title?: string;
  status?: string;
  sessionRef?: string;
  displayGroupRef?: string;
  screenRef?: string;
  visibleScreenRefs: string[];
  visibleCursorRefs: string[];
  frameRef?: string;
  frameRefs: VirtualScreenFrame[];
  replayRef?: string;
  cursorOverlayRefs: string[];
  leaseOwnerRefs: VirtualScreenLeaseOwner[];
  proposalRefs: string[];
  proposals: VirtualScreenProposal[];
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
  screen?: { width?: number; height?: number; label?: string };
  actorCursors?: VirtualScreenCursor[];
  isolation?: Record<string, unknown>;
  runSummary?: VirtualScreenRunSummary;
  events?: VirtualScreenEvent[];
  rejectedInputs: VirtualScreenRejectedInput[];
  onTerminalEquivalentText?: (event: { commandText: string; label: string; targetRef?: string }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function s(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function n(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(s).filter((ref): ref is string => Boolean(ref)) : [];
}

function payloadFromProps(props: UIComponentRendererProps): VirtualScreenPayload {
  const artifactData = isRecord(props.artifact?.data) ? props.artifact.data : {};
  const slotProps = isRecord(props.slot.props) ? props.slot.props : {};
  return normalizePayload({ ...artifactData, ...slotProps });
}

const rejectedInputLabels: Array<[string, string]> = [
  ['rawScreenshot', 'inline screenshot'],
  ['screenshot', 'inline screenshot'],
  ['screenshotBase64', 'base64 image payload'],
  ['imageBase64', 'base64 image payload'],
  ['base64Screenshot', 'base64 image payload'],
  ['frameBase64', 'base64 image payload'],
  ['frameData', 'base64 image payload'],
  ['rawFrame', 'base64 image payload'],
  ['rawTrace', 'raw trace payload'],
  ['traceJson', 'raw trace payload'],
  ['rawJson', 'raw JSON payload'],
  ['rawJSON', 'raw JSON payload'],
  ['providerJson', 'raw provider payload'],
  ['providerRoute', 'provider route'],
  ['providerParams', 'provider parameters'],
  ['desktopBridge', 'desktop bridge parameters'],
  ['executorLease', 'executor lease parameters'],
  ['executorLeaseParams', 'executor lease parameters'],
  ['schedulerParams', 'scheduler parameters'],
];

function rejectionKind(label: string): VirtualScreenRejectedInputKind {
  if (label === 'inline screenshot') return 'inline-screenshot';
  if (label === 'base64 image payload') return 'inline-image';
  if (label === 'raw JSON payload') return 'raw-json';
  if (label === 'raw provider payload') return 'raw-json';
  if (label === 'raw trace payload') return 'raw-trace';
  if (label === 'provider route') return 'provider-route';
  if (label === 'provider parameters') return 'provider-params';
  if (label === 'desktop bridge parameters') return 'desktop-bridge';
  if (label === 'executor lease parameters') return 'executor-lease';
  return 'scheduler-params';
}

function rejectedInputsFrom(value: Record<string, unknown>, fieldPrefix = ''): VirtualScreenRejectedInput[] {
  const rejected: VirtualScreenRejectedInput[] = [];
  for (const [key, label] of rejectedInputLabels) {
    if (key in value) {
      rejected.push({
        field: `${fieldPrefix}${key}`,
        label,
        kind: rejectionKind(label),
      });
    }
  }
  return rejected;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isInlineOrUnsafeImageUrl(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.includes(';base64,')
  );
}

function isSafeHostedFramePreviewUrl(value: string) {
  return value.startsWith('/api/sciforge/preview/') && !value.startsWith('//');
}

function isUnsafeFramePreviewUrl(value: string | undefined) {
  if (!value) return false;
  if (isInlineOrUnsafeImageUrl(value)) return true;
  const normalized = value.trim();
  if (/^https?:\/\//i.test(normalized)) return true;
  if (normalized.startsWith('/')) return !isSafeHostedFramePreviewUrl(normalized);
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized);
}

function safeImageUrl(value: unknown): string | undefined {
  const url = s(value);
  if (!url || isUnsafeFramePreviewUrl(url)) return undefined;
  if (isSafeHostedFramePreviewUrl(url)) return url;
  return undefined;
}

function safeReason(value: unknown): string | undefined {
  const text = s(value);
  if (!text || isInlineOrUnsafeImageUrl(text)) return undefined;
  if (/^\s*[\[{]/u.test(text) || /authorization|bearer|api[_-]?key|password|secret|token/i.test(text)) {
    return 'Reason detail is available by ref.';
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function unsafePreviewWarningsFrom(value: Record<string, unknown>, fieldPrefix = ''): VirtualScreenRejectedInput[] {
  const previewFields = [
    'frameUrl',
    'frameDataRef',
    'framePreviewUrl',
    'thumbnailPreviewUrl',
    'safePreviewUrl',
    'previewUrl',
    'thumbnailUrl',
    'rawUrl',
  ];
  return previewFields.flatMap((field) => {
    const url = s(value[field]);
    return url && isUnsafeFramePreviewUrl(url) ? [{
      field: `${fieldPrefix}${field}`,
      label: 'unsafe frame preview URL',
      kind: 'unsafe-preview-url' as const,
    }] : [];
  });
}

function uniqueRejectedInputs(rejected: VirtualScreenRejectedInput[]) {
  const seen = new Set<string>();
  return rejected.filter((warning) => {
    const key = `${warning.kind}:${warning.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.field.localeCompare(right.field));
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(s).find(Boolean);
  return s(value);
}

function mergeDefinedFrame(previous: VirtualScreenFrame, next: VirtualScreenFrame): VirtualScreenFrame {
  const merged: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[key] = value;
  }
  return merged as unknown as VirtualScreenFrame;
}

function normalizeFrame(value: unknown): VirtualScreenFrame | undefined {
  if (typeof value === 'string') {
    const ref = s(value);
    return ref ? { ref } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const frameDataRef = s(value.frameDataRef);
  const frameDataPreviewUrl = safeImageUrl(frameDataRef);
  const ref = s(value.ref) ?? s(value.frameRef) ?? s(value.screenshotRef) ?? s(value.frameDataRef);
  if (!ref) return undefined;
  return {
    ref,
    screenRef: s(value.screenRef),
    label: s(value.label),
    status: s(value.status),
    frameUrl: safeImageUrl(value.frameUrl) ?? frameDataPreviewUrl,
    frameDataRef,
    framePreviewUrl: safeImageUrl(value.framePreviewUrl) ?? safeImageUrl(value.frameUrl) ?? frameDataPreviewUrl,
    thumbnailPreviewUrl: safeImageUrl(value.thumbnailPreviewUrl),
    screenshotRef: s(value.screenshotRef),
    rawUrl: safeImageUrl(value.rawUrl),
    safePreviewUrl: safeImageUrl(value.safePreviewUrl),
    previewUrl: safeImageUrl(value.previewUrl),
    thumbnailUrl: safeImageUrl(value.thumbnailUrl),
    width: n(value.width),
    height: n(value.height),
    beforeEvidenceRef: s(value.beforeEvidenceRef) ?? stringArray(value.beforeEvidenceRefs)[0],
    afterEvidenceRef: s(value.afterEvidenceRef) ?? stringArray(value.afterEvidenceRefs)[0],
    evidenceRef: s(value.evidenceRef),
    cursorOverlayRefs: stringArray(value.cursorOverlayRefs),
    leaseOwnerRefs: stringArray(value.leaseOwnerRefs),
    proposalRef: s(value.proposalRef) ?? s(value.actionProposalRef),
    blockedReason: safeReason(value.blockedReason),
    errorReason: safeReason(value.errorReason),
  };
}

function normalizeFrames(value: Record<string, unknown>) {
  const frameInputs = [
    ...(Array.isArray(value.frameRefs) ? value.frameRefs : []),
    ...(Array.isArray(value.frames) ? value.frames : []),
  ];
  const frames: VirtualScreenFrame[] = [];
  for (const frame of frameInputs.map(normalizeFrame).filter((frame): frame is VirtualScreenFrame => Boolean(frame))) {
    const existingIndex = frames.findIndex((candidate) => candidate.ref === frame.ref);
    if (existingIndex >= 0) {
      frames[existingIndex] = mergeDefinedFrame(frames[existingIndex], frame);
    } else {
      frames.push(frame);
    }
  }
  const legacyFrameRef = s(value.frameRef);
  if (legacyFrameRef && !frames.some((frame) => frame.ref === legacyFrameRef)) {
    const frameDataRef = s(value.frameDataRef);
    const frameDataPreviewUrl = safeImageUrl(frameDataRef);
    frames.unshift({
      ref: legacyFrameRef,
      screenRef: s(value.screenRef),
      label: s(value.frameLabel) ?? 'latest',
      status: s(value.frameStatus),
      frameUrl: safeImageUrl(value.frameUrl) ?? frameDataPreviewUrl,
      frameDataRef,
      screenshotRef: s(value.screenshotRef),
      framePreviewUrl: safeImageUrl(value.framePreviewUrl) ?? safeImageUrl(value.frameUrl) ?? frameDataPreviewUrl,
      thumbnailPreviewUrl: safeImageUrl(value.thumbnailPreviewUrl),
      rawUrl: safeImageUrl(value.rawUrl),
      safePreviewUrl: safeImageUrl(value.safePreviewUrl),
      previewUrl: safeImageUrl(value.previewUrl),
      thumbnailUrl: safeImageUrl(value.thumbnailUrl),
      beforeEvidenceRef: s(value.beforeEvidenceRef),
      afterEvidenceRef: s(value.afterEvidenceRef),
      evidenceRef: s(value.evidenceRef),
      cursorOverlayRefs: stringArray(value.cursorOverlayRefs),
      leaseOwnerRefs: stringArray(value.leaseOwnerRefs),
      proposalRef: s(value.proposalRef) ?? s(value.actionProposalRef),
      blockedReason: safeReason(value.blockedReason),
      errorReason: safeReason(value.errorReason),
    });
  }
  return frames;
}

function frameRejectedInputsFrom(value: Record<string, unknown>) {
  const frameInputs = [
    ...(Array.isArray(value.frameRefs) ? value.frameRefs : []),
    ...(Array.isArray(value.frames) ? value.frames : []),
  ];
  return [
    ...frameInputs.flatMap((frame, index) => (
      isRecord(frame)
        ? [
          ...rejectedInputsFrom(frame, `frameRefs[${index}].`),
          ...unsafePreviewWarningsFrom(frame, `frameRefs[${index}].`),
        ]
        : []
    )),
    ...unsafePreviewWarningsFrom(value),
  ];
}

function normalizeRefObjects(value: unknown): VirtualScreenLeaseOwner[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') {
      const ref = s(entry);
      return ref ? { ref } : undefined;
    }
    if (!isRecord(entry)) return undefined;
    const ref = s(entry.ref) ?? s(entry.leaseOwnerRef);
    return ref ? { ref, label: s(entry.label), status: s(entry.status), ownerRef: s(entry.ownerRef), scopeRef: s(entry.scopeRef) } : undefined;
  }).filter((entry): entry is VirtualScreenLeaseOwner => Boolean(entry));
}

function uniqueLeaseOwners(values: VirtualScreenLeaseOwner[]) {
  const owners = new Map<string, VirtualScreenLeaseOwner>();
  for (const value of values) {
    const existing = owners.get(value.ref);
    owners.set(value.ref, existing ? { ...existing, ...value } : value);
  }
  return [...owners.values()];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeProposals(value: Record<string, unknown>): VirtualScreenProposal[] {
  const proposalObjects = Array.isArray(value.proposals) ? value.proposals : [];
  const proposals: VirtualScreenProposal[] = proposalObjects.flatMap((entry): VirtualScreenProposal[] => {
    if (typeof entry === 'string') {
      const ref = s(entry);
      return ref ? [{ ref }] : [];
    }
    if (!isRecord(entry)) return [];
    const ref = s(entry.ref) ?? s(entry.proposalRef) ?? s(entry.actionProposalRef);
    return ref ? [{
      ref,
      label: s(entry.label),
      status: s(entry.status) ?? s(entry.approvalState),
      actorRef: s(entry.actorRef),
      cursorRef: s(entry.cursorRef),
      frameRef: s(entry.frameRef),
      approvalRef: s(entry.approvalRef) ?? s(entry.approvalRequestRef),
      riskLevel: s(entry.riskLevel),
    }] : [];
  });
  const existingRefs = new Set(proposals.map((proposal) => proposal.ref));
  for (const ref of uniqueStrings([
    ...stringArray(value.proposalRefs),
    ...stringArray(value.actionProposalRefs),
    s(value.proposalRef),
    s(value.actionProposalRef),
  ])) {
    if (!existingRefs.has(ref)) proposals.push({ ref });
  }
  return proposals;
}

function normalizeRunSummary(
  value: unknown,
  fallback: Partial<VirtualScreenRunSummary>,
): VirtualScreenRunSummary | undefined {
  const raw = isRecord(value) ? value : {};
  const summary: VirtualScreenRunSummary = {
    schemaVersion: s(raw.schemaVersion) ?? 'sciforge.computer-use.run-summary.v1',
    status: s(raw.status) ?? fallback.status,
    runId: s(raw.runId) ?? fallback.runId,
    validationRef: s(raw.validationRef) ?? fallback.validationRef,
    currentBundleRef: s(raw.currentBundleRef) ?? fallback.currentBundleRef,
    evidenceBundleIndexRef: s(raw.evidenceBundleIndexRef) ?? s(raw.evidenceIndexRef) ?? fallback.evidenceBundleIndexRef,
    replayRef: s(raw.replayRef) ?? fallback.replayRef,
    validationStatus: safeReason(raw.validationStatus) ?? fallback.validationStatus,
    validationOk: bool(raw.validationOk) ?? fallback.validationOk,
    sidecarBindingRef: s(raw.sidecarBindingRef) ?? fallback.sidecarBindingRef,
    sidecarCapabilitiesRef: s(raw.sidecarCapabilitiesRef) ?? fallback.sidecarCapabilitiesRef,
    sidecarDiscoveryRef: s(raw.sidecarDiscoveryRef) ?? fallback.sidecarDiscoveryRef,
    sidecarBindingKind: safeReason(raw.sidecarBindingKind) ?? fallback.sidecarBindingKind,
    realNativeSidecarExecuted: bool(raw.realNativeSidecarExecuted) ?? fallback.realNativeSidecarExecuted,
    completionEligible: bool(raw.completionEligible) ?? fallback.completionEligible,
    screenCount: positiveInteger(raw.screenCount) ?? fallback.screenCount,
    actorCursorCount: positiveInteger(raw.actorCursorCount) ?? fallback.actorCursorCount,
    frameCount: positiveInteger(raw.frameCount) ?? fallback.frameCount,
    cursorOverlayCount: positiveInteger(raw.cursorOverlayCount) ?? fallback.cursorOverlayCount,
    schedulerLeaseCount: positiveInteger(raw.schedulerLeaseCount) ?? fallback.schedulerLeaseCount,
    targetCount: positiveInteger(raw.targetCount) ?? fallback.targetCount,
    blockedReason: safeReason(raw.blockedReason) ?? fallback.blockedReason,
  };
  const useful = Object.entries(summary).some(([key, entry]) => key !== 'schemaVersion' && entry !== undefined);
  return useful ? summary : undefined;
}

function normalizePayload(value: Record<string, unknown>): VirtualScreenPayload {
  const screen = isRecord(value.screen) ? value.screen : {};
  const frames = normalizeFrames(value);
  const proposals = normalizeProposals(value);
  const frameCursorOverlayRefs = frames.flatMap((frame) => frame.cursorOverlayRefs ?? []);
  const frameLeaseOwnerRefs = frames.flatMap((frame) => frame.leaseOwnerRefs ?? []);
  const leaseOwnerRefs = uniqueLeaseOwners(normalizeRefObjects([
    ...normalizeRefObjects(value.leaseOwnerRefs),
    ...frameLeaseOwnerRefs,
  ]));
  const beforeEvidenceRefs = uniqueStrings([
    s(value.beforeEvidenceRef),
    ...stringArray(value.beforeEvidenceRefs),
    ...frames.map((frame) => frame.beforeEvidenceRef),
  ]);
  const afterEvidenceRefs = uniqueStrings([
    s(value.afterEvidenceRef),
    ...stringArray(value.afterEvidenceRefs),
    ...frames.map((frame) => frame.afterEvidenceRef),
  ]);
  const isolation = isRecord(value.isolation) ? {
    sharedSystemInputUsed: bool(value.isolation.sharedSystemInputUsed),
    systemPointerMoved: bool(value.isolation.systemPointerMoved),
    systemKeyboardEventsSent: bool(value.isolation.systemKeyboardEventsSent),
    inputExecuted: bool(value.isolation.inputExecuted) ?? bool(value.isolation.virtualInputExecuted),
    diagnosticOnly: bool(value.isolation.diagnosticOnly),
  } : undefined;
  const runSummary = normalizeRunSummary(value.runSummary, {
    status: s(value.status),
    runId: s(value.runId),
    validationRef: s(value.validationRef),
    currentBundleRef: s(value.currentBundleRef),
    evidenceBundleIndexRef: s(value.evidenceBundleIndexRef) ?? s(value.evidenceIndexRef),
    replayRef: s(value.replayRef),
    validationStatus: safeReason(value.validationStatus),
    validationOk: bool(value.validationOk),
    sidecarBindingRef: s(value.sidecarBindingRef),
    sidecarCapabilitiesRef: s(value.sidecarCapabilitiesRef),
    sidecarDiscoveryRef: s(value.sidecarDiscoveryRef),
    sidecarBindingKind: safeReason(value.sidecarBindingKind),
    realNativeSidecarExecuted: bool(value.realNativeSidecarExecuted),
    completionEligible: bool(value.completionEligible),
    screenCount: positiveInteger(value.screenCount) ?? uniqueStrings([...stringArray(value.visibleScreenRefs), s(value.screenRef), ...frames.map((frame) => frame.screenRef)]).length,
    actorCursorCount: positiveInteger(value.actorCursorCount) ?? Math.max(recordArray(value.actorCursors).length, stringArray(value.visibleCursorRefs).length),
    frameCount: positiveInteger(value.frameCount) ?? frames.length,
    cursorOverlayCount: positiveInteger(value.cursorOverlayCount) ?? uniqueStrings([...stringArray(value.cursorOverlayRefs), ...frameCursorOverlayRefs]).length,
    schedulerLeaseCount: positiveInteger(value.schedulerLeaseCount) ?? uniqueLeaseOwners(normalizeRefObjects([...normalizeRefObjects(value.leaseOwnerRefs), ...frameLeaseOwnerRefs])).length,
    targetCount: positiveInteger(value.targetCount) ?? stringArray(value.targetRefs).length,
    blockedReason: safeReason(value.blockedReason),
  });
  return {
    title: s(value.title),
    status: s(value.status),
    sessionRef: s(value.sessionRef),
    displayGroupRef: s(value.displayGroupRef),
    screenRef: s(value.screenRef),
    visibleScreenRefs: [
      ...new Set([
        ...stringArray(value.visibleScreenRefs),
        s(value.screenRef),
        ...frames.map((frame) => frame.screenRef),
      ].filter((ref): ref is string => Boolean(ref))),
    ],
    visibleCursorRefs: stringArray(value.visibleCursorRefs),
    frameRef: s(value.frameRef),
    frameRefs: frames,
    replayRef: s(value.replayRef),
    cursorOverlayRefs: uniqueStrings([
      ...stringArray(value.cursorOverlayRefs),
      ...frameCursorOverlayRefs,
    ]),
    leaseOwnerRefs,
    proposalRefs: uniqueStrings([
      ...stringArray(value.proposalRefs),
      ...stringArray(value.actionProposalRefs),
      ...proposals.map((proposal) => proposal.ref),
      ...frames.map((frame) => frame.proposalRef),
    ]),
    proposals,
    beforeEvidenceRef: beforeEvidenceRefs[0],
    afterEvidenceRef: afterEvidenceRefs[0],
    completionEvidenceRef: s(value.completionEvidenceRef),
    blockedRef: s(value.blockedRef),
    errorRef: s(value.errorRef),
    blockedReason: safeReason(value.blockedReason),
    errorReason: safeReason(value.errorReason),
    permissionRef: s(value.permissionRef),
    permissionStatus: s(value.permissionStatus),
    permissionRequired: bool(value.permissionRequired),
    permissionGranted: bool(value.permissionGranted),
    sharedInputAllowed: bool(value.sharedInputAllowed),
    leaseStatus: s(value.leaseStatus),
    stopRef: s(value.stopRef),
    cancelLeaseRef: s(value.cancelLeaseRef),
    screen: {
      width: n(screen.width),
      height: n(screen.height),
      label: s(screen.label),
    },
    actorCursors: Array.isArray(value.actorCursors) ? value.actorCursors.filter(isRecord).map((cursor) => ({
      actorId: s(cursor.actorId),
      cursorId: s(cursor.cursorId),
      label: s(cursor.label),
      color: s(cursor.color),
      x: n(cursor.x),
      y: n(cursor.y),
      state: s(cursor.state),
    })) : [],
    isolation,
    runSummary,
    events: Array.isArray(value.events) ? value.events.filter(isRecord).map((event) => ({
      label: s(event.label),
      ref: s(event.ref),
      status: s(event.status),
      kind: s(event.kind),
      frameRef: s(event.frameRef),
      beforeEvidenceRef: s(event.beforeEvidenceRef),
      afterEvidenceRef: s(event.afterEvidenceRef),
      cursorOverlayRef: s(event.cursorOverlayRef),
      leaseOwnerRef: s(event.leaseOwnerRef),
      proposalRef: s(event.proposalRef) ?? s(event.actionProposalRef),
    })) : [],
    rejectedInputs: uniqueRejectedInputs([
      ...rejectedInputsFrom(value),
      ...frameRejectedInputsFrom(value),
    ]),
    onTerminalEquivalentText: typeof value.onTerminalEquivalentText === 'function'
      ? value.onTerminalEquivalentText as VirtualScreenPayload['onTerminalEquivalentText']
      : undefined,
  };
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

function activeFrame(payload: VirtualScreenPayload) {
  return payload.frameRefs[0];
}

function frameImageUrl(frame: VirtualScreenFrame | undefined) {
  return frame?.frameUrl
    ?? frame?.framePreviewUrl
    ?? frame?.thumbnailPreviewUrl
    ?? safeImageUrl(frame?.frameDataRef)
    ?? frame?.safePreviewUrl
    ?? frame?.previewUrl
    ?? frame?.thumbnailUrl
    ?? frame?.rawUrl;
}

function isolationRows(isolation: VirtualScreenPayload['isolation']) {
  const rows = [
    ['shared input', isolation?.sharedSystemInputUsed],
    ['system pointer', isolation?.systemPointerMoved],
    ['system keyboard', isolation?.systemKeyboardEventsSent],
    ['input executed', isolation?.inputExecuted],
    ['diagnostic only', isolation?.diagnosticOnly],
  ] as const;
  return rows.map(([label, value]) => (
    <span key={label} data-isolation-flag={label} data-isolation-value={String(value ?? 'unknown')}>
      {label}: <strong>{String(value ?? 'unknown')}</strong>
    </span>
  ));
}

function controlFlagRows(payload: VirtualScreenPayload) {
  const rows = [
    ['permission status', payload.permissionStatus],
    ['permission required', payload.permissionRequired],
    ['permission granted', payload.permissionGranted],
    ['shared input allowed', payload.sharedInputAllowed],
    ['lease status', payload.leaseStatus],
  ] as const;
  return rows.map(([label, value]) => (
    <span key={label} data-control-flag={label} data-control-value={String(value ?? 'unknown')}>
      {label}: <strong>{String(value ?? 'unknown')}</strong>
    </span>
  ));
}

function runSummaryRows(summary: VirtualScreenRunSummary | undefined) {
  if (!summary) return [];
  const rows = [
    ['status', summary.status],
    ['screens', summary.screenCount],
    ['actor cursors', summary.actorCursorCount],
    ['frames', summary.frameCount],
    ['cursor overlays', summary.cursorOverlayCount],
    ['scheduler leases', summary.schedulerLeaseCount],
    ['targets', summary.targetCount],
    ['sidecar', summary.sidecarBindingKind],
    ['validation', summary.validationStatus],
    ['validation ok', summary.validationOk],
    ['real native sidecar', summary.realNativeSidecarExecuted],
    ['completion eligible', summary.completionEligible],
    ['blocked reason', summary.blockedReason],
  ] as const;
  return rows
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([label, value]) => (
      <span key={label} data-run-summary-field={label}>
        {label}: <strong>{String(value)}</strong>
      </span>
    ));
}

function runSummaryRefs(summary: VirtualScreenRunSummary | undefined) {
  if (!summary) return [];
  return uniqueStrings([
    summary.validationRef,
    summary.currentBundleRef,
    summary.evidenceBundleIndexRef,
    summary.replayRef,
    summary.sidecarBindingRef,
    summary.sidecarCapabilitiesRef,
    summary.sidecarDiscoveryRef,
  ]);
}

function statusReasonRows(payload: VirtualScreenPayload, frame: VirtualScreenFrame | undefined) {
  const rows = [
    ['blocked', payload.blockedReason ?? frame?.blockedReason],
    ['error', payload.errorReason ?? frame?.errorReason],
  ] as const;
  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => (
      <span key={label} data-status-reason={label}>
        {label}: <strong>{value}</strong>
      </span>
    ));
}

function cursorStyle(cursor: VirtualScreenCursor, width: number, height: number): React.CSSProperties {
  const x = Math.max(0, Math.min(100, ((cursor.x ?? 0) / Math.max(1, width)) * 100));
  const y = Math.max(0, Math.min(100, ((cursor.y ?? 0) / Math.max(1, height)) * 100));
  return {
    left: `${x}%`,
    top: `${y}%`,
    '--cursor-color': cursor.color || '#00e5a0',
  } as React.CSSProperties;
}

function frameTimeline(payload: VirtualScreenPayload) {
  const eventRows = payload.events ?? [];
  const frameRows = payload.frameRefs.map((frame, index) => ({
    label: frame.label ?? `frame ${index + 1}`,
    ref: frame.evidenceRef ?? frame.ref,
    status: frame.status,
    kind: 'frame',
    frameRef: frame.ref,
    beforeEvidenceRef: frame.beforeEvidenceRef,
    afterEvidenceRef: frame.afterEvidenceRef,
    cursorOverlayRef: frame.cursorOverlayRefs?.[0],
    leaseOwnerRef: frame.leaseOwnerRefs?.[0],
    proposalRef: frame.proposalRef,
  }));
  return [...frameRows, ...eventRows];
}

export function renderVirtualScreenViewer(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const currentFrame = activeFrame(payload);
  const currentFrameUrl = frameImageUrl(currentFrame);
  const hasRefs = Boolean(
    payload.sessionRef
    || payload.screenRef
    || payload.frameRef
    || payload.replayRef
    || payload.visibleScreenRefs.length
    || payload.frameRefs.length
    || payload.proposalRefs.length
    || payload.completionEvidenceRef
    || payload.blockedRef
    || payload.errorRef,
  );
  if (!hasRefs) {
    return (
      <div className="virtual-screen-viewer" data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} data-render-boundary="presentation-only" data-status="empty">
        {ComponentEmptyState ? (
          <ComponentEmptyState componentId={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} artifactType={props.artifact?.type ?? VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE} detail="Virtual screen refs are not attached." />
        ) : (
          <p>Virtual screen refs are not attached.</p>
        )}
      </div>
    );
  }
  const width = payload.screen?.width ?? 1440;
  const height = payload.screen?.height ?? 900;
  const status = payload.status ?? 'waiting';
  const timeline = frameTimeline(payload);
  const statusReasons = statusReasonRows(payload, currentFrame);
  const summaryRows = runSummaryRows(payload.runSummary);
  const summaryRefs = runSummaryRefs(payload.runSummary);
  return (
    <div className="virtual-screen-viewer" data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} data-render-boundary="presentation-only" data-status={status}>
      <header className="virtual-screen-toolbar">
        <div>
          <strong>{payload.title ?? props.slot.title ?? 'Virtual Screen'}</strong>
          <span>{payload.screen?.label ?? payload.screenRef ?? 'screen'}</span>
        </div>
        <div className="virtual-screen-toolbar-actions">
          {command('Observe', `/computer-use observe --screen-ref ${JSON.stringify(payload.screenRef ?? payload.sessionRef ?? '')}`, payload.screenRef ?? payload.sessionRef, payload.onTerminalEquivalentText)}
          {command('Replay', `/computer-use replay --replay-ref ${JSON.stringify(payload.replayRef ?? '')}`, payload.replayRef, payload.onTerminalEquivalentText)}
          {command('Stop', `/computer-use stop --stop-ref ${JSON.stringify(payload.stopRef ?? '')}`, payload.stopRef, payload.onTerminalEquivalentText)}
          <span>{status}</span>
        </div>
      </header>
      <section className="virtual-screen-stage" aria-label="Computer Use virtual screen">
        <div className="virtual-screen-frame" style={{ aspectRatio: `${width} / ${height}` }}>
          {currentFrame && currentFrameUrl ? (
            <img
              className="virtual-screen-frame-image"
              src={currentFrameUrl}
              alt={currentFrame.label ?? payload.screen?.label ?? 'Computer Use virtual screen frame'}
              data-frame-ref={currentFrame.ref}
              data-frame-data-ref={currentFrame.frameDataRef}
              data-screenshot-ref={currentFrame.screenshotRef}
              data-screen-ref={currentFrame.screenRef ?? payload.screenRef}
            />
          ) : currentFrame ? (
            <div className="virtual-screen-empty-frame" data-frame-ref={currentFrame.ref}>
              <strong>Frame preview unavailable</strong>
              <span>Host did not provide a safe frame preview URL.</span>
            </div>
          ) : (
            <div className="virtual-screen-empty-frame">
              <strong>Waiting for virtual display frame</strong>
              <span>No inline screenshot payload is embedded in GUI state.</span>
            </div>
          )}
          {payload.actorCursors?.map((cursor, index) => (
            <span
              key={`${cursor.actorId ?? 'actor'}:${cursor.cursorId ?? index}`}
              className="virtual-screen-cursor"
              style={cursorStyle(cursor, width, height)}
              title={`${cursor.label ?? cursor.actorId ?? 'actor'} ${cursor.state ?? ''}`.trim()}
            >
              <i />
              <b>{cursor.label ?? cursor.actorId ?? `actor-${index + 1}`}</b>
              {cursor.state ? <em data-cursor-state={cursor.state}>{cursor.state}</em> : null}
            </span>
          ))}
        </div>
      </section>
      <footer className="virtual-screen-footer">
        <div className="virtual-screen-refs">
          {refChip('session', payload.sessionRef)}
          {refChip('display', payload.displayGroupRef)}
          {refList('screens', payload.visibleScreenRefs)}
          {refList('frames', payload.frameRefs.map((frame) => frame.ref))}
          {refList('frame data', payload.frameRefs.map((frame) => frame.frameDataRef).filter((ref): ref is string => Boolean(ref)))}
          {refList('cursors', payload.visibleCursorRefs)}
          {refList('cursor overlays', payload.cursorOverlayRefs)}
          {refList('proposals', payload.proposalRefs)}
          {refChip('replay', payload.replayRef)}
          {refChip('before', payload.beforeEvidenceRef)}
          {refChip('after', payload.afterEvidenceRef)}
          {refChip('completion', payload.completionEvidenceRef)}
          {refChip('blocked', payload.blockedRef)}
          {refChip('error', payload.errorRef)}
          {refChip('permission', payload.permissionRef)}
          {refChip('cancel', payload.cancelLeaseRef)}
        </div>
        {payload.leaseOwnerRefs.length ? (
          <div className="virtual-screen-lease-owners" aria-label="Computer Use lease owners">
            {payload.leaseOwnerRefs.map((lease) => (
              <span key={lease.ref} className="virtual-screen-ref-chip">
                <strong>{lease.label ?? 'lease owner'}</strong>
                <code>{lease.ref}</code>
                {lease.status ? <span>{lease.status}</span> : null}
                {lease.ownerRef ? <code>{lease.ownerRef}</code> : null}
                {lease.scopeRef ? <code>{lease.scopeRef}</code> : null}
              </span>
            ))}
          </div>
        ) : null}
        {payload.proposalRefs.length ? (
          <div className="virtual-screen-proposals" aria-label="Computer Use action proposals">
            {payload.proposals.length ? payload.proposals.map((proposal) => (
              <span key={proposal.ref} className="virtual-screen-ref-chip" data-proposal-status={proposal.status ?? 'unknown'}>
                <strong>{proposal.label ?? 'proposal'}</strong>
                <code>{proposal.ref}</code>
                {proposal.status ? <span>{proposal.status}</span> : null}
                {proposal.riskLevel ? <span>{proposal.riskLevel}</span> : null}
                {proposal.actorRef ? <code>{proposal.actorRef}</code> : null}
                {proposal.cursorRef ? <code>{proposal.cursorRef}</code> : null}
                {proposal.frameRef ? <code>{proposal.frameRef}</code> : null}
                {proposal.approvalRef ? <code>{proposal.approvalRef}</code> : null}
              </span>
            )) : payload.proposalRefs.map((ref) => (
              <span key={ref} className="virtual-screen-ref-chip" data-proposal-status="unknown">
                <strong>proposal</strong>
                <code>{ref}</code>
              </span>
            ))}
          </div>
        ) : null}
        {(payload.leaseStatus || payload.permissionStatus || statusReasons.length) ? (
          <div className="virtual-screen-status-details" aria-label="Computer Use status details">
            {payload.leaseStatus ? <span data-status-detail="lease">lease: <strong>{payload.leaseStatus}</strong></span> : null}
            {payload.permissionStatus ? <span data-status-detail="permission">permission: <strong>{payload.permissionStatus}</strong></span> : null}
            {statusReasons}
          </div>
        ) : null}
        {payload.rejectedInputs.length ? (
          <div className="virtual-screen-rejected-inputs" data-unsafe-input-rejected="true" aria-label="Rejected Computer Use inputs">
            <strong>Rejected non-presentation inputs</strong>
            {payload.rejectedInputs.map((warning) => (
              <span key={`${warning.kind}:${warning.field}`} data-rejection-kind={warning.kind} data-rejected-field={warning.field}>
                {warning.label}
              </span>
            ))}
          </div>
        ) : null}
        {summaryRows.length || summaryRefs.length ? (
          <div className="virtual-screen-run-summary" aria-label="Computer Use run summary" data-run-summary-status={payload.runSummary?.status ?? status}>
            <strong>Run summary</strong>
            {summaryRows}
            {summaryRefs.map((ref) => <code key={ref}>{ref}</code>)}
          </div>
        ) : null}
        <div className="virtual-screen-control-flags" aria-label="Computer Use permission flags">
          {controlFlagRows(payload)}
        </div>
        <div className="virtual-screen-isolation" aria-label="Computer Use isolation flags">
          {isolationRows(payload.isolation)}
        </div>
        {timeline.length ? (
          <ol className="virtual-screen-timeline" aria-label="Computer Use replay timeline">
            {timeline.map((event, index) => (
              <li key={`${event.ref ?? event.frameRef ?? event.label ?? 'event'}:${index}`} data-timeline-kind={event.kind ?? 'event'} data-active-frame={event.frameRef === currentFrame?.ref ? 'true' : undefined}>
                <span>{event.label ?? event.status ?? event.kind ?? 'event'}</span>
                {event.frameRef ? <code>{event.frameRef}</code> : null}
                {event.ref ? <code>{event.ref}</code> : null}
                {event.beforeEvidenceRef ? <code>{event.beforeEvidenceRef}</code> : null}
                {event.afterEvidenceRef ? <code>{event.afterEvidenceRef}</code> : null}
                {event.cursorOverlayRef ? <code>{event.cursorOverlayRef}</code> : null}
                {event.leaseOwnerRef ? <code>{event.leaseOwnerRef}</code> : null}
                {event.proposalRef ? <code>{event.proposalRef}</code> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </footer>
    </div>
  );
}
