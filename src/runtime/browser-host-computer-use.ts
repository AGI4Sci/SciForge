import type { GenericVisionAction } from './computer-use/types.js';
import type {
  ComputerUseActionProvenance,
  ComputerUseApprovalState,
  ComputerUseLeaseScope,
  ComputerUseVisibleEvidenceInvalidation,
} from './computer-use/types.js';
import type {
  BrowserHostMouseButton,
  BrowserHostMousePoint,
  BrowserHostSessionActionInput,
  BrowserHostSessionCaptureMode,
  BrowserHostSessionManager,
  BrowserHostSessionState,
} from './browser-host-session.js';

export const BROWSER_HOST_COMPUTER_USE_SCHEMA = 'sciforge.browser-host-session.computer-use-action.v1' as const;
export const BROWSER_HOST_COMPUTER_USE_PROVIDER_ID = 'sciforge.browser-host-session.computer-use-adapter' as const;

export type BrowserHostLowLevelComputerUseAction =
  | { type: 'mouse_down'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'mouse_move'; x?: number; y?: number; targetDescription?: string }
  | { type: 'mouse_up'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'wheel'; x?: number; y?: number; deltaX?: number; deltaY?: number; targetDescription?: string }
  | { type: 'cursor'; x?: number; y?: number; targetDescription?: string };

export type BrowserHostComputerUseAction = GenericVisionAction | BrowserHostLowLevelComputerUseAction;

export interface BrowserHostComputerUseActionResult {
  schemaVersion: typeof BROWSER_HOST_COMPUTER_USE_SCHEMA;
  providerId: typeof BROWSER_HOST_COMPUTER_USE_PROVIDER_ID;
  inputChannel: 'browser-host-session';
  userDeviceImpact: 'none';
  sharedSystemInputUsed: false;
  systemMouseEvents: 'not-sent';
  systemKeyboardEvents: 'not-sent';
  liveBrowserOwner: 'BrowserHostSession';
  singleInteractiveTruth: true;
  hostAction: BrowserHostSessionActionInput;
  session: BrowserHostSessionState;
  beforeEvidenceRefs: string[];
  groundingRefs: string[];
  executorEventRef: string;
  afterEvidenceRefs: string[];
  verificationRefs: string[];
  provenance: ComputerUseActionProvenance;
  freshnessInvalidation: ComputerUseVisibleEvidenceInvalidation;
}

export type BrowserHostComputerUseReadinessReason =
  | 'browser-host-session-missing'
  | 'browser-host-session-stale'
  | 'browser-host-session-hidden'
  | 'browser-host-session-diagnostic-only'
  | 'browser-host-session-permission-missing'
  | 'browser-host-session-cancel-path-missing';

export type BrowserHostComputerUseActionReadiness =
  | { status: 'ready' }
  | { status: 'blocked'; reason: BrowserHostComputerUseReadinessReason };

