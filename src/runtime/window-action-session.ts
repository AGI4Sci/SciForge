export type ActorCursorStatus =
  | 'idle'
  | 'observing'
  | 'clicking'
  | 'typing'
  | 'scrolling'
  | 'waiting'
  | 'leaving'
  | 'paused'
  | 'stopped';

export type WindowActionSessionStatus = 'active' | 'paused' | 'stopped' | 'removed';
export type WindowActionAppKind = 'browser' | 'editor' | 'terminal' | 'file-manager' | 'ordinary-app' | 'unknown';
export type WindowActionKind = 'observe' | 'click' | 'type' | 'scroll' | 'save' | 'rename' | 'move' | 'delete' | 'wait';
export type WindowActionEventType = WindowActionKind | 'actor-enter' | 'actor-leave' | 'pause' | 'stop' | 'remove-window';
export type WindowActionEventStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type WindowActionAdapter =
  | 'browser-host-session'
  | 'browser-cdp-playwright'
  | 'app-native-command'
  | 'terminal'
  | 'file-manager'
  | 'accessibility-ui-automation'
  | 'system-input'
  | 'blocked';
export type ScopedInputAdapterFocusMode = 'focus-free' | 'requires-focus' | 'blocked';
export type WindowActionFocusLeaseStatus = 'active' | 'released';
export type WindowActionObservationStatus = 'unknown' | 'current' | 'stale' | 'blocked';
export type WindowActionObservationStaleReason =
  | 'focus-loss'
  | 'window-migration'
  | 'resize'
  | 'occlusion'
  | 'close'
  | 'navigation'
  | 'scroll'
  | 'input';

export const WINDOW_ACTION_OBSERVATION_STALE_REASONS: readonly WindowActionObservationStaleReason[] = [
  'focus-loss',
  'window-migration',
  'resize',
  'occlusion',
  'close',
  'navigation',
  'scroll',
  'input',
] as const;

export interface WindowActionTarget {
  type: 'browser-pane' | 'window-action-session';
  sessionId: string;
  windowRef: string;
}

export interface WindowActionEvidenceRef {
  kind: string;
  ref: string;
}

export interface WindowActionObserveBeforeMutateEvidence {
  status?: string;
  observedAt?: string;
  capturedAt?: string;
  freshnessCheckedAt?: string;
  screenId?: string;
  windowRef?: string;
  freshnessCheck?: {
    status?: string;
    observedAt?: string;
    checkedAt?: string;
    expiresAt?: string;
    maxAgeMs?: number;
    reason?: string;
    staleBy?: string;
  };
}

export interface ActorCursorLastAction {
  action: WindowActionKind;
  status: WindowActionEventStatus;
  target?: WindowActionTarget;
  evidenceRefs: WindowActionEvidenceRef[];
}

export interface ActorCursor {
  agentId: string;
  cursorId?: string;
  color: string;
  label: string;
  status: ActorCursorStatus;
  target?: WindowActionTarget;
  lastAction?: ActorCursorLastAction;
  evidenceRefs?: string[];
}

