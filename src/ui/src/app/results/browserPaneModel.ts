import {
  type BrowserWorkbenchStateStatus,
} from '../../../../../packages/presentation/components';
import type { ObjectReference, SciForgeReference } from '../../domain';
import {
  artifactForObjectReference,
  type ObjectReferenceSessionLike,
  pathForObjectReference,
} from '../../../../../packages/support/object-references';
import {
  buildBrowserWorkbenchPdfViewerUrl,
  browserPreviewSandboxForUrl,
  browserWorkbenchUrlIsLocal,
  normalizeBrowserWorkbenchUrl,
  shouldUseBrowserWorkbenchPdfViewerUrl,
} from '../browserWorkbenchUrlModel';
import {
  SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL,
  type SciForgeAnnotationBounds,
} from '../../../../../packages/contracts/runtime';

export type RightPaneBrowserProjectionStatus = BrowserWorkbenchStateStatus;
export type RightPaneBrowserProjectionTabStatus = 'new' | 'loading' | 'ready' | 'failed' | 'closed';

export const RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA = 'sciforge.browser-pane.loading-progress.lifecycle.v1' as const;
export const RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES = [
  'navigation-start',
  'navigation-committed',
  'interactive',
  'load',
  'network-quiet',
  'stalled',
  'blocked',
  'retry',
  'handoff',
] as const;

export type RightPaneBrowserLoadingProgressState = typeof RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES[number];
export type RightPaneBrowserLoadingProgressReason =
  | 'navigation-requested'
  | 'navigation-committed'
  | 'page-interactive'
  | 'page-load'
  | 'network-quiet'
  | 'navigation-stalled'
  | 'navigation-blocked'
  | 'navigation-retry'
  | 'user-handoff-required'
  | 'host-starting'
  | 'host-loading'
  | 'host-ready'
  | 'host-error'
  | 'host-diagnostic'
  | 'native-bridge-unavailable';
export type RightPaneBrowserLoadingProgressSource =
  | 'host-lifecycle'
  | 'host-progress'
  | 'host-navigation'
  | 'host-action-timing'
  | 'host-state'
  | 'host-session'
  | 'ui-command'
  | 'host-error'
  | 'native-surface-route';