export function browserHostActionFromComputerUse(
  action: BrowserHostComputerUseAction,
  options: {
    capture?: BrowserHostSessionCaptureMode;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
  } = {},
): BrowserHostSessionActionInput {
  if (action.type === 'click') {
    return {
      action: 'click',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'double_click') {
    return {
      action: 'double-click',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'drag') {
    const fromX = requiredBrowserHostCoordinate(action.fromX, 'fromX');
    const fromY = requiredBrowserHostCoordinate(action.fromY, 'fromY');
    const toX = requiredBrowserHostCoordinate(action.toX, 'toX');
    const toY = requiredBrowserHostCoordinate(action.toY, 'toY');
    return {
      action: 'drag',
      path: browserHostComputerUseDragPath({ x: fromX, y: fromY }, { x: toX, y: toY }),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_down') {
    return {
      action: 'mouse-down',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      button: browserHostComputerUseMouseButton(action.button),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_move') {
    return {
      action: 'mouse-move',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_up') {
    return {
      action: 'mouse-up',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      button: browserHostComputerUseMouseButton(action.button),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'type_text') {
    return {
      action: 'type',
      text: action.text,
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'press_key') {
    return {
      action: 'press',
      key: browserHostComputerUseKey(action.key),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'hotkey') {
    return {
      action: 'press',
      key: action.keys.map(browserHostComputerUseKey).join('+'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'scroll') {
    const amount = Math.max(1, Math.round(action.amount ?? 720));
    return {
      action: 'scroll',
      deltaX: action.direction === 'left' ? -amount : action.direction === 'right' ? amount : 0,
      deltaY: action.direction === 'up' ? -amount : action.direction === 'down' ? amount : 0,
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'wheel') {
    return {
      action: 'scroll',
      x: optionalBrowserHostCoordinate(action.x),
      y: optionalBrowserHostCoordinate(action.y),
      deltaX: Math.round(action.deltaX ?? 0),
      deltaY: Math.round(action.deltaY ?? 0),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'cursor') {
    return {
      action: 'cursor',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'wait') {
    return {
      action: 'state',
      capture: options.capture ?? 'frame',
      timeoutMs: Math.max(0, Math.round(action.ms ?? options.timeoutMs ?? 500)),
      ...browserHostActionTimingInput(options),
    };
  }
  throw new Error(`BrowserHostSession Computer Use action is unsupported: ${action.type}`);
}

export async function executeBrowserHostComputerUseAction(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  sessionId: string,
  action: BrowserHostComputerUseAction,
  options: {
    capture?: BrowserHostSessionCaptureMode;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
    permissionRef?: string;
    cancelRef?: string;
    now?: string;
    maxAgeMs?: number;
  } = {},
): Promise<BrowserHostComputerUseActionResult> {
  const permissionRef = options.permissionRef ?? browserHostComputerUsePermissionRef(action);
  const cancelRef = options.cancelRef ?? browserHostComputerUseCancelRef(action);
  const beforeSession = await manager.sessionState(workspacePath, sessionId);
  const readiness = browserHostComputerUseActionReadiness({
    session: beforeSession,
    action,
    permissionRef,
    cancelRef,
    now: options.now,
    maxAgeMs: options.maxAgeMs,
  });
  if (readiness.status === 'blocked') {
    throw new Error(`BrowserHostSession Computer Use action blocked: ${readiness.reason}`);
  }
  const hostAction = browserHostActionFromComputerUse(action, options);
  hostAction.actorCursor ??= browserHostComputerUseActorCursor(options.actionId ?? hostAction.actionId);
  const session = await manager.act(workspacePath, sessionId, hostAction);
  const actionMetadata = browserHostComputerUseActionMetadata(action);
  const executorEventRef = browserHostComputerUseExecutorEventRef(session, options.actionId);
  const sessionActionEvidenceRefs = browserHostComputerUseSessionActionEvidenceRefs(session);
  const beforeEvidenceRefs = uniqueBrowserHostRefs([
    ...stringRefs(actionMetadata.beforeEvidenceRefs),
    ...browserHostComputerUseSessionEvidenceRefs(beforeSession),
  ]);
  const groundingRefs = uniqueBrowserHostRefs([
    ...stringRefs(actionMetadata.groundingRefs),
    ...stringRefs(actionMetadata.observeBeforeMutate?.groundingHintRefs),
    actionMetadata.observeBeforeMutate?.groundingRef,
    actionMetadata.observeBeforeMutate?.sourceObservationRef,
  ]);
  const afterEvidenceRefs = uniqueBrowserHostRefs([
    ...browserHostComputerUseSessionEvidenceRefs(session),
    session.visibleAction?.visibleActionRef,
    ...(session.actorCursor?.lastAction?.evidenceRefs ?? []),
    ...(session.actorCursor?.evidenceRefs ?? []),
  ]);
  const verificationRefs = uniqueBrowserHostRefs([
    ...stringRefs(actionMetadata.verificationRefs),
    executorEventRef,
    browserHostSessionManifestRef(session),
    ...sessionActionEvidenceRefs.filter((ref) => /(?:^|[:/._-])(?:verification|verifier|validation|validator)(?:[:/._-]|$)/i.test(ref)),
  ]);
  const provenance = browserHostComputerUseActionProvenance(action, {
    beforeEvidenceRefs,
    groundingRefs,
    afterEvidenceRefs,
    executorEventRef,
    verificationRefs,
  });
  const freshnessInvalidation = browserHostComputerUseFreshnessInvalidation(action, provenance.leaseScope, session);
  return {
    schemaVersion: BROWSER_HOST_COMPUTER_USE_SCHEMA,
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    inputChannel: 'browser-host-session',
    userDeviceImpact: 'none',
    sharedSystemInputUsed: false,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    liveBrowserOwner: 'BrowserHostSession',
    singleInteractiveTruth: true,
    hostAction,
    session,
    beforeEvidenceRefs,
    groundingRefs,
    executorEventRef,
    afterEvidenceRefs,
    verificationRefs,
    provenance,
    freshnessInvalidation,
  };
}

export function browserHostComputerUseActionReadiness(input: {
  session?: BrowserHostSessionState;
  action: BrowserHostComputerUseAction;
  permissionRef?: string;
  cancelRef?: string;
  now?: string;
  maxAgeMs?: number;
}): BrowserHostComputerUseActionReadiness {
  const session = input.session;
  if (!session) return { status: 'blocked', reason: 'browser-host-session-missing' };
  if ((session as { visible?: unknown }).visible === false) return { status: 'blocked', reason: 'browser-host-session-hidden' };
  if (!session.liveSurfaceRef) return { status: 'blocked', reason: 'browser-host-session-hidden' };
  if (
    (session as { diagnosticOnly?: unknown }).diagnosticOnly === true ||
    session.status === 'failed' ||
    session.status === 'closed' ||
    session.loadingProgress?.blocked === true ||
    session.loadingProgress?.reason === 'host-diagnostic'
  ) {
    return { status: 'blocked', reason: 'browser-host-session-diagnostic-only' };
  }
  const maxAgeMs = input.maxAgeMs ?? 5_000;
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const updatedAtMs = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAtMs) || (Number.isFinite(nowMs) && nowMs - updatedAtMs > maxAgeMs)) {
    return { status: 'blocked', reason: 'browser-host-session-stale' };
  }
  if (!input.permissionRef) return { status: 'blocked', reason: 'browser-host-session-permission-missing' };
  if (!input.cancelRef) return { status: 'blocked', reason: 'browser-host-session-cancel-path-missing' };
  return { status: 'ready' };
}

function browserHostActionTimingInput(options: {
  actionId?: string;
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
}): Partial<Pick<BrowserHostSessionActionInput, 'actionId' | 'uiEventReceivedAt' | 'adapterSentAt'>> {
  const timing: Partial<Pick<BrowserHostSessionActionInput, 'actionId' | 'uiEventReceivedAt' | 'adapterSentAt'>> = {};
  if (options.actionId) timing.actionId = options.actionId;
  if (options.uiEventReceivedAt) timing.uiEventReceivedAt = options.uiEventReceivedAt;
  if (options.adapterSentAt) timing.adapterSentAt = options.adapterSentAt;
  return timing;
}

function browserHostComputerUseDragPath(from: BrowserHostMousePoint, to: BrowserHostMousePoint): BrowserHostMousePoint[] {
  const steps = 8;
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(from.x + ((to.x - from.x) * index) / steps),
    y: Math.round(from.y + ((to.y - from.y) * index) / steps),
  }));
}

function requiredBrowserHostCoordinate(value: number | undefined, name: string) {
  if (!Number.isFinite(value)) throw new Error(`BrowserHostSession Computer Use action is missing ${name}.`);
  return Math.round(value as number);
}

function optionalBrowserHostCoordinate(value: number | undefined) {
  return Number.isFinite(value) ? Math.round(value as number) : undefined;
}

function browserHostComputerUseKey(key: string) {
  const normalized = key.trim();
  if (/^(cmd|command|meta|super)$/i.test(normalized)) return 'Meta';
  if (/^(ctrl|control)$/i.test(normalized)) return 'Control';
  if (/^option$/i.test(normalized)) return 'Alt';
  if (/^return$/i.test(normalized)) return 'Enter';
  if (normalized === ' ') return 'Space';
  return normalized;
}

function browserHostComputerUseMouseButton(value: BrowserHostMouseButton | undefined): BrowserHostMouseButton {
  return value === 'right' || value === 'middle' ? value : 'left';
}

function browserHostComputerUseActionMetadata(action: BrowserHostComputerUseAction): Partial<GenericVisionAction> & Record<string, unknown> {
  return action as Partial<GenericVisionAction> & Record<string, unknown>;
}

function browserHostComputerUseActorCursor(actionId: string | undefined): BrowserHostSessionActionInput['actorCursor'] {
  const safeActionId = safeBrowserHostComputerUseRefSegment(actionId ?? 'action');
  return {
    agentId: 'browser-host-computer-use',
    cursorId: `browser-host-computer-use-${safeActionId}`.slice(0, 96),
    color: '#28a0f0',
    label: 'BrowserHost Computer Use',
  };
}

function browserHostComputerUsePermissionRef(action: BrowserHostComputerUseAction): string | undefined {
  const metadata = browserHostComputerUseActionMetadata(action);
  return safeBrowserHostComputerUseScopedRef(metadata.permissionRef, /^permission:/i)
    ?? safeBrowserHostComputerUseScopedRef(metadata.permission, /^permission:/i);
}

function browserHostComputerUseCancelRef(action: BrowserHostComputerUseAction): string | undefined {
  const metadata = browserHostComputerUseActionMetadata(action);
  return safeBrowserHostComputerUseScopedRef(metadata.cancelRef, /^cancel:/i)
    ?? safeBrowserHostComputerUseScopedRef(metadata.stopRef, /^(?:cancel:|stop:|browser-host-session:.*\/(?:stop|close|cancel)$)/i)
    ?? safeBrowserHostComputerUseScopedRef(metadata.controlRef, /^(?:cancel:|stop:|browser-host-session:.*\/(?:stop|close|cancel)$)/i);
}

function safeBrowserHostComputerUseScopedRef(value: unknown, pattern: RegExp): string | undefined {
  const ref = stringField(value);
  if (!ref || ref.length > 240 || forbiddenBrowserHostRefPayload(ref) || !pattern.test(ref)) return undefined;
  return ref;
}

function browserHostComputerUseSessionEvidenceRefs(session: BrowserHostSessionState | undefined): string[] {
  if (!session) return [];
  return uniqueBrowserHostRefs([
    browserHostSessionManifestRef(session),
    session.liveSurfaceRef,
    session.frameRef,
    session.screenshotRef,
    session.domSnapshotRef,
    session.axSnapshotRef,
    session.consoleLogRef,
    session.networkLogRef,
    session.searchResultRef,
  ]);
}

function browserHostComputerUseSessionActionEvidenceRefs(session: BrowserHostSessionState | undefined): string[] {
  if (!session) return [];
  return uniqueBrowserHostRefs([
    ...(session.actorCursor?.lastAction?.evidenceRefs ?? []),
    ...(session.actorCursor?.evidenceRefs ?? []),
    ...(session.actorCursors ?? []).flatMap((cursor) => [
      ...cursor.lastAction.evidenceRefs,
      ...cursor.evidenceRefs,
    ]),
  ]);
}

function browserHostSessionManifestRef(session: BrowserHostSessionState): string {
  return `browser-host-session:${session.id}/session.json`;
}

function browserHostComputerUseExecutorEventRef(session: BrowserHostSessionState, actionId: string | undefined): string {
  return session.visibleAction?.visibleActionRef
    ?? `browser-host-session:${session.id}/executor-events/${safeBrowserHostComputerUseRefSegment(actionId ?? session.lastActionTiming?.actionId ?? 'action')}.json`;
}

function browserHostComputerUseActionProvenance(
  action: BrowserHostComputerUseAction,
  refs: {
    beforeEvidenceRefs: string[];
    groundingRefs: string[];
    afterEvidenceRefs: string[];
    executorEventRef: string;
    verificationRefs: string[];
  },
): ComputerUseActionProvenance {
  const metadata = browserHostComputerUseActionMetadata(action);
  return {
    displayGroupId: stringField(metadata.displayGroupId) ?? 'browser-host-session',
    screenId: stringField(metadata.screenId) ?? 'browser-host-session',
    windowId: stringField(metadata.windowId),
    actorId: stringField(metadata.actorId) ?? 'browser-host-session-agent',
    cursorId: stringField(metadata.cursorId) ?? 'browser-host-session-cursor',
    source: 'adapter',
    leaseScope: leaseScopeField(metadata.leaseScope),
    beforeEvidenceRefs: refs.beforeEvidenceRefs,
    groundingRefs: refs.groundingRefs,
    afterEvidenceRefs: refs.afterEvidenceRefs,
    executorEventRef: refs.executorEventRef,
    verificationRefs: refs.verificationRefs,
    approvalState: approvalStateField(metadata.approvalState) ?? 'not-required',
  };
}

function browserHostComputerUseFreshnessInvalidation(
  action: BrowserHostComputerUseAction,
  leaseScope: ComputerUseLeaseScope | undefined,
  session: BrowserHostSessionState,
): ComputerUseVisibleEvidenceInvalidation {
  const metadata = browserHostComputerUseActionMetadata(action);
  const scope = leaseScope ?? {
    kind: 'window-local' as const,
    displayGroupId: stringField(metadata.displayGroupId) ?? 'browser-host-session',
    screenId: stringField(metadata.screenId) ?? 'browser-host-session',
    windowId: stringField(metadata.windowId) ?? session.id,
  };
  return {
    invalidatesVisibleState: browserHostActionMutatesVisibleState(action.type),
    staleBy: session.visibleAction?.visibleActionRef ?? browserHostSessionManifestRef(session),
    scope,
    staleEvidenceKinds: ['observation', 'region', 'text', 'visual-object', 'vlm-claim', 'grounding'],
    preservedEvidenceKinds: ['artifact', 'verification', 'completion-claim'],
    reason: 'BrowserHostSession live input can change visible browser state; previous observation and grounding refs must be refreshed before later actions.',
  };
}

function browserHostActionMutatesVisibleState(type: BrowserHostComputerUseAction['type']): boolean {
  return type !== 'cursor' && type !== 'wait';
}

function stringRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? [value] : [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function uniqueBrowserHostRefs(values: Array<string | undefined>): string[] {
  const refs: string[] = [];
  for (const value of values) {
    const ref = typeof value === 'string' ? value.trim() : '';
    if (!ref || refs.includes(ref) || forbiddenBrowserHostRefPayload(ref)) continue;
    refs.push(ref.slice(0, 240));
  }
  return refs;
}

function forbiddenBrowserHostRefPayload(value: string): boolean {
  return /data:image|;base64|<html|<body|api[-_\s]?key|secret|token=/i.test(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function leaseScopeField(value: unknown): ComputerUseLeaseScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'screen-global' || record.kind === 'window-local' ? record.kind : undefined;
  const displayGroupId = stringField(record.displayGroupId);
  const screenId = stringField(record.screenId);
  if (!kind || !displayGroupId || !screenId) return undefined;
  return {
    kind,
    displayGroupId,
    screenId,
    windowId: stringField(record.windowId),
    reason: stringField(record.reason),
  };
}

function approvalStateField(value: unknown): ComputerUseApprovalState | undefined {
  return value === 'not-required' || value === 'needs-confirmation' || value === 'approved' || value === 'denied'
    ? value
    : undefined;
}

function safeBrowserHostComputerUseRefSegment(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'action';
}
