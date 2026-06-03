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
export type WindowActionAppKind = 'browser' | 'editor' | 'ordinary-app' | 'unknown';
export type WindowActionKind = 'observe' | 'click' | 'type' | 'scroll' | 'wait';
export type WindowActionEventType = WindowActionKind | 'actor-enter' | 'actor-leave' | 'pause' | 'stop' | 'remove-window';
export type WindowActionEventStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type WindowActionAdapter =
  | 'browser-host-session'
  | 'browser-cdp-playwright'
  | 'app-native-command'
  | 'accessibility-ui-automation'
  | 'system-input'
  | 'blocked';

export interface WindowActionTarget {
  type: 'browser-pane' | 'window-action-session';
  sessionId: string;
  windowRef: string;
}

export interface WindowActionEvidenceRef {
  kind: string;
  ref: string;
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

export interface WindowActionSession {
  schemaVersion: 'sciforge.window-action-session.v1';
  id: string;
  windowRef: string;
  process: WindowActionProcessInfo;
  app: Required<Pick<WindowActionAppInfo, 'kind'>> & WindowActionAppInfo;
  bounds?: WindowActionBounds;
  scale?: number;
  screenId?: string;
  status: WindowActionSessionStatus;
  actorCursor?: ActorCursor;
  events: WindowActionEvent[];
  evidenceRefs: WindowActionEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WindowActionRecordInput {
  action: WindowActionKind;
  status: WindowActionEventStatus;
  timestamp?: string;
  point?: { x: number; y: number };
  delta?: { x?: number; y?: number };
  durationMs?: number;
  textLength?: number;
  evidenceRefs?: unknown[];
}

export interface WindowActionEvent {
  id: string;
  type: WindowActionEventType;
  status: WindowActionEventStatus;
  timestamp: string;
  actorCursor?: ActorCursor;
  point?: { x: number; y: number };
  delta?: { x?: number; y?: number };
  durationMs?: number;
  textLength?: number;
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
      accessibility?: boolean;
      uiAutomation?: boolean;
      atSpi?: boolean;
      systemInput?: boolean;
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
  };
}

export interface WindowActionDispatchInput extends WindowActionRecordInput {
  target: WindowActionRouteInput['target'];
}

export interface WindowActionAdapterContext {
  session: WindowActionSession;
  route: WindowActionRoute;
  input: WindowActionDispatchInput;
}

export interface WindowActionAdapterResult {
  status?: WindowActionEventStatus;
  evidenceRefs?: unknown[];
}

export type WindowActionAdapterHandlers = Partial<Record<WindowActionAdapter, (
  context: WindowActionAdapterContext,
) => WindowActionAdapterResult | Promise<WindowActionAdapterResult>>>;

export interface WindowActionDispatchResult {
  route: WindowActionRoute;
  adapterResult: WindowActionAdapterResult;
  session: WindowActionSession;
}

const MAX_WINDOW_ACTION_EVIDENCE_REFS = 8;

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
  return {
    schemaVersion: 'sciforge.window-action-session.v1',
    id: input.id ? safeIdentifier(input.id, 'window-action-session') : sessionIdForWindowRef(input.windowRef),
    windowRef: boundedRef(input.windowRef) ?? sessionIdForWindowRef(input.windowRef),
    process: processInfo(input.process),
    app: appInfo(input.app),
    ...(input.bounds ? { bounds: bounds(input.bounds) } : {}),
    ...(Number.isFinite(input.scale) ? { scale: Number(input.scale) } : {}),
    ...(input.screenId ? { screenId: safeIdentifier(input.screenId, 'screen') } : {}),
    status: 'active',
    events: [],
    evidenceRefs: boundedEvidenceRefs(input.evidenceRefs),
    createdAt: now,
    updatedAt: now,
  };
}

export function enterWindowActionSession(
  session: WindowActionSession,
  actorCursor: ActorCursor,
  options: { timestamp?: string } = {},
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
  return appendEvent({
    ...session,
    ...(cursor ? { actorCursor: cursor } : {}),
  }, {
    id: eventId(session, input.action, timestamp),
    type: input.action,
    status: input.status,
    timestamp,
    ...(cursor ? { actorCursor: cursor } : {}),
    ...(input.point ? { point: point(input.point) } : {}),
    ...(input.delta ? { delta: input.delta } : {}),
    ...(Number.isFinite(input.durationMs) ? { durationMs: Math.max(0, Math.round(input.durationMs as number)) } : {}),
    ...(Number.isFinite(input.textLength) ? { textLength: Math.max(0, Math.round(input.textLength as number)) } : {}),
    evidenceRefs,
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
  if (capabilities.browserHostSession || capabilities.webContentsView) {
    return route(1, 'browser-host-session');
  }
  if (capabilities.cdp || capabilities.playwright || appKind === 'browser') {
    return route(1, 'browser-cdp-playwright');
  }
  if (capabilities.appNativeCommand || appKind === 'editor') {
    return route(2, 'app-native-command');
  }
  if (capabilities.accessibility || capabilities.uiAutomation || capabilities.atSpi) {
    return route(3, 'accessibility-ui-automation');
  }
  if (capabilities.systemInput) {
    const appId = safeRefPart(input.target.app?.id ?? input.target.app?.name ?? 'window');
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
      },
    };
  }
  return route(99, 'blocked');
}

export async function dispatchWindowAction(
  session: WindowActionSession,
  input: WindowActionDispatchInput,
  handlers: WindowActionAdapterHandlers,
): Promise<WindowActionDispatchResult> {
  const route = routeWindowAction({
    target: input.target,
    action: input.action,
    evidenceRefs: input.evidenceRefs,
  });
  if (session.status !== 'active') {
    return {
      route,
      adapterResult: { status: 'blocked', evidenceRefs: route.evidenceRefs },
      session,
    };
  }
  const handler = handlers[route.adapter];
  const adapterResult = handler
    ? await handler({ session, route, input })
    : { status: 'blocked' as const, evidenceRefs: route.evidenceRefs };
  const evidenceRefs = [
    ...route.evidenceRefs,
    ...(adapterResult.evidenceRefs ?? []),
  ];
  return {
    route,
    adapterResult,
    session: recordWindowAction(session, {
      ...input,
      status: adapterResult.status ?? input.status,
      evidenceRefs,
    }),
  };
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

function cursorStatusForAction(action: WindowActionKind): ActorCursorStatus {
  if (action === 'observe') return 'observing';
  if (action === 'click') return 'clicking';
  if (action === 'type') return 'typing';
  if (action === 'scroll') return 'scrolling';
  return 'waiting';
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
  if (value === 'browser' || value === 'editor' || value === 'ordinary-app') return value;
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