export interface RightPaneBrowserLoadingProgressLifecycle {
  schemaVersion: typeof RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA;
  state: RightPaneBrowserLoadingProgressState;
  reason: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
  requestedUrl?: string;
  currentUrl?: string;
  finalUrl?: string;
  urlDigests?: {
    requested?: RightPaneBrowserBoundedUrlDigest;
    current?: RightPaneBrowserBoundedUrlDigest;
    final?: RightPaneBrowserBoundedUrlDigest;
  };
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export type RightPaneBrowserActorCursorStatus =
  | 'idle'
  | 'moving'
  | 'acting'
  | 'observing'
  | 'clicking'
  | 'typing'
  | 'scrolling'
  | 'waiting'
  | 'leaving'
  | 'paused'
  | 'stopped'
  | 'blocked'
  | 'done'
  | 'unknown';

export interface RightPaneBrowserActorCursorTargetProjection {
  ref?: string;
  kind?: string;
  label?: string;
}

export interface RightPaneBrowserActorCursorProjection {
  agentId: string;
  cursorId: string;
  color?: string;
  label?: string;
  status?: RightPaneBrowserActorCursorStatus;
  target?: RightPaneBrowserActorCursorTargetProjection;
  lastActionRef?: string;
  evidenceRefs?: string[];
}

export interface RightPaneBrowserBoundedUrlDigest {
  length: number;
  hash: string;
}

export interface RightPaneBrowserHostLoadingProgressRecord {
  schemaVersion?: string;
  state?: RightPaneBrowserLoadingProgressState | string;
  reason?: RightPaneBrowserLoadingProgressReason | string;
  source?: RightPaneBrowserLoadingProgressSource | string;
  status?: RightPaneBrowserProjectionStatus | RightPaneBrowserProjectionTabStatus | string;
  tabStatus?: RightPaneBrowserProjectionTabStatus;
  action?: string;
  updatedAt?: string;
  refs?: {
    session?: string;
    liveSurface?: string;
    frameStream?: string;
    frame?: string;
    screenshot?: string;
    domSnapshot?: string;
    axSnapshot?: string;
    consoleLog?: string;
    networkLog?: string;
    searchResult?: string;
  };
  urls?: {
    requested?: RightPaneBrowserHostUrlDigestRecord;
    current?: RightPaneBrowserHostUrlDigestRecord;
    final?: RightPaneBrowserHostUrlDigestRecord;
  };
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface RightPaneBrowserHostUrlDigestRecord {
  length?: number;
  sha1?: string;
  hash?: string;
}

export interface RightPaneBrowserLoadingProgressInput {
  targetUrl?: string;
  hostBusy?: boolean;
  hostError?: string;
  hostSession?: RightPaneBrowserHostSessionState | Record<string, unknown>;
  hostState?: RightPaneBrowserHostState | Record<string, unknown>;
}

export interface RightPaneBrowserProjectionState {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
  previewUrl?: string;
  externalUrl?: string;
  previewSandbox?: string;
  reason?: string;
  detail?: string;
  ref?: string;
  canRenderFrame?: boolean;
  hostSurface?: string;
  loadingProgress?: RightPaneBrowserLoadingProgressLifecycle;
  actorCursor?: RightPaneBrowserActorCursorProjection;
  actorCursors?: RightPaneBrowserActorCursorProjection[];
  embedPolicy?: {
    embeddable?: boolean;
    status?: RightPaneBrowserProjectionStatus;
    reason?: string;
    ref?: string;
  };
}

export interface RightPaneBrowserHostState {
  ok?: boolean;
  url?: string;
  reason?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  surface?: string;
}

export interface RightPaneBrowserHostSessionState {
  id: string;
  status: 'starting' | 'loading' | 'ready' | 'failed' | 'closed';
  requestedUrl?: string;
  url: string;
  title?: string;
  updatedAt?: string;
  workspaceWriterBaseUrl?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  liveSurfaceRef?: string;
  liveSurfaceTransport?: 'native-embedded' | 'host-stream' | 'webrtc-data-channel';
  singleInteractiveTruth?: true;
  secondTruthSource?: false;
  frameStreamRef?: string;
  frameRef?: string;
  frameUrl?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
  reason?: string;
  diagnostics?: string[];
  nativeSurfaceBridge?: RightPaneBrowserNativeSurfaceBridgeState;
  loadingProgress?: RightPaneBrowserLoadingProgressLifecycle | RightPaneBrowserHostLoadingProgressRecord;
  actorCursor?: RightPaneBrowserActorCursorProjection;
  actorCursors?: RightPaneBrowserActorCursorProjection[];
}

export interface RightPaneBrowserNativeSurfaceBridgeState {
  routeStatus?: 'unknown' | 'reachable' | 'unreachable';
  capability?: 'ready' | 'missing' | 'unknown';
  rightPaneBridge?: boolean;
  status?: 'ready' | 'native-bridge-unavailable' | 'route-unreachable' | 'unknown';
  healthPath?: string;
  attachPath?: string;
  statePath?: string;
  diagnosticRef?: string;
}

export interface RightPaneBrowserProjectionOptions {
  hostExternalBrowserAvailable?: boolean;
  hostSurface?: string;
  hostBusy?: boolean;
  hostSession?: RightPaneBrowserHostSessionState;
  hostState?: RightPaneBrowserHostState;
  hostError?: string;
}

export interface RightPaneBrowserAnnotationReferenceOptions {
  annotationRef?: string;
  targetRef?: string;
  cropRef?: string;
  screenshotRef?: string;
  bounds?: SciForgeAnnotationBounds;
  comment?: string;
  threadId?: string;
  messageDraftId?: string;
  createdAt?: string;
}

export function browserAddressForFocusedObjectReference(reference: ObjectReference | undefined, session: Pick<ObjectReferenceSessionLike, 'artifacts'>) {
  if (!reference) return undefined;
  const focusedHostSession = browserHostSessionForFocusedObjectReference(reference, session);
  if (focusedHostSession?.url) return normalizeRightPaneBrowserUrl(focusedHostSession.url);
  const artifactUrl = browserProjectionArtifactUrl(reference, session);
  if (artifactUrl) return normalizeRightPaneBrowserUrl(artifactUrl);
  if (reference.kind !== 'url' && !/^(?:url:|https?:\/\/|browser:|browser-runtime:|browser-session:|browser-snapshot:|browser-host-session:)/i.test(reference.ref)) return undefined;
  const path = pathForObjectReference(reference, session) ?? reference.ref.replace(/^url:/i, '');
  if (!path.trim()) return undefined;
  return normalizeRightPaneBrowserUrl(path);
}

export function browserHostSessionForFocusedObjectReference(
  reference: ObjectReference | undefined,
  session: Pick<ObjectReferenceSessionLike, 'artifacts'>,
): RightPaneBrowserHostSessionState | undefined {
  if (!reference || reference.kind !== 'artifact') return undefined;
  const artifact = artifactForObjectReference(reference, session);
  if (artifact?.type !== 'browser-runtime-projection') return undefined;
  const data = recordValue(artifact.data);
  const hostSession = recordValue(data?.hostSession) ?? recordValue(recordValue(data?.projection)?.hostSession);
  const id = stringField(hostSession?.id);
  const url = stringField(hostSession?.url) ?? stringField(hostSession?.requestedUrl) ?? browserProjectionArtifactUrl(reference, session);
  if (!id || !url) return undefined;
  const actorCursorFields = rightPaneBrowserActorCursorProjectionFields(hostSession);
  return {
    id,
    status: browserHostSessionStatus(hostSession?.status),
    requestedUrl: stringField(hostSession?.requestedUrl),
    url: normalizeRightPaneBrowserUrl(url),
    title: stringField(hostSession?.title),
    updatedAt: stringField(hostSession?.updatedAt),
    workspaceWriterBaseUrl: stringField(hostSession?.workspaceWriterBaseUrl),
    canGoBack: booleanField(hostSession?.canGoBack),
    canGoForward: booleanField(hostSession?.canGoForward),
    liveSurfaceRef: stringField(hostSession?.liveSurfaceRef),
    liveSurfaceTransport: browserHostLiveSurfaceTransport(hostSession?.liveSurfaceTransport),
    singleInteractiveTruth: hostSession?.singleInteractiveTruth === true ? true : undefined,
    secondTruthSource: hostSession?.secondTruthSource === false ? false : undefined,
    frameStreamRef: stringField(hostSession?.frameStreamRef),
    frameRef: stringField(hostSession?.frameRef),
    frameUrl: stringField(hostSession?.frameUrl),
    screenshotRef: stringField(hostSession?.screenshotRef),
    domSnapshotRef: stringField(hostSession?.domSnapshotRef),
    axSnapshotRef: stringField(hostSession?.axSnapshotRef),
    consoleLogRef: stringField(hostSession?.consoleLogRef),
    networkLogRef: stringField(hostSession?.networkLogRef),
    searchResultRef: stringField(hostSession?.searchResultRef),
    reason: stringField(hostSession?.reason),
    diagnostics: arrayOfStrings(hostSession?.diagnostics),
    nativeSurfaceBridge: rightPaneBrowserNativeSurfaceBridgeState(hostSession?.nativeSurfaceBridge),
    loadingProgress: rightPaneBrowserLoadingProgressLifecycle({ hostSession }),
    ...actorCursorFields,
  };
}

export function browserAnnotationComposerReferenceForHostSession(
  hostSession: RightPaneBrowserHostSessionState | undefined,
  options: RightPaneBrowserAnnotationReferenceOptions = {},
): SciForgeReference | undefined {
  if (!hostSession?.id) return undefined;
  const annotationRef = safeBrowserAnnotationRef(options.annotationRef) ?? `annotation:${hostSession.id}`;
  const browserSessionRef = `browser-host-session:${hostSession.id}/session.json`;
  const targetRef = stringField(options.targetRef) ?? hostSession.frameRef ?? hostSession.liveSurfaceRef;
  const screenshotRef = stringField(options.screenshotRef) ?? hostSession.screenshotRef;
  if (!targetRef || !screenshotRef) return undefined;
  const cropRef = stringField(options.cropRef)
    ?? `browser-host-session:${hostSession.id}/annotations/${safeBrowserRefPathPart(annotationRef)}/crop.json`;
  const bounds = browserAnnotationBounds(options.bounds);
  const comment = browserAnnotationComment(options.comment);
  const refs = uniqueStrings([
    annotationRef,
    browserSessionRef,
    targetRef,
    cropRef,
    screenshotRef,
    hostSession.domSnapshotRef,
    hostSession.axSnapshotRef,
    hostSession.consoleLogRef,
    hostSession.networkLogRef,
    hostSession.searchResultRef,
  ]);
  const title = `Browser annotation · ${hostSession.title || hostSession.id}`;
  return {
    id: `ref-${safeBrowserReferenceIdPart(annotationRef)}`,
    kind: 'ui',
    title,
    ref: annotationRef,
    summary: 'Browser annotation pending composer context; evidence is represented by refs only.',
    payload: {
      schemaVersion: 'sciforge.browser-annotation.composer-reference.v1',
      source: 'browser-pane',
      displayModel: SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL,
      annotationRef,
      browserSessionRef,
      targetRef,
      cropRef,
      screenshotRef,
      sourceKind: 'browser',
      coordinateSpace: 'browser-viewport',
      bounds,
      comment,
      refs,
      urlDigest: boundedUrlDigest(hostSession.url),
      title: hostSession.title,
      threadId: stringField(options.threadId),
      messageDraftId: stringField(options.messageDraftId),
      createdAt: options.createdAt,
      provenance: {
        producer: 'browser-pane',
        dataRef: annotationRef,
        screenshotRef,
      },
      currentReference: {
        id: `object-${safeBrowserReferenceIdPart(annotationRef)}`,
        kind: 'artifact',
        title,
        ref: annotationRef,
        artifactType: 'browser-annotation',
        preferredView: 'browser-object',
        summary: 'Browser annotation with target, crop, and screenshot refs.',
        provenance: {
          producer: 'browser-pane',
          dataRef: annotationRef,
          screenshotRef,
        },
      },
    },
  };
}

function browserProjectionArtifactUrl(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>) {
  if (reference.kind !== 'artifact') return undefined;
  const artifact = artifactForObjectReference(reference, session);
  if (artifact?.type !== 'browser-runtime-projection') return undefined;
  const data = recordValue(artifact.data);
  const metadata = recordValue(artifact.metadata);
  const hostSession = recordValue(data?.hostSession) ?? recordValue(recordValue(data?.projection)?.hostSession);
  return stringField(hostSession?.url)
    ?? stringField(hostSession?.requestedUrl)
    ?? stringField(data?.finalUrl)
    ?? stringField(recordValue(data?.snapshot)?.url)
    ?? stringField(metadata?.finalUrl);
}

function browserHostSessionStatus(value: unknown): RightPaneBrowserHostSessionState['status'] {
  return value === 'starting' || value === 'loading' || value === 'ready' || value === 'failed' || value === 'closed'
    ? value
    : 'ready';
}

function browserHostLiveSurfaceTransport(value: unknown): RightPaneBrowserHostSessionState['liveSurfaceTransport'] {
  return value === 'native-embedded' ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function safeBrowserAnnotationRef(value: unknown) {
  const ref = stringField(value);
  return ref && /^annotation:[a-z0-9][a-z0-9._:/-]*$/i.test(ref) ? ref : undefined;
}

function safeBrowserReferenceIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'browser-annotation';
}

function safeBrowserRefPathPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'browser-annotation';
}

function browserAnnotationBounds(value: SciForgeAnnotationBounds | undefined): SciForgeAnnotationBounds | undefined {
  if (!value) return undefined;
  const x = finiteNonNegativeNumber(value.x);
  const y = finiteNonNegativeNumber(value.y);
  const width = finitePositiveNumber(value.width);
  const height = finitePositiveNumber(value.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function browserAnnotationComment(value: unknown) {
  const comment = stringField(value)?.replace(/\s+/g, ' ').trim();
  return comment ? comment.slice(0, 2000) : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, roundBrowserAnnotationNumber(value)) : undefined;
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? roundBrowserAnnotationNumber(value) : undefined;
}

function roundBrowserAnnotationNumber(value: number): number {
  return Number(value.toFixed(6));
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function rightPaneBrowserActorCursorProjectionFields(
  value: unknown,
): Pick<RightPaneBrowserProjectionState, 'actorCursor' | 'actorCursors'> {
  const actorCursors = rightPaneBrowserActorCursorProjections(value);
  if (!actorCursors.length) return {};
  return {
    actorCursor: actorCursors[0]!,
    actorCursors,
  };
}

function rightPaneBrowserActorCursorProjections(value: unknown): RightPaneBrowserActorCursorProjection[] {
  const record = recordValue(value);
  if (!record) return [];
  const visibleAction = recordValue(record.visibleAction);
  const primaryCursor = recordValue(record.actorCursor) ?? recordValue(record.actor_cursor);
  const cursorRecords = [
    primaryCursor,
    ...recordList(record.actorCursors),
    ...recordList(record.actor_cursors),
  ].filter((cursor): cursor is Record<string, unknown> => Boolean(cursor));
  const projections: RightPaneBrowserActorCursorProjection[] = [];
  const seen = new Set<string>();
  cursorRecords.forEach((cursorRecord, index) => {
    const projection = rightPaneBrowserActorCursorProjection(
      cursorRecord,
      index === 0 && primaryCursor === cursorRecord ? visibleAction : undefined,
    );
    if (!projection) return;
    const key = `${projection.agentId}:${projection.cursorId}`;
    if (seen.has(key)) return;
    seen.add(key);
    projections.push(projection);
  });
  return projections;
}

function rightPaneBrowserActorCursorProjection(
  record: Record<string, unknown>,
  visibleAction: Record<string, unknown> | undefined,
): RightPaneBrowserActorCursorProjection | undefined {
  const agentId = actorCursorIdentifier(firstStringField(record, ['agentId', 'agent_id', 'actorId', 'actor_id']));
  if (!agentId) return undefined;
  const cursorId = actorCursorIdentifier(firstStringField(record, ['cursorId', 'cursor_id', 'id'])) ?? agentId;
  const lastAction = recordValue(record.lastAction) ?? recordValue(record.last_action);
  const target = rightPaneBrowserActorCursorTargetProjection(record.target)
    ?? rightPaneBrowserActorCursorTargetProjection({
      ref: record.targetRef ?? record.target_ref,
      kind: record.targetKind ?? record.targetType ?? record.target_kind ?? record.target_type,
      label: record.targetLabel ?? record.targetName ?? record.target_label ?? record.target_name,
    });
  const lastActionRef = firstBrowserProjectionRef(
    record.lastActionRef,
    record.last_action_ref,
    lastAction?.ref,
    lastAction?.visibleActionRef,
    visibleAction?.visibleActionRef,
  );
  const evidenceRefs = uniqueStrings([
    safeBrowserProjectionRef(visibleAction?.actorCursorRef),
    safeBrowserProjectionRef(record.actorCursorRef),
    safeBrowserProjectionRef(record.cursorRef),
    safeBrowserProjectionRef(record.ref),
    safeBrowserProjectionRef(record.evidenceRef),
    ...safeBrowserProjectionRefs(record.evidenceRefs),
    safeBrowserProjectionRef(lastAction?.evidenceRef),
    ...safeBrowserProjectionRefs(lastAction?.evidenceRefs),
    ...safeBrowserProjectionRefs(recordValue(record.target)?.evidenceRefs),
  ]);
  const projection: RightPaneBrowserActorCursorProjection = { agentId, cursorId };
  const color = actorCursorColor(record.color);
  const label = boundedActorCursorText(record.label);
  const status = actorCursorStatus(record.status ?? record.state);
  if (color) projection.color = color;
  if (label) projection.label = label;
  if (status) projection.status = status;
  if (target) projection.target = target;
  if (lastActionRef) projection.lastActionRef = lastActionRef;
  if (evidenceRefs.length) projection.evidenceRefs = evidenceRefs;
  return projection;
}

function rightPaneBrowserActorCursorTargetProjection(value: unknown): RightPaneBrowserActorCursorTargetProjection | undefined {
  const record = recordValue(value);
  if (!record) {
    const ref = safeBrowserProjectionRef(value);
    return ref ? { ref } : undefined;
  }
  const ref = firstBrowserProjectionRef(
    record.ref,
    record.targetRef,
    record.target_ref,
    record.elementRef,
    record.element_ref,
    record.nodeRef,
    record.node_ref,
    record.windowRef,
    record.window_ref,
    record.browserRef,
    record.browser_ref,
  );
  const kind = actorCursorTargetKind(record.kind ?? record.type ?? record.role);
  const label = boundedActorCursorText(record.label ?? record.name ?? record.title);
  if (!ref && !kind && !label) return undefined;
  const target: RightPaneBrowserActorCursorTargetProjection = {};
  if (ref) target.ref = ref;
  if (kind) target.kind = kind;
  if (label) target.label = label;
  return target;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue).filter((record): record is Record<string, unknown> => Boolean(record)) : [];
}

function firstStringField(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = stringField(record[field]);
    if (value) return value;
  }
  return undefined;
}

function actorCursorIdentifier(value: unknown) {
  const text = stringField(value);
  if (!text || text.length > 96) return undefined;
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(text) ? text : undefined;
}

function actorCursorColor(value: unknown) {
  const text = stringField(value);
  if (!text || text.length > 32) return undefined;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? text : undefined;
}

function boundedActorCursorText(value: unknown) {
  const text = stringField(value);
  return text ? text.replace(/\s+/g, ' ').trim().slice(0, 80) : undefined;
}

function actorCursorStatus(value: unknown): RightPaneBrowserActorCursorStatus | undefined {
  const token = normalizedActorCursorToken(value);
  if (!token) return undefined;
  if (token === 'idle' || token === 'ready') return 'idle';
  if (token === 'observing' || token === 'clicking' || token === 'typing' || token === 'scrolling' || token === 'waiting' || token === 'leaving' || token === 'paused' || token === 'stopped') return token;
  if (token === 'moving' || token === 'move' || token === 'hovering' || token === 'pointing') return 'moving';
  if (token === 'acting' || token === 'active' || token === 'action' || token === 'proposing') return 'acting';
  if (token === 'blocked' || token === 'failed') return 'blocked';
  if (token === 'done' || token === 'complete' || token === 'completed') return 'done';
  return 'unknown';
}

function actorCursorTargetKind(value: unknown) {
  const token = normalizedActorCursorToken(value);
  return token && token.length <= 48 ? token : undefined;
}

function normalizedActorCursorToken(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function firstBrowserProjectionRef(...values: unknown[]) {
  for (const value of values) {
    const ref = safeBrowserProjectionRef(value);
    if (ref) return ref;
  }
  return undefined;
}

function safeBrowserProjectionRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(safeBrowserProjectionRefs);
  const record = recordValue(value);
  if (record) return safeBrowserProjectionRefs(record.ref);
  const ref = safeBrowserProjectionRef(value);
  return ref ? [ref] : [];
}

function safeBrowserProjectionRef(value: unknown) {
  const ref = stringField(value);
  if (!ref || ref.length > 512) return undefined;
  if (/data:image|base64|<html|rawDom|rawScreenshot|rawPayload|payload/i.test(ref)) return undefined;
  return /^[a-z][a-z0-9._-]*:[^\s<>{}"']+$/i.test(ref) ? ref : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function rightPaneBrowserNativeSurfaceBridgeState(value: unknown): RightPaneBrowserNativeSurfaceBridgeState | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const routeStatus = nativeSurfaceRouteStatus(record.routeStatus);
  const capability = nativeSurfaceCapabilityStatus(record.capability);
  const rightPaneBridge = booleanField(record.rightPaneBridge);
  const status = nativeSurfaceBridgeStatus(record.status)
    ?? (routeStatus === 'reachable' && rightPaneBridge === false ? 'native-bridge-unavailable' : undefined)
    ?? (routeStatus === 'unreachable' ? 'route-unreachable' : undefined)
    ?? (routeStatus || capability || rightPaneBridge !== undefined ? 'unknown' : undefined);
  if (!routeStatus && !capability && rightPaneBridge === undefined && !status) return undefined;
  return {
    routeStatus,
    capability,
    rightPaneBridge,
    status,
    healthPath: stringField(record.healthPath),
    attachPath: stringField(record.attachPath),
    statePath: stringField(record.statePath),
    diagnosticRef: stringField(record.diagnosticRef),
  };
}

function nativeSurfaceRouteStatus(value: unknown): RightPaneBrowserNativeSurfaceBridgeState['routeStatus'] | undefined {
  return value === 'unknown' || value === 'reachable' || value === 'unreachable' ? value : undefined;
}

function nativeSurfaceCapabilityStatus(value: unknown): RightPaneBrowserNativeSurfaceBridgeState['capability'] | undefined {
  return value === 'ready' || value === 'missing' || value === 'unknown' ? value : undefined;
}

function nativeSurfaceBridgeStatus(value: unknown): RightPaneBrowserNativeSurfaceBridgeState['status'] | undefined {
  return value === 'ready' || value === 'native-bridge-unavailable' || value === 'route-unreachable' || value === 'unknown' ? value : undefined;
}

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE: Record<RightPaneBrowserLoadingProgressState, RightPaneBrowserLoadingProgressReason> = {
  'navigation-start': 'navigation-requested',
  'navigation-committed': 'navigation-committed',
  interactive: 'page-interactive',
  load: 'page-load',
  'network-quiet': 'network-quiet',
  stalled: 'navigation-stalled',
  blocked: 'navigation-blocked',
  retry: 'navigation-retry',
  handoff: 'user-handoff-required',
};

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_SURFACE_BY_STATE: Record<RightPaneBrowserLoadingProgressState, {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
}> = {
  'navigation-start': { status: 'loading', tabStatus: 'loading' },
  'navigation-committed': { status: 'loading', tabStatus: 'loading' },
  interactive: { status: 'loading', tabStatus: 'loading' },
  load: { status: 'loading', tabStatus: 'loading' },
  'network-quiet': { status: 'ready', tabStatus: 'ready' },
  stalled: { status: 'loading', tabStatus: 'loading' },
  blocked: { status: 'blocked', tabStatus: 'failed' },
  retry: { status: 'loading', tabStatus: 'loading' },
  handoff: { status: 'blocked', tabStatus: 'failed' },
};

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATE_ALIASES = loadingProgressAliasMap<RightPaneBrowserLoadingProgressState>({
  'navigation-start': ['navigation-start', 'navigation-started', 'navigation-starting', 'navigation-requested', 'start', 'started', 'starting', 'requested'],
  'navigation-committed': ['navigation-committed', 'committed', 'commit'],
  interactive: ['interactive', 'user-interactive', 'dom-interactive', 'domcontentloaded', 'dom-content-loaded', 'document-interactive', 'document-ready'],
  load: ['load', 'loaded', 'page-load', 'load-event', 'window-load'],
  'network-quiet': ['network-quiet', 'networkquiet', 'network-idle', 'networkidle', 'network-idle0', 'network-idle2', 'idle'],
  stalled: ['stalled', 'stall', 'timeout', 'timed-out', 'no-progress', 'no-progress-timeout', 'first-paint-timeout'],
  blocked: ['blocked', 'block', 'policy-blocked', 'navigation-blocked', 'host-blocked'],
  retry: ['retry', 'retrying', 'retryable', 'retry-after', 'host-retry'],
  handoff: ['handoff', 'requires-handoff', 'requires-user-handoff', 'user-handoff', 'external-handoff', 'open-external'],
});

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_ALIASES = loadingProgressAliasMap<RightPaneBrowserLoadingProgressReason>({
  'navigation-requested': ['navigation-requested', 'request-started', 'url-submitted'],
  'navigation-committed': ['navigation-committed', 'commit-observed', 'response-committed'],
  'page-interactive': ['page-interactive', 'dom-interactive', 'domcontentloaded', 'dom-content-loaded', 'interactive'],
  'page-load': ['page-load', 'load-event', 'window-load', 'loaded'],
  'network-quiet': ['network-quiet', 'network-idle', 'networkidle'],
  'navigation-stalled': ['navigation-stalled', 'no-progress-timeout', 'first-paint-timeout', 'timeout', 'stalled'],
  'navigation-blocked': ['navigation-blocked', 'host-blocked', 'policy-blocked', 'blocked'],
  'navigation-retry': ['navigation-retry', 'retry', 'retrying', 'retry-after', 'retryable'],
  'user-handoff-required': ['user-handoff-required', 'requires-handoff', 'requires-user-handoff', 'handoff'],
  'host-starting': ['host-starting', 'browser-host-starting'],
  'host-loading': ['host-loading', 'browser-host-loading'],
  'host-ready': ['host-ready', 'browser-host-ready'],
  'host-error': ['host-error', 'browser-host-error'],
  'host-diagnostic': ['host-diagnostic', 'diagnostic'],
  'native-bridge-unavailable': ['native-bridge-unavailable', 'right-pane-bridge-unavailable'],
});

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_SOURCES = new Set<RightPaneBrowserLoadingProgressSource>([
  'host-lifecycle',
  'host-progress',
  'host-navigation',
  'host-action-timing',
  'host-state',
  'host-session',
  'ui-command',
  'host-error',
  'native-surface-route',
]);

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_NESTED_FIELDS: Array<{
  field: string;
  source: RightPaneBrowserLoadingProgressSource;
}> = [
  { field: 'loadingProgress', source: 'host-progress' },
  { field: 'progress', source: 'host-progress' },
  { field: 'lifecycle', source: 'host-lifecycle' },
  { field: 'navigationLifecycle', source: 'host-lifecycle' },
  { field: 'navigation', source: 'host-navigation' },
  { field: 'loadState', source: 'host-progress' },
];

export function rightPaneBrowserLoadingProgressLifecycle(input: RightPaneBrowserLoadingProgressInput = {}): RightPaneBrowserLoadingProgressLifecycle | undefined {
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  const nativeSurfaceBridge = rightPaneBrowserNativeSurfaceBridgeState(hostSession?.nativeSurfaceBridge)
    ?? rightPaneBrowserNativeSurfaceBridgeState(hostState?.nativeSurfaceBridge);
  const nativeSurfaceBridgeProgress = rightPaneBrowserNativeSurfaceBridgeLoadingProgress(input, nativeSurfaceBridge);
  const explicit = explicitRightPaneBrowserLoadingProgress(hostSession)
    ?? explicitRightPaneBrowserLoadingProgress(hostState);
  if (explicit) {
    if (nativeSurfaceBridgeProgress && rightPaneBrowserNativeSurfaceBridgeShouldOverrideProgress(explicit)) return nativeSurfaceBridgeProgress;
    return buildRightPaneBrowserLoadingProgressLifecycle(input, explicit.state, explicit.reason, explicit.source);
  }

  const lastActionTiming = recordValue(hostSession?.lastActionTiming);
  if (stringField(lastActionTiming?.blockedReason) || stringField(hostSession?.blockedReason) || stringField(hostState?.blockedReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'blocked', 'navigation-blocked', 'host-action-timing');
  }
  if (booleanField(hostSession?.requiresHandoff) || booleanField(hostState?.requiresHandoff) || stringField(hostSession?.handoffReason) || stringField(hostState?.handoffReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'handoff', 'user-handoff-required', 'host-state');
  }
  if (booleanField(hostSession?.retrying) || booleanField(hostState?.retrying) || stringField(hostSession?.retryReason) || stringField(hostState?.retryReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'retry', 'navigation-retry', 'host-state');
  }
  if (nativeSurfaceBridgeProgress) return nativeSurfaceBridgeProgress;

  const hostStatus = stringField(hostSession?.status);
  const hostStateStatus = stringField(hostState?.status);
  if (input.hostError || hostStatus === 'failed' || hostState?.ok === false) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'blocked', 'host-error', input.hostError ? 'host-error' : 'host-session');
  }
  if (input.hostBusy && (!hostStatus || hostStatus === 'starting')) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'navigation-start', 'navigation-requested', 'ui-command');
  }
  if (hostStatus === 'starting') {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'navigation-start', 'host-starting', 'host-session');
  }
  if (input.hostBusy || hostStatus === 'loading' || hostStateStatus === 'loading') {
    return buildRightPaneBrowserLoadingProgressLifecycle(
      input,
      hostNavigationAppearsCommitted(input) ? 'navigation-committed' : 'navigation-start',
      'host-loading',
      input.hostBusy ? 'ui-command' : 'host-session',
    );
  }
  if (hostStatus === 'ready' || hostState?.ok === true) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'network-quiet', 'host-ready', 'host-session');
  }
  return undefined;
}