export interface ScopedInputAdapter {
  schemaVersion: 'sciforge.scoped-input-adapter.v1';
  ref: string;
  agentId: string;
  actorCursorRef?: string;
  windowActionSessionRef: string;
  targetWindowRef: string;
  adapter: WindowActionAdapter;
  focusMode: ScopedInputAdapterFocusMode;
  inputQueueRef: string;
  focusLeaseRef?: string;
  evidenceRefs: WindowActionEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WindowActionFocusLease {
  schemaVersion: 'sciforge.window-action-focus-lease.v1';
  ref: string;
  status: WindowActionFocusLeaseStatus;
  scopedInputAdapterRef: string;
  target: WindowActionTarget;
  actor: {
    agentId: string;
    actorCursorRef?: string;
  };
  actionRefs: string[];
  acquiredAt: string;
  releasedAt?: string;
  evidenceRefs: WindowActionEvidenceRef[];
}

export interface WindowActionProcessInfo {
  pid?: number;
  name?: string;
  executablePath?: string;
}

export interface WindowActionAppInfo {
  id?: string;
  name?: string;
  kind?: WindowActionAppKind;
}

export interface WindowActionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowActionSessionInput {
  id?: string;
  windowRef: string;
  process?: WindowActionProcessInfo;
  app?: WindowActionAppInfo;
  bounds?: WindowActionBounds;
  scale?: number;
  screenId?: string;
  evidenceRefs?: unknown[];
  timestamp?: string;
}

export interface WindowActionTargetSummary {
  label?: string;
  appKind: WindowActionAppKind;
  windowRef: string;
  screenId?: string;
  bounds?: WindowActionBounds;
}

export interface WindowActionInputLease {
  ref: string;
  status: 'available' | 'leased' | 'blocked';
  holderRef?: string;
  updatedAt: string;
}

export interface WindowActionAuthorizationProfile {
  status: 'authorized' | 'requires-confirmation' | 'blocked';
  profileRef: string;
  permissionRefs: string[];
}

export interface WindowActionControlRefs {
  cancelRef: string;
  stopRef: string;
}

export interface WindowActionObservationLifecycle {
  status: WindowActionObservationStatus;
  observedAt?: string;
  stale: {
    reasons: WindowActionObservationStaleReason[];
    refreshRequired: boolean;
    evidenceRefs: WindowActionEvidenceRef[];
  };
  updatedAt: string;
}

export interface WindowActionSession {
  schemaVersion: 'sciforge.window-action-session.v1';
  id: string;
  windowRef: string;
  targetSummary: WindowActionTargetSummary;
  process: WindowActionProcessInfo;
  app: Required<Pick<WindowActionAppInfo, 'kind'>> & WindowActionAppInfo;
  bounds?: WindowActionBounds;
  scale?: number;
  screenId?: string;
  status: WindowActionSessionStatus;
  actorCursor?: ActorCursor;
  adapterRefs: string[];
  inputLease: WindowActionInputLease;
  focusLeaseRef?: string;
  authorizationProfile: WindowActionAuthorizationProfile;
  permissionRefs: string[];
  controlRefs: WindowActionControlRefs;
  evidenceLedgerRefs: string[];
  observation: WindowActionObservationLifecycle;
  scopedInputAdapters: ScopedInputAdapter[];
  events: WindowActionEvent[];
  evidenceRefs: WindowActionEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WindowActionRecordInput {
  actionId?: string;
  action: WindowActionKind;
  status: WindowActionEventStatus;
  timestamp?: string;
  scopedInputAdapterRef?: string;
  actorCursorRef?: string;
  focusLeaseRef?: string;
  point?: { x: number; y: number };
  delta?: { x?: number; y?: number };
  durationMs?: number;
  targetDescription?: string;
  targetRegionDescription?: string;
  text?: string;
  textLength?: number;
  sourceAnnotationRefs?: unknown[];
  beforeEvidenceRefs?: unknown[];
  afterEvidenceRefs?: unknown[];
  evidenceRefs?: unknown[];
  observeBeforeMutate?: WindowActionObserveBeforeMutateEvidence;
}

export interface WindowActionEvent {
  id: string;
  actionId?: string;
  type: WindowActionEventType;
  status: WindowActionEventStatus;
  timestamp: string;
  actorCursor?: ActorCursor;
  actorCursorRef?: string;
  scopedInputAdapterRef?: string;
  focusLeaseRef?: string;
  point?: { x: number; y: number };
  delta?: { x?: number; y?: number };
  durationMs?: number;
  textLength?: number;
  sourceAnnotationRefs?: WindowActionEvidenceRef[];
  beforeEvidenceRefs?: WindowActionEvidenceRef[];
  afterEvidenceRefs?: WindowActionEvidenceRef[];
  evidenceRefs: WindowActionEvidenceRef[];
}

export interface WindowActionRouteInput {
  target: {
    app?: WindowActionAppInfo;
    capabilities?: {
      browserHostSession?: boolean;
      cdp?: boolean;
      playwright?: boolean;
      webContentsView?: boolean;
      appNativeCommand?: boolean;
      terminal?: boolean;
      terminalWorkflow?: boolean;
      fileManager?: boolean;
      remote?: boolean;
      accessibility?: boolean;
      uiAutomation?: boolean;
      atSpi?: boolean;
      systemInput?: boolean;
      diagnostic?: boolean;
      explicitHandoff?: boolean;
      hardConfirmed?: boolean;
    };
  };
  action: WindowActionKind;
  evidenceRefs?: unknown[];
}

export interface WindowActionRoute {
  priority: 1 | 2 | 3 | 4 | 99;
  adapter: WindowActionAdapter;
  owner: 'agent-host-adapter';
  guiExecutable: false;
  evidenceRefs: WindowActionEvidenceRef[];
  evidence?: {
    sharedSystemInput?: true;
    bounded?: true;
    requiresFocusLease?: true;
    diagnosticOnly?: true;
    explicitHandoff?: true;
    accessibilityTargetHintsOnly?: true;
    nonPrivateActionBindingOnly?: true;
    terminalWorkflowRequired?: true;
    terminalWorkflowSelected?: true;
    shellArtifactsAreGuiArtifacts?: false;
    editorSaveRequiresInputEvent?: true;
    editorSaveRequiresArtifactValidator?: true;
    fileManagerRequiresVisibleSelection?: true;
    fileManagerRequiresDirectoryEvidence?: true;
    hardConfirmRequired?: true;
  };
}

export interface WindowActionDispatchInput extends WindowActionRecordInput {
  target: WindowActionRouteInput['target'];
}

export interface WindowActionAdapterContext {
  session: WindowActionSession;
  route: WindowActionRoute;
  scopedInputAdapter: ScopedInputAdapter;
  focusLease?: WindowActionFocusLease;
  input: WindowActionDispatchInput;
}

export interface WindowActionAdapterResult {
  status?: WindowActionEventStatus;
  blockedReason?: string;
  sourceAnnotationRefs?: unknown[];
  beforeEvidenceRefs?: unknown[];
  afterEvidenceRefs?: unknown[];
  evidenceRefs?: unknown[];
  commandIntentRefs?: unknown[];
  visibleTerminalSessionRefs?: unknown[];
  transcriptRefs?: unknown[];
  exitCode?: number;
  exitCodeRefs?: unknown[];
  artifactRefs?: unknown[];
  inputEventRefs?: unknown[];
  artifactValidatorRefs?: unknown[];
  visibleFileSelectionRefs?: unknown[];
  directoryEvidenceRefs?: unknown[];
}

export type WindowActionAdapterHandlers = Partial<Record<WindowActionAdapter, (
  context: WindowActionAdapterContext,
) => WindowActionAdapterResult | Promise<WindowActionAdapterResult>>>;

export interface WindowActionDispatchResult {
  route: WindowActionRoute;
  adapterResult: WindowActionAdapterResult;
  scopedInputAdapter: ScopedInputAdapter;
  focusLease?: WindowActionFocusLease | WindowActionFocusLeasePlan;
  session: WindowActionSession;
}

export interface WindowActionGuiProjection {
  schemaVersion: 'sciforge.window-action-session.gui-projection.v1';
  sessionRef: string;
  status: WindowActionSessionStatus;
  actorCursor?: {
    ref?: string;
    agentId: string;
    color: string;
    label: string;
    status: ActorCursorStatus;
    target?: WindowActionTarget;
  };
  confirmation: {
    required: boolean;
    confirmationRef?: string;
  };
  controls: WindowActionControlRefs;
}

export interface WindowActionDispatchOptions {
  agentId?: string;
  actorCursorRef?: string;
  activeFocusLeases?: WindowActionFocusLease[];
  timestamp?: string;
}

export type WindowActionFocusLeasePlan =
  | {
    status: 'not-required';
    ref?: undefined;
    lease?: undefined;
    reason?: undefined;
    conflictingLeaseRef?: undefined;
  }
  | {
    status: 'acquired';
    ref: string;
    lease: WindowActionFocusLease;
    reason?: undefined;
    conflictingLeaseRef?: undefined;
  }
  | {
    status: 'queued';
    ref: string;
    reason: string;
    conflictingLeaseRef: string;
    lease?: undefined;
  };

export type WindowActionAnnotationBindingStatus = 'manual-bound' | 'auto-bound' | 'unbound' | 'blocked';
export type WindowActionAnnotationCandidateStatus = 'candidate' | 'explanatory-target' | 'blocked';

export interface WindowActionAnnotationCandidateTarget {
  windowRef: string;
  windowLocalBounds?: WindowActionBounds;
  windowBounds?: WindowActionBounds;
  screenId?: string;
  scale?: number;
  app?: WindowActionAppInfo;
  process?: WindowActionProcessInfo;
}

export interface WindowActionAnnotationCandidateDecision {
  status: WindowActionAnnotationCandidateStatus;
  bindingStatus?: WindowActionAnnotationBindingStatus;
  reason?: string;
  requiresExplicitActionFlow: boolean;
  target?: WindowActionAnnotationCandidateTarget;
  routeTarget?: WindowActionRouteInput['target'];
  evidenceRefs: WindowActionEvidenceRef[];
}

export interface WindowActionAnnotationCandidateOptions {
  capabilities?: WindowActionRouteInput['target']['capabilities'];
  highConfidenceThreshold?: number;
}

export interface WindowActionSessionFromAnnotationOptions extends WindowActionAnnotationCandidateOptions {
  explicitActionFlowRef?: string;
  timestamp?: string;
}

export type WindowActionSessionFromAnnotationResult =
  | {
    status: 'created';
    session: WindowActionSession;
    candidate: WindowActionAnnotationCandidateDecision;
  }
  | {
    status: 'requires-explicit-action-flow' | 'blocked';
    reason?: string;
    candidate: WindowActionAnnotationCandidateDecision;
    session?: undefined;
  };

const MAX_WINDOW_ACTION_EVIDENCE_REFS = 8;
const HIGH_CONFIDENCE_AUTO_BOUND_THRESHOLD = 0.9;

export function createActorCursor(input: {
  agentId: string;
  color: string;
  label: string;
  cursorId?: string;
  status?: ActorCursorStatus;
  target?: WindowActionTarget;
  lastAction?: ActorCursorLastAction;
  evidenceRefs?: string[];
}): ActorCursor {
  return {
    agentId: safeIdentifier(input.agentId, 'agent'),
    ...(input.cursorId ? { cursorId: safeIdentifier(input.cursorId, `${safeIdentifier(input.agentId, 'agent')}-cursor`) } : {}),
    color: safeColor(input.color),
    label: boundedText(input.label, 80) || safeIdentifier(input.agentId, 'agent'),
    status: input.status ?? 'idle',
    ...(input.target ? { target: input.target } : {}),
    ...(input.lastAction ? { lastAction: input.lastAction } : {}),
    ...(input.evidenceRefs?.length ? { evidenceRefs: input.evidenceRefs.map((ref) => boundedRef(ref)).filter((ref): ref is string => Boolean(ref)).slice(0, 8) } : {}),
  };
}

export function createWindowActionSession(input: WindowActionSessionInput): WindowActionSession {
  const now = input.timestamp ?? new Date().toISOString();
  const id = input.id ? safeIdentifier(input.id, 'window-action-session') : sessionIdForWindowRef(input.windowRef);
  const windowRef = boundedRef(input.windowRef) ?? sessionIdForWindowRef(input.windowRef);
  const normalizedApp = appInfo(input.app);
  const normalizedBounds = input.bounds ? bounds(input.bounds) : undefined;
  const screenId = input.screenId ? safeIdentifier(input.screenId, 'screen') : undefined;
  const evidenceRefs = boundedEvidenceRefs(input.evidenceRefs);
  const productRefs = productRefsForSession(id);
  const evidenceLedgerRefs = uniqueStrings([
    ...evidenceRefs
      .filter((item) => item.kind === 'evidence-ledger' || item.ref.startsWith('evidence:'))
      .map((item) => item.ref),
    productRefs.evidenceLedgerRef,
  ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS);
  return {
    schemaVersion: 'sciforge.window-action-session.v1',
    id,
    windowRef,
    targetSummary: {
      ...(normalizedApp.name ? { label: normalizedApp.name } : {}),
      appKind: normalizedApp.kind,
      windowRef,
      ...(screenId ? { screenId } : {}),
      ...(normalizedBounds ? { bounds: normalizedBounds } : {}),
    },
    process: processInfo(input.process),
    app: normalizedApp,
    ...(normalizedBounds ? { bounds: normalizedBounds } : {}),
    ...(Number.isFinite(input.scale) ? { scale: Number(input.scale) } : {}),
    ...(screenId ? { screenId } : {}),
    status: 'active',
    adapterRefs: [],
    inputLease: {
      ref: productRefs.inputLeaseRef,
      status: 'available',
      updatedAt: now,
    },
    authorizationProfile: {
      status: 'authorized',
      profileRef: productRefs.authorizationProfileRef,
      permissionRefs: [productRefs.permissionRef],
    },
    permissionRefs: [productRefs.permissionRef],
    controlRefs: {
      cancelRef: productRefs.cancelRef,
      stopRef: productRefs.stopRef,
    },
    evidenceLedgerRefs,
    observation: {
      status: 'unknown',
      stale: {
        reasons: [],
        refreshRequired: true,
        evidenceRefs: [],
      },
      updatedAt: now,
    },
    scopedInputAdapters: [],
    events: [],
    evidenceRefs,
    createdAt: now,
    updatedAt: now,
  };
}

export function enterWindowActionSession(
  session: WindowActionSession,
  actorCursor: ActorCursor,
  options: { timestamp?: string; actorCursorRef?: string; scopedInputAdapterRef?: string } = {},
): WindowActionSession {
  if (session.status !== 'active') return session;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const target = targetForSession(session);
  const nextCursor = createActorCursor({
    ...actorCursor,
    status: 'observing',
    target,
  });
  return appendEvent({
    ...session,
    actorCursor: nextCursor,
    status: 'active',
  }, {
    id: eventId(session, 'actor-enter', timestamp),
    type: 'actor-enter',
    status: 'completed',
    timestamp,
    actorCursor: nextCursor,
    ...(boundedRef(options.actorCursorRef) ? { actorCursorRef: boundedRef(options.actorCursorRef) } : {}),
    ...(boundedRef(options.scopedInputAdapterRef) ? { scopedInputAdapterRef: boundedRef(options.scopedInputAdapterRef) } : {}),
    evidenceRefs: [],
  });
}

export function leaveWindowActionSession(
  session: WindowActionSession,
  options: { timestamp?: string } = {},
): WindowActionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const nextCursor = session.actorCursor
    ? createActorCursor({ ...session.actorCursor, status: 'leaving' })
    : undefined;
  const next = appendEvent({
    ...session,
    actorCursor: undefined,
  }, {
    id: eventId(session, 'actor-leave', timestamp),
    type: 'actor-leave',
    status: 'completed',
    timestamp,
    ...(nextCursor ? { actorCursor: nextCursor } : {}),
    evidenceRefs: [],
  });
  return { ...next, actorCursor: undefined };
}

export function recordWindowAction(
  session: WindowActionSession,
  input: WindowActionRecordInput,
): WindowActionSession {
  if (session.status !== 'active') return session;
  const timestamp = input.timestamp ?? new Date().toISOString();
  const evidenceRefs = boundedEvidenceRefs(input.evidenceRefs);
  const sourceAnnotationRefs = boundedEvidenceRefs(input.sourceAnnotationRefs);
  const beforeEvidenceRefs = boundedEvidenceRefs(input.beforeEvidenceRefs);
  const afterEvidenceRefs = boundedEvidenceRefs(input.afterEvidenceRefs);
  const actionId = typeof input.actionId === 'string' && input.actionId.trim()
    ? safeIdentifier(input.actionId, 'action')
    : undefined;
  const scopedInputAdapterRef = boundedRef(input.scopedInputAdapterRef);
  const actorCursorRef = boundedRef(input.actorCursorRef);
  const focusLeaseRef = boundedRef(input.focusLeaseRef);
  const eventEvidenceRefs = uniqueEvidenceRefs([
    ...evidenceRefs,
    ...(actorCursorRef ? [{ kind: 'actor-cursor', ref: actorCursorRef }] : []),
  ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS);
  const cursor = session.actorCursor
    ? createActorCursor({
        ...session.actorCursor,
        status: cursorStatusForAction(input.action),
        target: session.actorCursor.target ?? targetForSession(session),
        lastAction: {
          action: input.action,
          status: input.status,
          target: session.actorCursor.target ?? targetForSession(session),
          evidenceRefs,
        },
      })
    : undefined;
  const sessionWithCursor = {
    ...session,
    ...(cursor ? { actorCursor: cursor } : {}),
  };
  return appendEvent(staleAfterCompletedAction(sessionWithCursor, input.action, input.status, timestamp), {
    id: eventId(session, input.action, timestamp),
    ...(actionId ? { actionId } : {}),
    type: input.action,
    status: input.status,
    timestamp,
    ...(cursor ? { actorCursor: cursor } : {}),
    ...(actorCursorRef ? { actorCursorRef } : {}),
    ...(scopedInputAdapterRef ? { scopedInputAdapterRef } : {}),
    ...(focusLeaseRef ? { focusLeaseRef } : {}),
    ...(input.point ? { point: point(input.point) } : {}),
    ...(input.delta ? { delta: input.delta } : {}),
    ...(Number.isFinite(input.durationMs) ? { durationMs: Math.max(0, Math.round(input.durationMs as number)) } : {}),
    ...(Number.isFinite(input.textLength) ? { textLength: Math.max(0, Math.round(input.textLength as number)) } : {}),
    ...(sourceAnnotationRefs.length ? { sourceAnnotationRefs } : {}),
    ...(beforeEvidenceRefs.length ? { beforeEvidenceRefs } : {}),
    ...(afterEvidenceRefs.length ? { afterEvidenceRefs } : {}),
    evidenceRefs: eventEvidenceRefs,
  });
}

export function pauseWindowActionSession(
  session: WindowActionSession,
  options: { timestamp?: string; evidenceRefs?: unknown[] } = {},
): WindowActionSession {
  return controlWindowActionSession(session, 'pause', 'paused', 'paused', options);
}

export function stopWindowActionSession(
  session: WindowActionSession,
  options: { timestamp?: string; evidenceRefs?: unknown[] } = {},
): WindowActionSession {
  return controlWindowActionSession(session, 'stop', 'stopped', 'stopped', options);
}

export function removeWindowActionSession(
  session: WindowActionSession,
  options: { timestamp?: string; evidenceRefs?: unknown[] } = {},
): WindowActionSession {
  return controlWindowActionSession(session, 'remove-window', 'removed', 'stopped', options);
}

export function routeWindowAction(input: WindowActionRouteInput): WindowActionRoute {
  const capabilities = input.target.capabilities ?? {};
  const appKind = input.target.app?.kind ?? 'unknown';
  const appId = safeRefPart(input.target.app?.id ?? input.target.app?.name ?? 'window');
  if (capabilities.browserHostSession || capabilities.webContentsView) {
    return route(1, 'browser-host-session');
  }
  if (capabilities.cdp || capabilities.playwright || appKind === 'browser') {
    return route(1, 'browser-cdp-playwright');
  }
  if (capabilities.appNativeCommand || appKind === 'editor') {
    return input.action === 'save'
      ? {
          ...route(2, 'app-native-command'),
          evidenceRefs: [
            { kind: 'editor-save-validation', ref: `editor-save-validation:${appId}:input-event-and-artifact-validator-required` },
          ],
          evidence: {
            editorSaveRequiresInputEvent: true,
            editorSaveRequiresArtifactValidator: true,
          },
        }
      : route(2, 'app-native-command');
  }
  if (capabilities.terminal || appKind === 'terminal') {
    return {
      ...route(2, 'terminal'),
      evidenceRefs: boundedEvidenceRefs(input.evidenceRefs),
      evidence: {
        terminalWorkflowRequired: true,
        ...(capabilities.terminalWorkflow ? { terminalWorkflowSelected: true } : {}),
        shellArtifactsAreGuiArtifacts: false,
      },
    };
  }
  if (capabilities.fileManager || appKind === 'file-manager') {
    const hardConfirmRequired = fileManagerActionRequiresHardConfirm(input.action, capabilities.remote === true);
    return {
      ...route(2, 'file-manager'),
      evidenceRefs: [
        { kind: 'file-manager-selection', ref: `file-manager:${appId}:visible-file-selection` },
        { kind: 'directory-evidence', ref: `file-manager:${appId}:directory-evidence` },
        ...(hardConfirmRequired ? [{ kind: 'hard-confirm', ref: `hard-confirm:file-manager:${appId}:${input.action}` }] : []),
        ...boundedEvidenceRefs(input.evidenceRefs),
      ].slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
      evidence: {
        bounded: true,
        fileManagerRequiresVisibleSelection: true,
        fileManagerRequiresDirectoryEvidence: true,
        ...(hardConfirmRequired ? { hardConfirmRequired: true } : {}),
      },
    };
  }
  if (capabilities.accessibility || capabilities.uiAutomation || capabilities.atSpi) {
    return {
      priority: 3,
      adapter: 'accessibility-ui-automation',
      owner: 'agent-host-adapter',
      guiExecutable: false,
      evidenceRefs: [
        { kind: 'target-hint', ref: `accessibility-ui-automation:${appId}:target-hints` },
        { kind: 'state-snapshot', ref: `accessibility-ui-automation:${appId}:state-snapshot` },
        { kind: 'non-private-action-binding', ref: `accessibility-ui-automation:${appId}:${input.action}:action-binding` },
        ...boundedEvidenceRefs(input.evidenceRefs),
      ].slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
      evidence: {
        bounded: true,
        accessibilityTargetHintsOnly: true,
        nonPrivateActionBindingOnly: true,
      },
    };
  }
  if (capabilities.systemInput) {
    return {
      priority: 4,
      adapter: 'system-input',
      owner: 'agent-host-adapter',
      guiExecutable: false,
      evidenceRefs: [
        { kind: 'shared-system-input', ref: `shared-system-input:${appId}:${input.action}` },
        ...boundedEvidenceRefs(input.evidenceRefs),
      ].slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
      evidence: {
        sharedSystemInput: true,
        bounded: true,
        requiresFocusLease: true,
        ...(capabilities.diagnostic ? { diagnosticOnly: true } : {}),
        ...(capabilities.explicitHandoff ? { explicitHandoff: true } : {}),
      },
    };
  }
  return route(99, 'blocked');
}

export function createScopedInputAdapter(
  session: WindowActionSession,
  route: WindowActionRoute,
  options: {
    agentId?: string;
    actorCursorRef?: string;
    focusLeaseRef?: string;
    timestamp?: string;
  } = {},
): ScopedInputAdapter {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const agentId = safeIdentifier(options.agentId ?? session.actorCursor?.agentId ?? 'agent', 'agent');
  const adapterPart = safeRefPart(route.adapter) || 'adapter';
  const scopedInputAdapterRef = `scoped-input-adapter:${safeRefPart(session.id)}/${safeRefPart(agentId)}/${adapterPart}`;
  const focusMode = focusModeForRoute(route);
  return {
    schemaVersion: 'sciforge.scoped-input-adapter.v1',
    ref: scopedInputAdapterRef,
    agentId,
    ...(boundedRef(options.actorCursorRef) ? { actorCursorRef: boundedRef(options.actorCursorRef) } : {}),
    windowActionSessionRef: `window-action-session:${safeRefPart(session.id)}`,
    targetWindowRef: session.windowRef,
    adapter: route.adapter,
    focusMode,
    inputQueueRef: `input-queue:${safeRefPart(session.id)}/${safeRefPart(agentId)}/${adapterPart}`,
    ...(boundedRef(options.focusLeaseRef) ? { focusLeaseRef: boundedRef(options.focusLeaseRef) } : {}),
    evidenceRefs: route.evidenceRefs,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createWindowActionFocusLease(input: {
  session: WindowActionSession;
  scopedInputAdapterRef: string;
  agentId?: string;
  actorCursorRef?: string;
  actionRef?: string;
  timestamp?: string;
  evidenceRefs?: unknown[];
}): WindowActionFocusLease {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const scopedInputAdapterRef = boundedRef(input.scopedInputAdapterRef)
    ?? `scoped-input-adapter:${safeRefPart(input.session.id)}/agent/system-input`;
  const agentId = safeIdentifier(input.agentId ?? input.session.actorCursor?.agentId ?? 'agent', 'agent');
  const actionRef = boundedRef(input.actionRef);
  return {
    schemaVersion: 'sciforge.window-action-focus-lease.v1',
    ref: `focus-lease:${safeRefPart(input.session.screenId ?? input.session.windowRef)}/${safeRefPart(agentId)}/${safeRefPart(timestamp)}`,
    status: 'active',
    scopedInputAdapterRef,
    target: targetForSession(input.session),
    actor: {
      agentId,
      ...(boundedRef(input.actorCursorRef) ? { actorCursorRef: boundedRef(input.actorCursorRef) } : {}),
    },
    actionRefs: actionRef ? [actionRef] : [],
    acquiredAt: timestamp,
    evidenceRefs: boundedEvidenceRefs(input.evidenceRefs),
  };
}

export function planWindowActionFocusLease(input: {
  session: WindowActionSession;
  scopedInputAdapter: ScopedInputAdapter;
  actionRef?: string;
  activeLeases?: WindowActionFocusLease[];
  timestamp?: string;
  evidenceRefs?: unknown[];
}): WindowActionFocusLeasePlan {
  if (input.scopedInputAdapter.focusMode !== 'requires-focus') return { status: 'not-required' };
  const conflictingLease = (input.activeLeases ?? []).find((lease) => (
    lease.status === 'active' && lease.target.windowRef !== ''
  ));
  if (conflictingLease) {
    return {
      status: 'queued',
      ref: `focus-lease-wait:${safeRefPart(input.session.id)}/${safeRefPart(input.scopedInputAdapter.agentId)}`,
      reason: `waiting-for-focus-lease:${conflictingLease.ref}`,
      conflictingLeaseRef: conflictingLease.ref,
    };
  }
  const lease = createWindowActionFocusLease({
    session: input.session,
    scopedInputAdapterRef: input.scopedInputAdapter.ref,
    agentId: input.scopedInputAdapter.agentId,
    actorCursorRef: input.scopedInputAdapter.actorCursorRef,
    actionRef: input.actionRef,
    timestamp: input.timestamp,
    evidenceRefs: input.evidenceRefs,
  });
  return {
    status: 'acquired',
    ref: lease.ref,
    lease,
  };
}

export function releaseWindowActionFocusLease(
  lease: WindowActionFocusLease,
  options: {
    actionRef?: string;
    timestamp?: string;
    evidenceRefs?: unknown[];
  } = {},
): WindowActionFocusLease {
  const actionRef = boundedRef(options.actionRef);
  return {
    ...lease,
    status: 'released',
    releasedAt: options.timestamp ?? new Date().toISOString(),
    actionRefs: uniqueStrings([
      ...lease.actionRefs,
      ...(actionRef ? [actionRef] : []),
    ]),
    evidenceRefs: uniqueEvidenceRefs([
      ...lease.evidenceRefs,
      ...boundedEvidenceRefs(options.evidenceRefs),
    ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
  };
}

export function markWindowActionObservationStale(
  session: WindowActionSession,
  reason: WindowActionObservationStaleReason,
  options: { timestamp?: string; evidenceRefs?: unknown[] } = {},
): WindowActionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const evidenceRefs = boundedEvidenceRefs(options.evidenceRefs);
  const reasons = uniqueObservationStaleReasons([
    ...session.observation.stale.reasons,
    reason,
  ]);
  return {
    ...session,
    observation: {
      ...session.observation,
      status: reason === 'close' ? 'blocked' : 'stale',
      stale: {
        reasons,
        refreshRequired: reason !== 'close',
        evidenceRefs: uniqueEvidenceRefs([
          ...session.observation.stale.evidenceRefs,
          ...evidenceRefs,
        ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
      },
      updatedAt: timestamp,
    },
    updatedAt: timestamp,
  };
}

export function projectWindowActionSessionForGui(
  session: WindowActionSession,
  options: { confirmationRef?: string } = {},
): WindowActionGuiProjection {
  const actorCursorRef = lastActorCursorRef(session);
  return {
    schemaVersion: 'sciforge.window-action-session.gui-projection.v1',
    sessionRef: `window-action-session:${safeRefPart(session.id)}`,
    status: session.status,
    ...(session.actorCursor ? {
      actorCursor: {
        ...(actorCursorRef ? { ref: actorCursorRef } : {}),
        agentId: session.actorCursor.agentId,
        color: session.actorCursor.color,
        label: session.actorCursor.label,
        status: session.actorCursor.status,
        ...(session.actorCursor.target ? { target: session.actorCursor.target } : {}),
      },
    } : {}),
    confirmation: {
      required: Boolean(boundedRef(options.confirmationRef)),
      ...(boundedRef(options.confirmationRef) ? { confirmationRef: boundedRef(options.confirmationRef) } : {}),
    },
    controls: session.controlRefs,
  };
}

export async function dispatchWindowAction(
  session: WindowActionSession,
  input: WindowActionDispatchInput,
  handlers: WindowActionAdapterHandlers,
  options: WindowActionDispatchOptions = {},
): Promise<WindowActionDispatchResult> {
  const route = routeWindowAction({
    target: input.target,
    action: input.action,
    evidenceRefs: input.evidenceRefs,
  });
  const actionRef = eventId(session, input.action, input.timestamp ?? options.timestamp ?? new Date().toISOString());
  const scopedInputAdapter = createScopedInputAdapter(session, route, {
    agentId: options.agentId,
    actorCursorRef: options.actorCursorRef,
    timestamp: input.timestamp ?? options.timestamp,
  });
  const focusLease = planWindowActionFocusLease({
    session,
    scopedInputAdapter,
    actionRef,
    activeLeases: options.activeFocusLeases,
    timestamp: input.timestamp ?? options.timestamp,
    evidenceRefs: route.evidenceRefs,
  });
  if (session.status !== 'active') {
    return {
      route,
      adapterResult: { status: 'blocked', evidenceRefs: route.evidenceRefs },
      scopedInputAdapter,
      focusLease,
      session,
    };
  }
  if (focusLease.status === 'queued') {
    return {
      route,
      adapterResult: { status: 'blocked', evidenceRefs: route.evidenceRefs },
      scopedInputAdapter,
      focusLease,
      session: recordWindowAction(addScopedInputAdapter(session, scopedInputAdapter), {
        ...input,
        status: 'blocked',
        scopedInputAdapterRef: scopedInputAdapter.ref,
        actorCursorRef: scopedInputAdapter.actorCursorRef,
        focusLeaseRef: focusLease.ref,
        evidenceRefs: [
          ...route.evidenceRefs,
          { kind: 'focus-lease', ref: focusLease.ref },
        ],
      }),
    };
  }
  const beforeEvidenceRefs = boundedEvidenceRefs(input.beforeEvidenceRefs);
  const observeBeforeMutateReason = windowActionRequiresObserveBeforeMutate(input.action)
    ? windowActionObserveBeforeMutateReason(session, input, beforeEvidenceRefs)
    : '';
  if (observeBeforeMutateReason) {
    const blockedEvidenceRefs = [
      ...route.evidenceRefs,
      { kind: 'observe-before-mutate', ref: `observe-before-mutate:${safeRefPart(session.id)}:${safeRefPart(input.action)}:${safeRefPart(observeBeforeMutateReason)}` },
    ];
    return {
      route,
      adapterResult: { status: 'blocked', evidenceRefs: blockedEvidenceRefs },
      scopedInputAdapter,
      focusLease,
      session: recordWindowAction(addScopedInputAdapter(session, scopedInputAdapter), {
        ...input,
        status: 'blocked',
        scopedInputAdapterRef: scopedInputAdapter.ref,
        actorCursorRef: scopedInputAdapter.actorCursorRef,
        focusLeaseRef: focusLease.status === 'acquired' ? focusLease.ref : undefined,
        evidenceRefs: blockedEvidenceRefs,
      }),
    };
  }
  const routePolicyBlock = routePolicyBlockReason(route, input);
  if (routePolicyBlock) {
    const blockedEvidenceRefs = [
      ...route.evidenceRefs,
      { kind: routePolicyBlock.kind, ref: routePolicyBlock.ref },
    ];
    return {
      route,
      adapterResult: {
        status: 'blocked',
        blockedReason: routePolicyBlock.reason,
        evidenceRefs: blockedEvidenceRefs,
      },
      scopedInputAdapter,
      focusLease,
      session: recordWindowAction(addScopedInputAdapter(session, scopedInputAdapter), {
        ...input,
        status: 'blocked',
        scopedInputAdapterRef: scopedInputAdapter.ref,
        actorCursorRef: scopedInputAdapter.actorCursorRef,
        focusLeaseRef: focusLease.status === 'acquired' ? focusLease.ref : undefined,
        evidenceRefs: blockedEvidenceRefs,
      }),
    };
  }
  const handler = handlers[route.adapter];
  const rawAdapterResult = handler
    ? await handler({
        session,
        route,
        scopedInputAdapter: {
          ...scopedInputAdapter,
          ...(focusLease.status === 'acquired' ? { focusLeaseRef: focusLease.ref } : {}),
        },
        ...(focusLease.status === 'acquired' ? { focusLease: focusLease.lease } : {}),
        input,
      })
    : { status: 'blocked' as const, evidenceRefs: route.evidenceRefs };
  const adapterResult = normalizeAdapterResult(session, route, input, rawAdapterResult);
  const evidenceRefs = [
    ...route.evidenceRefs,
    ...(focusLease.status === 'acquired' ? [{ kind: 'focus-lease', ref: focusLease.ref }] : []),
    ...(adapterResult.evidenceRefs ?? []),
  ];
  const sessionWithAdapter = addScopedInputAdapter(session, {
    ...scopedInputAdapter,
    ...(focusLease.status === 'acquired' ? { focusLeaseRef: focusLease.ref } : {}),
  });
  return {
    route,
    adapterResult,
    scopedInputAdapter: {
      ...scopedInputAdapter,
      ...(focusLease.status === 'acquired' ? { focusLeaseRef: focusLease.ref } : {}),
    },
    focusLease,
    session: recordWindowAction(sessionWithAdapter, {
      ...input,
      status: adapterResult.status ?? input.status,
      scopedInputAdapterRef: scopedInputAdapter.ref,
      actorCursorRef: scopedInputAdapter.actorCursorRef,
      focusLeaseRef: focusLease.status === 'acquired' ? focusLease.ref : undefined,
      sourceAnnotationRefs: [
        ...(input.sourceAnnotationRefs ?? []),
        ...(adapterResult.sourceAnnotationRefs ?? []),
      ],
      beforeEvidenceRefs: [
        ...(input.beforeEvidenceRefs ?? []),
        ...(adapterResult.beforeEvidenceRefs ?? []),
      ],
      afterEvidenceRefs: [
        ...(input.afterEvidenceRefs ?? []),
        ...(adapterResult.afterEvidenceRefs ?? []),
      ],
      evidenceRefs,
    }),
  };
}

export function windowActionCandidateFromAnnotationMetadata(
  metadata: unknown,
  options: WindowActionAnnotationCandidateOptions = {},
): WindowActionAnnotationCandidateDecision {
  const record = recordOrUndefined(metadata);
  if (!record) return blockedAnnotationCandidate('annotation metadata is missing', []);

  const binding = recordOrUndefined(record.windowBinding);
  const evidenceRefs = annotationEvidenceRefs(record);
  if (!binding) return blockedAnnotationCandidate('annotation windowBinding metadata is missing', evidenceRefs);

  const bindingStatus = annotationBindingStatus(binding.status);
  if (!bindingStatus) return blockedAnnotationCandidate('annotation windowBinding status is unsupported', evidenceRefs);

  if (bindingStatus === 'unbound' || bindingStatus === 'blocked') {
    return {
      status: 'blocked',
      bindingStatus,
      reason: boundedText(textOrUndefined(binding.reason) ?? `annotation windowBinding is ${bindingStatus}`, 160),
      requiresExplicitActionFlow: false,
      evidenceRefs,
    };
  }

  const windowRef = boundedRef(binding.windowRef);
  if (!windowRef) {
    return {
      status: 'blocked',
      bindingStatus,
      reason: 'annotation windowBinding does not include a valid windowRef',
      requiresExplicitActionFlow: false,
      evidenceRefs,
    };
  }

  const confidence = numberOrUndefined(binding.confidence);
  if (
    bindingStatus === 'auto-bound'
    && (confidence === undefined || confidence < (options.highConfidenceThreshold ?? HIGH_CONFIDENCE_AUTO_BOUND_THRESHOLD))
  ) {
    return {
      status: 'blocked',
      bindingStatus,
      reason: 'annotation auto-bound windowBinding confidence is below the action threshold',
      requiresExplicitActionFlow: false,
      evidenceRefs,
    };
  }

  const app = appInfo({
    id: textOrUndefined(binding.bundleId) ?? textOrUndefined(binding.appId),
    name: textOrUndefined(binding.appName) ?? textOrUndefined(binding.name),
    kind: appKind(textOrUndefined(binding.appKind) ?? textOrUndefined(binding.kind)),
  });
  const process = processInfo({
    pid: numberOrUndefined(binding.pid),
    name: textOrUndefined(binding.processName),
    executablePath: textOrUndefined(binding.executablePath),
  });
  const windowBounds = annotationBounds(binding.windowBounds);
  const windowLocalBounds = annotationBounds(binding.windowLocalBounds);
  const screenId = textOrUndefined(binding.screenId);
  const scale = numberOrUndefined(binding.scale);
  const target: WindowActionAnnotationCandidateTarget = {
    windowRef,
    ...(Object.keys(app).length ? { app } : {}),
    ...(Object.keys(process).length ? { process } : {}),
    ...(windowBounds ? { windowBounds } : {}),
    ...(windowLocalBounds ? { windowLocalBounds } : {}),
    ...(screenId ? { screenId: safeIdentifier(screenId, 'screen') } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
  const routeTarget = {
    ...(target.app ? { app: target.app } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  };

  return {
    status: bindingStatus === 'manual-bound' ? 'candidate' : 'explanatory-target',
    bindingStatus,
    reason: boundedText(textOrUndefined(binding.reason) ?? '', 160) || undefined,
    requiresExplicitActionFlow: true,
    target,
    routeTarget,
    evidenceRefs,
  };
}

export function createWindowActionSessionFromAnnotationMetadata(
  metadata: unknown,
  options: WindowActionSessionFromAnnotationOptions = {},
): WindowActionSessionFromAnnotationResult {
  const candidate = windowActionCandidateFromAnnotationMetadata(metadata, options);
  if (!candidate.target) {
    return {
      status: 'blocked',
      reason: candidate.reason,
      candidate,
    };
  }
  if (!boundedRef(options.explicitActionFlowRef)) {
    return {
      status: 'requires-explicit-action-flow',
      reason: 'annotation window binding requires an explicit WindowActionSession action flow',
      candidate,
    };
  }

  const session = createWindowActionSession({
    windowRef: candidate.target.windowRef,
    process: candidate.target.process,
    app: candidate.target.app,
    bounds: candidate.target.windowBounds,
    scale: candidate.target.scale,
    screenId: candidate.target.screenId,
    evidenceRefs: [
      ...candidate.evidenceRefs,
      { kind: 'action-flow', ref: options.explicitActionFlowRef },
    ],
    timestamp: options.timestamp,
  });
  return {
    status: 'created',
    session,
    candidate,
  };
}

function routePolicyBlockReason(
  route: WindowActionRoute,
  input: WindowActionDispatchInput,
): { kind: string; ref: string; reason: string } | undefined {
  const appId = safeRefPart(input.target.app?.id ?? input.target.app?.name ?? 'window') || 'window';
  if (route.adapter === 'system-input' && route.evidence?.diagnosticOnly !== true && route.evidence?.explicitHandoff !== true) {
    return {
      kind: 'shared-system-input-default-blocked',
      ref: `shared-system-input-default-blocked:${appId}:${safeRefPart(input.action)}`,
      reason: 'Shared system input is diagnostic or explicit handoff only; it cannot run as the default product action path.',
    };
  }
  if (route.adapter === 'file-manager' && route.evidence?.hardConfirmRequired === true && input.target.capabilities?.hardConfirmed !== true) {
    return {
      kind: 'hard-confirm',
      ref: `hard-confirm:file-manager:${appId}:${safeRefPart(input.action)}:required`,
      reason: 'File manager destructive remote/delete action requires hard-confirm before adapter execution.',
    };
  }
  return undefined;
}

function normalizeAdapterResult(
  session: WindowActionSession,
  route: WindowActionRoute,
  input: WindowActionDispatchInput,
  result: WindowActionAdapterResult,
): WindowActionAdapterResult {
  const evidenceRefs = uniqueEvidenceRefs([
    ...boundedEvidenceRefs(result.evidenceRefs),
    ...adapterSpecificEvidenceRefs(result),
  ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS);
  const block = adapterResultBlockReason(session, route, input, result, evidenceRefs);
  if (!block) {
    return {
      ...result,
      evidenceRefs,
    };
  }
  return {
    ...result,
    status: 'blocked',
    blockedReason: block.reason,
    evidenceRefs: uniqueEvidenceRefs([
      ...evidenceRefs,
      { kind: block.kind, ref: block.ref },
    ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS),
  };
}

function adapterSpecificEvidenceRefs(result: WindowActionAdapterResult): WindowActionEvidenceRef[] {
  return uniqueEvidenceRefs([
    ...boundedEvidenceRefs(result.commandIntentRefs),
    ...boundedEvidenceRefs(result.visibleTerminalSessionRefs),
    ...boundedEvidenceRefs(result.transcriptRefs),
    ...terminalExitCodeEvidenceRefs(result),
    ...boundedEvidenceRefs(result.artifactRefs),
    ...boundedEvidenceRefs(result.inputEventRefs),
    ...boundedEvidenceRefs(result.artifactValidatorRefs),
    ...boundedEvidenceRefs(result.visibleFileSelectionRefs),
    ...boundedEvidenceRefs(result.directoryEvidenceRefs),
  ]);
}

function terminalExitCodeEvidenceRefs(result: WindowActionAdapterResult): WindowActionEvidenceRef[] {
  const explicitRefs = boundedEvidenceRefs(result.exitCodeRefs);
  if (explicitRefs.length) return explicitRefs;
  if (!Number.isFinite(result.exitCode)) return [];
  const visibleSessionRef = boundedEvidenceRefs(result.visibleTerminalSessionRefs)[0]?.ref;
  const baseRef = visibleSessionRef?.replace(/\/visible$/i, '') ?? 'terminal-pty:session';
  const exitCodeRef = boundedRef(`${baseRef}/exit-code/${Math.round(result.exitCode as number)}`);
  return exitCodeRef ? [{ kind: 'exit-code', ref: exitCodeRef }] : [];
}

function adapterResultBlockReason(
  session: WindowActionSession,
  route: WindowActionRoute,
  input: WindowActionDispatchInput,
  result: WindowActionAdapterResult,
  evidenceRefs: WindowActionEvidenceRef[],
): { kind: string; ref: string; reason: string } | undefined {
  if (result.status !== 'completed') return undefined;
  const sessionPart = safeRefPart(session.id) || 'session';
  if (route.adapter === 'terminal') {
    const missing = [
      hasEvidence(evidenceRefs, /command[-_/]?intent/i) ? '' : 'command intent refs',
      hasEvidence(evidenceRefs, /visible[-_/]?terminal[-_/]?session/i) ? '' : 'visible terminal session refs',
      hasEvidence(evidenceRefs, /transcript/i) ? '' : 'transcript refs',
      hasEvidence(evidenceRefs, /exit[-_/]?code/i) ? '' : 'exit code refs',
    ].filter(Boolean);
    if (missing.length) {
      return {
        kind: 'terminal-evidence-missing',
        ref: `terminal-evidence-missing:${sessionPart}:${safeRefPart(missing.join('-'))}`,
        reason: `Terminal/PTY adapter completed without required ${missing.join(', ')}.`,
      };
    }
    if (hasEvidence(evidenceRefs, /artifact/i) && route.evidence?.terminalWorkflowSelected !== true) {
      return {
        kind: 'terminal-workflow-required',
        ref: `terminal-workflow-required-shell-artifact-not-gui:${sessionPart}`,
        reason: 'Terminal workflow is not explicit, so shell artifact refs cannot masquerade as GUI artifact evidence.',
      };
    }
  }
  if (input.action === 'save' && route.evidence?.editorSaveRequiresInputEvent === true) {
    const hasInputEvent = hasEvidence(evidenceRefs, /input[-_/]?event|keyboard[-_/]?input/i);
    const hasArtifactValidator = hasEvidence(evidenceRefs, /artifact[-_/]?(?:validator|validation)|validator/i);
    if (!hasInputEvent || !hasArtifactValidator) {
      return {
        kind: 'editor-save-validation',
        ref: `editor-save-validation:${sessionPart}:input-event-and-artifact-validator-required`,
        reason: 'Editor save action requires both visible input event refs and artifact validator refs.',
      };
    }
  }
  if (route.adapter === 'file-manager' && windowActionRequiresObserveBeforeMutate(input.action)) {
    const hasVisibleSelection = hasEvidence(evidenceRefs, /visible[-_/]?file[-_/]?selection|file[-_/]?selection/i);
    const hasDirectoryEvidence = hasEvidence(evidenceRefs, /directory[-_/]?evidence|directory[-_/]?listing|file[-_/]?list/i);
    if (!hasVisibleSelection || !hasDirectoryEvidence) {
      return {
        kind: 'file-manager-evidence-missing',
        ref: `file-manager-evidence-missing:${sessionPart}:selection-and-directory-evidence-required`,
        reason: 'File manager action requires visible file selection refs and directory evidence refs.',
      };
    }
  }
  return undefined;
}

function hasEvidence(evidenceRefs: WindowActionEvidenceRef[], pattern: RegExp): boolean {
  return evidenceRefs.some((item) => pattern.test(item.kind) || pattern.test(item.ref));
}

function controlWindowActionSession(
  session: WindowActionSession,
  type: Extract<WindowActionEventType, 'pause' | 'stop' | 'remove-window'>,
  status: WindowActionSessionStatus,
  cursorStatus: ActorCursorStatus,
  options: { timestamp?: string; evidenceRefs?: unknown[] },
): WindowActionSession {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const evidenceRefs = boundedEvidenceRefs(options.evidenceRefs);
  const cursor = session.actorCursor
    ? createActorCursor({ ...session.actorCursor, status: cursorStatus })
    : undefined;
  return appendEvent({
    ...session,
    status,
    ...(cursor ? { actorCursor: cursor } : {}),
  }, {
    id: eventId(session, type, timestamp),
    type,
    status: 'completed',
    timestamp,
    ...(cursor ? { actorCursor: cursor } : {}),
    evidenceRefs,
  });
}

function route(priority: WindowActionRoute['priority'], adapter: WindowActionAdapter): WindowActionRoute {
  return {
    priority,
    adapter,
    owner: 'agent-host-adapter',
    guiExecutable: false,
    evidenceRefs: [],
  };
}

function focusModeForRoute(route: WindowActionRoute): ScopedInputAdapterFocusMode {
  if (route.adapter === 'blocked') return 'blocked';
  return route.evidence?.requiresFocusLease ? 'requires-focus' : 'focus-free';
}

function addScopedInputAdapter(
  session: WindowActionSession,
  adapter: ScopedInputAdapter,
): WindowActionSession {
  const existing = session.scopedInputAdapters.filter((item) => item.ref !== adapter.ref);
  const adapterRefs = uniqueStrings([
    ...session.adapterRefs,
    adapter.ref,
    ...adapter.evidenceRefs.map((item) => item.ref),
  ]).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS);
  return {
    ...session,
    adapterRefs,
    inputLease: {
      ...session.inputLease,
      status: adapter.focusMode === 'blocked' ? 'blocked' : 'leased',
      holderRef: adapter.ref,
      updatedAt: adapter.updatedAt,
    },
    ...(adapter.focusLeaseRef ? { focusLeaseRef: adapter.focusLeaseRef } : {}),
    scopedInputAdapters: [...existing, adapter],
  };
}

function appendEvent(session: WindowActionSession, event: WindowActionEvent): WindowActionSession {
  const evidenceRefs = uniqueEvidenceRefs([
    ...session.evidenceRefs,
    ...event.evidenceRefs,
  ]).slice(-MAX_WINDOW_ACTION_EVIDENCE_REFS);
  return {
    ...session,
    events: [...session.events, event],
    evidenceRefs,
    updatedAt: event.timestamp,
  };
}

function targetForSession(session: WindowActionSession): WindowActionTarget {
  return {
    type: 'window-action-session',
    sessionId: session.id,
    windowRef: session.windowRef,
  };
}

function staleAfterCompletedAction(
  session: WindowActionSession,
  action: WindowActionKind,
  status: WindowActionEventStatus,
  timestamp: string,
): WindowActionSession {
  if (status !== 'completed') return session;
  if (action === 'scroll') return markWindowActionObservationStale(session, 'scroll', { timestamp });
  if (action === 'click' || action === 'type') return markWindowActionObservationStale(session, 'input', { timestamp });
  if (action === 'observe') {
    return {
      ...session,
      observation: {
        status: 'current',
        observedAt: timestamp,
        stale: {
          reasons: [],
          refreshRequired: false,
          evidenceRefs: [],
        },
        updatedAt: timestamp,
      },
      updatedAt: timestamp,
    };
  }
  return session;
}

function productRefsForSession(sessionId: string) {
  const safeSessionId = safeRefPart(sessionId);
  return {
    inputLeaseRef: `input-lease:window-action-session/${safeSessionId}`,
    authorizationProfileRef: `permission:window-action-session/${safeSessionId}/authorization-profile`,
    permissionRef: `permission:window-action-session/${safeSessionId}/act`,
    cancelRef: `cancel:window-action-session/${safeSessionId}`,
    stopRef: `stop:window-action-session/${safeSessionId}`,
    evidenceLedgerRef: `evidence:window-action-session/${safeSessionId}/ledger`,
  };
}

function uniqueObservationStaleReasons(values: WindowActionObservationStaleReason[]): WindowActionObservationStaleReason[] {
  const allowed = new Set<WindowActionObservationStaleReason>(WINDOW_ACTION_OBSERVATION_STALE_REASONS);
  const output: WindowActionObservationStaleReason[] = [];
  for (const value of values) {
    if (!allowed.has(value) || output.includes(value)) continue;
    output.push(value);
  }
  return output;
}

function lastActorCursorRef(session: WindowActionSession): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const ref = boundedRef(session.events[index]?.actorCursorRef);
    if (ref) return ref;
  }
  return undefined;
}

function cursorStatusForAction(action: WindowActionKind): ActorCursorStatus {
  if (action === 'observe') return 'observing';
  if (action === 'click') return 'clicking';
  if (action === 'type' || action === 'rename') return 'typing';
  if (action === 'scroll') return 'scrolling';
  return 'waiting';
}

function windowActionRequiresObserveBeforeMutate(action: WindowActionKind) {
  return action === 'click'
    || action === 'type'
    || action === 'scroll'
    || action === 'save'
    || action === 'rename'
    || action === 'move'
    || action === 'delete';
}

function fileManagerActionRequiresHardConfirm(action: WindowActionKind, remote: boolean) {
  return action === 'delete' || (remote && action === 'move');
}

function windowActionObserveBeforeMutateReason(
  session: WindowActionSession,
  input: WindowActionDispatchInput,
  beforeEvidenceRefs: WindowActionEvidenceRef[],
) {
  if (!beforeEvidenceRefs.length) return 'missing-before-evidence';
  const evidence = input.observeBeforeMutate;
  if (!evidence) return 'missing-current-observe-evidence';
  const freshness = evidence.freshnessCheck;
  const status = textOrUndefined(freshness?.status) ?? textOrUndefined(evidence.status);
  if (status !== 'current') {
    return textOrUndefined(freshness?.reason)
      ?? textOrUndefined(freshness?.staleBy)
      ?? `freshness-status-${status ?? 'missing'}`;
  }
  const screenId = textOrUndefined(evidence.screenId);
  if (screenId && session.screenId && safeIdentifier(screenId, 'screen') !== session.screenId) return 'scope-mismatch-screen';
  const windowRef = textOrUndefined(evidence.windowRef);
  if (windowRef) {
    const boundedWindowRef = boundedRef(windowRef);
    if (!boundedWindowRef) return 'invalid-window-ref';
    if (boundedWindowRef !== session.windowRef) return 'scope-mismatch-window';
  }
  const nowMs = timestampMs(input.timestamp ?? new Date().toISOString());
  const observedAtMs = timestampMs(evidence.observedAt ?? evidence.capturedAt ?? freshness?.observedAt);
  const checkedAtMs = timestampMs(evidence.freshnessCheckedAt ?? freshness?.checkedAt);
  const expiresAtMs = timestampMs(freshness?.expiresAt);
  if (nowMs === undefined) return 'invalid-current-timestamp';
  if (observedAtMs === undefined) return 'missing-observation-timestamp';
  if (checkedAtMs === undefined) return 'missing-freshness-check-timestamp';
  if (expiresAtMs !== undefined && nowMs > expiresAtMs) return 'observation-expired';
  const maxAgeMs = Math.max(1, Number.isFinite(freshness?.maxAgeMs) ? Math.round(freshness?.maxAgeMs as number) : 30_000);
  if (nowMs - observedAtMs > maxAgeMs) return 'stale-observation';
  if (nowMs - checkedAtMs > maxAgeMs) return 'stale-freshness-check';
  return '';
}

function timestampMs(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sessionIdForWindowRef(windowRef: string) {
  return `window-action-${safeRefPart(windowRef) || 'session'}`;
}

function eventId(session: WindowActionSession, type: WindowActionEventType, timestamp: string) {
  return `${session.id}:${type}:${session.events.length + 1}:${safeRefPart(timestamp)}`;
}

function processInfo(value: WindowActionProcessInfo | undefined): WindowActionProcessInfo {
  return {
    ...(Number.isFinite(value?.pid) ? { pid: Math.round(value?.pid as number) } : {}),
    ...(value?.name ? { name: boundedText(value.name, 120) } : {}),
    ...(value?.executablePath ? { executablePath: boundedText(value.executablePath, 240) } : {}),
  };
}

function appInfo(value: WindowActionAppInfo | undefined): Required<Pick<WindowActionAppInfo, 'kind'>> & WindowActionAppInfo {
  return {
    ...(value?.id ? { id: boundedText(value.id, 160) } : {}),
    ...(value?.name ? { name: boundedText(value.name, 120) } : {}),
    kind: appKind(value?.kind),
  };
}

function appKind(value: string | undefined): WindowActionAppKind {
  if (value === 'browser' || value === 'editor' || value === 'terminal' || value === 'file-manager' || value === 'ordinary-app') return value;
  return 'unknown';
}

function bounds(value: WindowActionBounds): WindowActionBounds {
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    width: Math.max(0, finiteNumber(value.width)),
    height: Math.max(0, finiteNumber(value.height)),
  };
}

function point(value: { x: number; y: number }) {
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
  };
}

function finiteNumber(value: number) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function boundedEvidenceRefs(value: unknown[] | undefined): WindowActionEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return uniqueEvidenceRefs(value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? boundedText(record.kind, 64) : '';
    const ref = boundedRef(record.ref);
    return kind && ref ? { kind, ref } : undefined;
  })).slice(0, MAX_WINDOW_ACTION_EVIDENCE_REFS);
}

function annotationEvidenceRefs(record: Record<string, unknown>): WindowActionEvidenceRef[] {
  return boundedEvidenceRefs([
    { kind: 'annotation', ref: record.annotationRef },
    { kind: 'screenshot', ref: record.screenshotRef },
    { kind: 'crop', ref: record.cropRef },
    { kind: 'image', ref: record.imageRef },
    ...(Array.isArray(record.evidenceRefs) ? record.evidenceRefs : []),
  ]);
}

function blockedAnnotationCandidate(
  reason: string,
  evidenceRefs: WindowActionEvidenceRef[],
): WindowActionAnnotationCandidateDecision {
  return {
    status: 'blocked',
    reason,
    requiresExplicitActionFlow: false,
    evidenceRefs,
  };
}

function annotationBindingStatus(value: unknown): WindowActionAnnotationBindingStatus | undefined {
  return value === 'manual-bound'
    || value === 'auto-bound'
    || value === 'unbound'
    || value === 'blocked'
    ? value
    : undefined;
}

function annotationBounds(value: unknown): WindowActionBounds | undefined {
  const record = recordOrUndefined(value);
  if (!record) return undefined;
  return bounds({
    x: numberOrUndefined(record.x) ?? 0,
    y: numberOrUndefined(record.y) ?? 0,
    width: numberOrUndefined(record.width) ?? 0,
    height: numberOrUndefined(record.height) ?? 0,
  });
}

function uniqueEvidenceRefs(values: Array<WindowActionEvidenceRef | undefined>): WindowActionEvidenceRef[] {
  const seen = new Set<string>();
  const output: WindowActionEvidenceRef[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = `${value.kind}\n${value.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Number(value);
}

function boundedRef(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:[a-z0-9][a-z0-9._:/#?-]*$/i.test(normalized)) return undefined;
  return normalized.slice(0, 240);
}

function safeIdentifier(value: string, fallback: string) {
  const safe = value.trim().replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return safe || fallback;
}

function safeRefPart(value: string) {
  return value.trim().replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96).toLowerCase();
}

function safeColor(value: string) {
  const color = value.trim();
  return /^#[a-f0-9]{6}$/i.test(color) ? color : '#00d5ff';
}

function boundedText(value: string, max: number) {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}