function rightPaneBrowserNativeSurfaceBridgeLoadingProgress(
  input: RightPaneBrowserLoadingProgressInput,
  nativeSurfaceBridge: RightPaneBrowserNativeSurfaceBridgeState | undefined,
): RightPaneBrowserLoadingProgressLifecycle | undefined {
  if (nativeSurfaceBridge?.status === 'native-bridge-unavailable') {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'handoff', 'native-bridge-unavailable', 'native-surface-route');
  }
  if (nativeSurfaceBridge?.status === 'route-unreachable') {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'blocked', 'host-diagnostic', 'native-surface-route');
  }
  return undefined;
}

function rightPaneBrowserNativeSurfaceBridgeShouldOverrideProgress(progress: {
  state: RightPaneBrowserLoadingProgressState;
}): boolean {
  return progress.state !== 'blocked' && progress.state !== 'handoff';
}

function explicitRightPaneBrowserLoadingProgress(record: Record<string, unknown> | undefined): {
  state: RightPaneBrowserLoadingProgressState;
  reason?: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
} | undefined {
  if (!record) return undefined;
  for (const candidate of RIGHT_PANE_BROWSER_LOADING_PROGRESS_NESTED_FIELDS) {
    const nested = recordValue(record[candidate.field]);
    const fromNested = rightPaneBrowserLoadingProgressFromRecord(nested, candidate.source);
    if (fromNested) return fromNested;
    const fromString = rightPaneBrowserLoadingProgressStateFromUnknown(record[candidate.field]);
    if (fromString) return { state: fromString, source: candidate.source };
  }
  return rightPaneBrowserLoadingProgressFromRecord(record, 'host-session');
}

function rightPaneBrowserLoadingProgressFromRecord(
  record: Record<string, unknown> | undefined,
  source: RightPaneBrowserLoadingProgressSource,
): {
  state: RightPaneBrowserLoadingProgressState;
  reason?: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
} | undefined {
  if (!record) return undefined;
  const state = firstLoadingProgressState(record, [
    'state',
    'stage',
    'phase',
    'kind',
    'lifecycleState',
    'progressState',
    'navigationState',
    'loadState',
  ]);
  const reason = firstLoadingProgressReason(record, [
    'reason',
    'reasonCode',
    'code',
    'blockedReason',
    'retryReason',
    'handoffReason',
  ]);
  const explicitSource = rightPaneBrowserLoadingProgressSourceFromUnknown(record.source);
  const stateFromReason = reason ? rightPaneBrowserLoadingProgressStateForReason(reason) : undefined;
  if (state) return { state, reason, source: explicitSource ?? source };
  if (stateFromReason) return { state: stateFromReason, reason, source: explicitSource ?? source };
  return undefined;
}

function firstLoadingProgressState(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const state = rightPaneBrowserLoadingProgressStateFromUnknown(record[field]);
    if (state) return state;
  }
  return undefined;
}

function firstLoadingProgressReason(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const reason = rightPaneBrowserLoadingProgressReasonFromUnknown(record[field]);
    if (reason) return reason;
  }
  return undefined;
}

function rightPaneBrowserLoadingProgressStateFromUnknown(value: unknown): RightPaneBrowserLoadingProgressState | undefined {
  const token = normalizedLoadingProgressToken(value);
  return token ? RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATE_ALIASES[token] : undefined;
}

function rightPaneBrowserLoadingProgressReasonFromUnknown(value: unknown): RightPaneBrowserLoadingProgressReason | undefined {
  const token = normalizedLoadingProgressToken(value);
  return token ? RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_ALIASES[token] : undefined;
}

function rightPaneBrowserLoadingProgressSourceFromUnknown(value: unknown): RightPaneBrowserLoadingProgressSource | undefined {
  return typeof value === 'string' && RIGHT_PANE_BROWSER_LOADING_PROGRESS_SOURCES.has(value as RightPaneBrowserLoadingProgressSource)
    ? value as RightPaneBrowserLoadingProgressSource
    : undefined;
}

function rightPaneBrowserLoadingProgressStateForReason(reason: RightPaneBrowserLoadingProgressReason): RightPaneBrowserLoadingProgressState | undefined {
  for (const state of RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES) {
    if (RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE[state] === reason) return state;
  }
  if (reason === 'host-starting') return 'navigation-start';
  if (reason === 'host-loading') return 'navigation-committed';
  if (reason === 'host-ready') return 'network-quiet';
  if (reason === 'host-error' || reason === 'host-diagnostic') return 'blocked';
  return undefined;
}

function buildRightPaneBrowserLoadingProgressLifecycle(
  input: RightPaneBrowserLoadingProgressInput,
  state: RightPaneBrowserLoadingProgressState,
  reason: RightPaneBrowserLoadingProgressReason | undefined,
  source: RightPaneBrowserLoadingProgressSource,
): RightPaneBrowserLoadingProgressLifecycle {
  const surface = RIGHT_PANE_BROWSER_LOADING_PROGRESS_SURFACE_BY_STATE[state];
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  const requestedUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.requestedUrl ?? input.targetUrl);
  const currentUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.url ?? hostState?.url);
  const finalUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.finalUrl ?? hostState?.finalUrl);
  const hostUrlDigests = rightPaneBrowserHostLoadingProgressUrlDigests(hostSession)
    ?? rightPaneBrowserHostLoadingProgressUrlDigests(hostState);
  return {
    schemaVersion: RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
    state,
    reason: reason ?? RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE[state],
    source,
    status: surface.status,
    tabStatus: surface.tabStatus,
    requestedUrl,
    currentUrl,
    finalUrl,
    urlDigests: rightPaneBrowserLoadingProgressUrlDigests({ requestedUrl, currentUrl, finalUrl }, hostUrlDigests),
    canRetry: state === 'retry' || booleanField(hostSession?.retryable) || booleanField(hostState?.retryable) || undefined,
    blocked: state === 'blocked' ? true : undefined,
    requiresHandoff: state === 'handoff' ? true : undefined,
  };
}

function rightPaneBrowserLoadingProgressUrlDigests(input: {
  requestedUrl?: string;
  currentUrl?: string;
  finalUrl?: string;
}, hostDigests?: RightPaneBrowserLoadingProgressLifecycle['urlDigests']): RightPaneBrowserLoadingProgressLifecycle['urlDigests'] {
  const requested = boundedUrlDigest(input.requestedUrl) ?? hostDigests?.requested;
  const current = boundedUrlDigest(input.currentUrl) ?? hostDigests?.current;
  const final = boundedUrlDigest(input.finalUrl) ?? hostDigests?.final;
  return requested || current || final ? { requested, current, final } : undefined;
}

function rightPaneBrowserHostLoadingProgressUrlDigests(record: Record<string, unknown> | undefined): RightPaneBrowserLoadingProgressLifecycle['urlDigests'] {
  const progress = recordValue(record?.loadingProgress);
  const urls = recordValue(progress?.urls);
  if (!urls) return undefined;
  const requested = boundedHostUrlDigest(urls.requested);
  const current = boundedHostUrlDigest(urls.current);
  const final = boundedHostUrlDigest(urls.final);
  return requested || current || final ? { requested, current, final } : undefined;
}

function boundedHostUrlDigest(value: unknown): RightPaneBrowserBoundedUrlDigest | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const length = typeof record.length === 'number' && Number.isFinite(record.length) ? Math.max(0, Math.round(record.length)) : undefined;
  const hashSource = typeof record.hash === 'string' && /^[a-f0-9]{8}$/i.test(record.hash.trim())
    ? record.hash.trim()
    : typeof record.sha1 === 'string' && /^[a-f0-9]{40}$/i.test(record.sha1.trim())
      ? record.sha1.trim().slice(0, 8)
      : undefined;
  return length !== undefined && hashSource ? { length, hash: hashSource.toLowerCase() } : undefined;
}

function boundedUrlDigest(value: string | undefined): RightPaneBrowserBoundedUrlDigest | undefined {
  if (!value) return undefined;
  return {
    length: value.length,
    hash: stableBoundedHash(value),
  };
}

function stableBoundedHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hostNavigationAppearsCommitted(input: RightPaneBrowserLoadingProgressInput) {
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  const requestedUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.requestedUrl ?? input.targetUrl);
  const currentUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.url ?? hostState?.url);
  if (!currentUrl || currentUrl === 'about:blank') return false;
  if (!requestedUrl) return true;
  return rightPaneBrowserUrlsEquivalent(currentUrl, requestedUrl);
}

function normalizedOptionalRightPaneBrowserUrl(value: unknown) {
  const url = stringField(value);
  return url ? normalizeRightPaneBrowserUrl(url) : undefined;
}

function loadingProgressAliasMap<T extends string>(aliases: Record<T, string[]>) {
  const result: Record<string, T> = {};
  for (const [canonical, values] of Object.entries(aliases) as Array<[T, string[]]>) {
    for (const value of [canonical, ...values]) {
      const token = normalizedLoadingProgressToken(value);
      if (token) result[token] = canonical;
    }
  }
  return result;
}

function normalizedLoadingProgressToken(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rightPaneBrowserLoadingProgressIsExplicit(lifecycle: RightPaneBrowserLoadingProgressLifecycle) {
  return lifecycle.source === 'host-lifecycle'
    || lifecycle.source === 'host-progress'
    || lifecycle.source === 'host-navigation'
    || lifecycle.source === 'host-action-timing'
    || lifecycle.source === 'host-error'
    || lifecycle.state === 'blocked'
    || lifecycle.state === 'retry'
    || lifecycle.state === 'handoff';
}

function rightPaneBrowserLoadingProgressMessage(lifecycle: RightPaneBrowserLoadingProgressLifecycle) {
  const labelByState: Record<RightPaneBrowserLoadingProgressState, string> = {
    'navigation-start': 'navigation started',
    'navigation-committed': 'navigation committed',
    interactive: 'page is interactive',
    load: 'load event observed',
    'network-quiet': 'network is quiet',
    stalled: 'navigation stalled',
    blocked: 'navigation blocked',
    retry: 'retry in progress',
    handoff: 'handoff required',
  };
  return `BrowserHostSession progress: ${labelByState[lifecycle.state]} (${lifecycle.reason}).`;
}

export function normalizeRightPaneBrowserUrl(value: string) {
  return normalizeBrowserWorkbenchUrl(value);
}

export function rightPaneBrowserProjectionForUrl(url: string, options: RightPaneBrowserProjectionOptions = {}): RightPaneBrowserProjectionState {
  if (url === 'about:blank') {
    return {
      status: 'idle',
      tabStatus: 'new',
      previewUrl: 'about:blank',
      reason: 'No browser URL is open in this right-pane tab yet.',
      canRenderFrame: true,
    };
  }

  const parsed = parseRightPaneBrowserUrl(url);
  if (!parsed) {
    return {
      status: 'error',
      tabStatus: 'failed',
      reason: 'The URL could not be parsed into a browser target.',
      detail: 'Enter a local path, localhost URL, http URL, or https URL.',
      ref: 'browser:error/right-pane/invalid-url',
      canRenderFrame: false,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      status: 'blocked',
      tabStatus: 'failed',
      reason: 'This URL scheme is not embeddable by the browser workbench.',
      detail: 'Use an http or https URL, or open the target through a host-owned BrowserRuntime command.',
      ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      canRenderFrame: false,
      embedPolicy: {
        embeddable: false,
        status: 'blocked',
        reason: 'Unsupported browser workbench URL scheme.',
        ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      },
    };
  }

  if (options.hostExternalBrowserAvailable) {
    const hostSurface = options.hostSurface ?? options.hostState?.surface ?? 'browser-host-session';
    const hostUrl = options.hostSession?.url
      ? normalizeRightPaneBrowserUrl(options.hostSession.url)
      : options.hostState?.url
        ? normalizeRightPaneBrowserUrl(options.hostState.url)
        : undefined;
    const requestedUrl = options.hostSession?.requestedUrl ? normalizeRightPaneBrowserUrl(options.hostSession.requestedUrl) : undefined;
    const stateMatchesUrl = rightPaneBrowserUrlsEquivalent(requestedUrl, url) || rightPaneBrowserUrlsEquivalent(hostUrl, url);
    const hostFailed = options.hostError || options.hostSession?.status === 'failed' || options.hostState?.ok === false;
    const hostTargetKnown = Boolean(requestedUrl || hostUrl);
    const hostReadyForTarget = stateMatchesUrl
      || (!hostTargetKnown && (options.hostSession?.status === 'ready' || options.hostState?.ok === true));
    const hostDiagnostic = options.hostError ?? options.hostSession?.reason ?? options.hostSession?.diagnostics?.join('\n') ?? options.hostState?.reason;
    const loadingProgress = rightPaneBrowserLoadingProgressLifecycle({
      targetUrl: url,
      hostBusy: options.hostBusy,
      hostError: options.hostError,
      hostSession: options.hostSession,
      hostState: options.hostState,
    });
    const lifecycleDrivenStatus = loadingProgress && rightPaneBrowserLoadingProgressIsExplicit(loadingProgress)
      ? loadingProgress.status
      : undefined;
    const actorCursorFields = rightPaneBrowserActorCursorProjectionFields(options.hostSession);
    const status: RightPaneBrowserProjectionStatus = lifecycleDrivenStatus
      ?? (hostFailed
      ? 'error'
      : undefined)
        ?? (options.hostBusy || options.hostSession?.status === 'starting' || options.hostSession?.status === 'loading'
        ? 'loading'
        : hostReadyForTarget
        ? 'ready'
        : 'idle');
    const lifecycleReason = loadingProgress ? rightPaneBrowserLoadingProgressMessage(loadingProgress) : undefined;
    return {
      status,
      tabStatus: status === 'error' || status === 'blocked' || status === 'offline' ? 'failed' : status === 'idle' ? 'new' : status === 'loading' ? 'loading' : 'ready',
      externalUrl: url,
      reason: status === 'error'
        ? 'BrowserHostSession could not open this page.'
        : status === 'idle'
          ? 'HTTP/HTTPS pages open through host-owned BrowserHostSession instead of unsafe iframe/proxy live browsing.'
          : status === 'loading'
            ? (lifecycleReason ?? 'BrowserHostSession is loading this page.')
            : status === 'blocked'
              ? (lifecycleReason ?? 'BrowserHostSession navigation is blocked.')
            : 'Page is carried by host-owned BrowserHostSession.',
      detail: status === 'error'
        ? (options.hostError ?? hostDiagnostic ?? 'BrowserHostSession open failed.')
        : status === 'loading' || status === 'blocked'
          ? (hostDiagnostic ?? lifecycleReason ?? 'The right pane is waiting for the host-owned BrowserHostSession to commit the active navigation.')
        : 'The right pane keeps BrowserRuntime commands, frame refs, snapshots, and document evidence while the host owns the only interactive live browser surface.',
      ref: status === 'error' ? 'browser:host-surface/right-pane/error' : status === 'blocked' ? 'browser:host-surface/right-pane/blocked' : 'browser:host-surface/right-pane/external',
      canRenderFrame: false,
      hostSurface,
      loadingProgress,
      ...actorCursorFields,
    };
  }

  if (shouldUseBrowserWorkbenchPdfViewerUrl(url)) {
    const previewUrl = buildBrowserWorkbenchPdfViewerUrl(url);
    return {
      status: 'ready',
      tabStatus: 'ready',
      previewUrl,
      externalUrl: url,
      reason: 'External PDFs render through a SciForge-owned document viewer projection.',
      detail: 'The viewer is a document projection, not a live browser substitute; Browser commands keep the original URL.',
      ref: 'browser:embed-policy/right-pane/pdf-viewer',
      canRenderFrame: true,
      embedPolicy: {
        embeddable: true,
        status: 'ready',
        reason: 'External PDF is materialized by the same-origin PDF viewer projection.',
        ref: 'browser:embed-policy/right-pane/pdf-viewer',
      },
    };
  }

  return {
    status: 'blocked',
    tabStatus: 'failed',
    externalUrl: url,
    previewSandbox: browserPreviewSandboxForUrl(url),
    reason: 'HTTP/HTTPS pages require a host-owned browser surface for live navigation.',
    detail: 'Live external navigation must run in BrowserHostSession. Proxy, iframe, and snapshot projections are evidence or document artifacts only; they are not alternate live browsers or a second interactive truth source.',
    ref: 'browser:host-surface/right-pane/required',
    canRenderFrame: false,
    embedPolicy: {
      embeddable: false,
      status: 'blocked',
      reason: 'External HTML pages are not embedded as iframe/proxy live browsers.',
      ref: 'browser:embed-policy/right-pane/external-html-host-required',
    },
  };
}

export function parseRightPaneBrowserUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function rightPaneBrowserRequiresExternalHost(url: string) {
  if (url === 'about:blank') return false;
  const parsed = parseRightPaneBrowserUrl(url);
  return Boolean(parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:'));
}

export function rightPaneBrowserUrlIsLocal(parsed: URL) {
  return browserWorkbenchUrlIsLocal(parsed);
}

export function rightPaneBrowserUrlsEquivalent(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const normalizedLeft = normalizeRightPaneBrowserUrl(left);
  const normalizedRight = normalizeRightPaneBrowserUrl(right);
  if (normalizedLeft === normalizedRight) return true;
  try {
    const leftUrl = new URL(normalizedLeft);
    const rightUrl = new URL(normalizedRight);
    return leftUrl.protocol === rightUrl.protocol
      && leftUrl.hostname === rightUrl.hostname
      && leftUrl.port === rightUrl.port
      && normalizedBrowserPath(leftUrl) === normalizedBrowserPath(rightUrl)
      && leftUrl.search === rightUrl.search
      && leftUrl.hash === rightUrl.hash;
  } catch {
    return false;
  }
}

function normalizedBrowserPath(url: URL) {
  return url.pathname === '' ? '/' : url.pathname;
}
