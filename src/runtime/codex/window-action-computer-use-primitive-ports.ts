import type {
  ComputerUseActInput,
  ComputerUseActOutput,
  ComputerUseAtomicAction,
  ComputerUseBindInput,
  ComputerUseBindOutput,
  ComputerUseControlInput,
  ComputerUseControlOutput,
  ComputerUseObserveInput,
  ComputerUseObserveOutput,
  ComputerUsePrimitivePortResult,
  ComputerUsePrimitivePorts,
} from '../../../packages/actions/computer-use/index.js';
import {
  dispatchWindowAction,
  recordWindowAction,
  type WindowActionAdapter,
  type WindowActionAdapterHandlers,
  type WindowActionDispatchInput,
  type WindowActionEvidenceRef,
  type WindowActionKind,
  type WindowActionSession,
  type WindowActionObserveBeforeMutateEvidence,
} from '../window-action-session.js';
import {
  createDefaultWindowActionSessionStore,
  type WindowActionSessionStore,
  type WindowActionSessionStoreEntry,
} from '../window-action-session-store.js';

export interface WindowActionSessionComputerUsePrimitivePortsOptions {
  windowActionSessionStore?: WindowActionSessionStore;
  adapterHandlers?: WindowActionAdapterHandlers;
  resolveTextRef?: (ref: string) => Promise<string | undefined> | string | undefined;
  terminalWorkflowSelected?: boolean;
  sharedSystemInputMode?: 'blocked' | 'diagnostic' | 'explicit-handoff';
  now?: () => Date;
}

interface BoundWindowActionPrimitiveSession {
  sessionId: string;
  sessionRef: string;
  windowActionSessionRef: string;
  inputAdapterRef: string;
  cursorRef: string;
  scopedInputLeaseRef: string;
  adapter: WindowActionAdapter;
  latestObservation?: {
    observationRef: string;
    screenshotRef: string;
    accessibilityRef: string;
    elementRefs: string[];
    textRefs: string[];
    observedAt: string;
    refs: string[];
  };
  latestWindowActionSession?: WindowActionSession;
}

interface SharedSystemInputRuntimeLease {
  ref: string;
  sessionId: string;
  inputAdapterRef: string;
  acquiredAt: string;
}

export function createWindowActionSessionComputerUsePrimitivePorts(
  options: WindowActionSessionComputerUsePrimitivePortsOptions = {},
): ComputerUsePrimitivePorts {
  const store = options.windowActionSessionStore ?? createDefaultWindowActionSessionStore({ now: options.now });
  const adapterHandlers = options.adapterHandlers ?? {};
  const now = options.now ?? (() => new Date());
  const sessions = new Map<string, BoundWindowActionPrimitiveSession>();
  const sharedSystemInput = { activeLease: undefined as SharedSystemInputRuntimeLease | undefined };

  return {
    bind: async (input) => bindWindowActionSession(input, {
      store,
      adapterHandlers,
      now,
      sessions,
      sharedSystemInputMode: options.sharedSystemInputMode ?? 'blocked',
    }),
    observe: async (input) => observeWindowActionSession(input, { store, now, sessions }),
    act: async (input) => actWindowActionSession(input, {
      store,
      adapterHandlers,
      now,
      sessions,
      resolveTextRef: options.resolveTextRef,
      terminalWorkflowSelected: options.terminalWorkflowSelected,
      sharedSystemInputMode: options.sharedSystemInputMode ?? 'blocked',
      sharedSystemInput,
    }),
    control: async (input) => controlWindowActionSession(input, { store, now, sessions }),
  };
}

function bindWindowActionSession(
  input: ComputerUseBindInput,
  context: {
    store: WindowActionSessionStore;
    adapterHandlers: WindowActionAdapterHandlers;
    now: () => Date;
    sessions: Map<string, BoundWindowActionPrimitiveSession>;
    sharedSystemInputMode: NonNullable<WindowActionSessionComputerUsePrimitivePortsOptions['sharedSystemInputMode']>;
  },
): ComputerUsePrimitivePortResult<ComputerUseBindOutput> {
  const entry = activeEntryFromTarget(input, context.store);
  if (!entry) return blocked('bind_target_unavailable', ['runtime-truth:computer-use-primitive/window-action-session-target-missing']);
  const adapter = primaryAdapterForSession(entry.session, context.adapterHandlers, context.sharedSystemInputMode);
  if (!adapter || adapter === 'blocked') {
    return blocked('window_action_session_adapter_unavailable', [
      entry.ref,
      `adapter-registry:window-action-session/${safeRefPart(entry.session.id)}/missing-product-adapter`,
    ]);
  }
  const sessionId = uniqueSessionId(safeRefPart(entry.session.id), context.sessions);
  const sessionRef = `computer-use:session:${sessionId}`;
  const windowActionSessionRef = entry.ref;
  const binding: BoundWindowActionPrimitiveSession = {
    sessionId,
    sessionRef,
    windowActionSessionRef,
    inputAdapterRef: scopedInputAdapterRef(entry.session, adapter),
    cursorRef: `actor-cursor:computer-use/${safeRefPart(sessionId)}`,
    scopedInputLeaseRef: entry.session.inputLease.ref,
    adapter,
    latestWindowActionSession: entry.session,
  };
  context.sessions.set(sessionId, binding);
  return {
    status: 'completed',
    output: {
      sessionId,
      sessionRef,
      targetRef: entry.session.windowRef,
      windowActionSessionRef,
      inputAdapterRef: binding.inputAdapterRef,
      cursorRef: binding.cursorRef,
      scopedInputLeaseRef: binding.scopedInputLeaseRef,
      observationRef: firstObservationRef(entry),
    },
    refs: uniqueStrings([
      sessionRef,
      windowActionSessionRef,
      binding.inputAdapterRef,
      binding.cursorRef,
      binding.scopedInputLeaseRef,
      ...entry.refs,
      ...entry.targetRefs,
      ...entry.observationRefs,
    ]),
  };
}

function observeWindowActionSession(
  input: ComputerUseObserveInput,
  context: {
    store: WindowActionSessionStore;
    now: () => Date;
    sessions: Map<string, BoundWindowActionPrimitiveSession>;
  },
): ComputerUsePrimitivePortResult<ComputerUseObserveOutput> {
  const binding = context.sessions.get(input.sessionId);
  if (!binding) return blocked('window_action_primitive_session_unbound', []);
  const entry = context.store.getActiveByRef(binding.windowActionSessionRef);
  if (!entry) return blocked('window_action_session_unavailable', [binding.windowActionSessionRef]);
  const observedAt = context.now().toISOString();
  const snapshot = observationSnapshot(entry, input, observedAt);
  if (!snapshot) {
    return blocked('window_action_observation_refs_missing', [
      binding.windowActionSessionRef,
      'runtime-truth:computer-use-primitive/observation-refs-missing',
    ]);
  }
  const observedSession = recordWindowAction(entry.session, {
    action: 'observe',
    status: 'completed',
    timestamp: observedAt,
    evidenceRefs: evidenceRefsFromStrings(snapshot.refs),
  });
  context.store.upsert(observedSession, {
    refs: [snapshot.observationRef],
    observationRefs: snapshot.refs,
    timestamp: observedAt,
  });
  binding.latestObservation = snapshot;
  binding.latestWindowActionSession = observedSession;
  return {
    status: 'completed',
    output: {
      sessionId: input.sessionId,
      observationRef: snapshot.observationRef,
      screenshotRef: snapshot.screenshotRef,
      accessibilityRef: snapshot.accessibilityRef,
      elementRefs: snapshot.elementRefs,
      textRefs: snapshot.textRefs,
      staleInvalidationRefs: [],
    },
    refs: uniqueStrings([snapshot.observationRef, ...snapshot.refs]),
  };
}

async function actWindowActionSession(
  input: ComputerUseActInput,
  context: {
    store: WindowActionSessionStore;
    adapterHandlers: WindowActionAdapterHandlers;
    now: () => Date;
    sessions: Map<string, BoundWindowActionPrimitiveSession>;
    resolveTextRef?: (ref: string) => Promise<string | undefined> | string | undefined;
    terminalWorkflowSelected?: boolean;
    sharedSystemInputMode: NonNullable<WindowActionSessionComputerUsePrimitivePortsOptions['sharedSystemInputMode']>;
    sharedSystemInput: { activeLease?: SharedSystemInputRuntimeLease };
  },
): Promise<ComputerUsePrimitivePortResult<ComputerUseActOutput>> {
  const binding = context.sessions.get(input.sessionId);
  if (!binding) return blocked('window_action_primitive_session_unbound', []);
  const entry = context.store.getActiveByRef(binding.windowActionSessionRef);
  if (!entry) return blocked('window_action_session_unavailable', [binding.windowActionSessionRef]);
  if (!binding.latestObservation) {
    return blocked('window_action_observe_required_before_act', [binding.windowActionSessionRef]);
  }
  const timestamp = context.now().toISOString();
  const explicitActionId = typeof input.actionId === 'string' && input.actionId.trim() ? safeRefPart(input.actionId) : '';
  const actionId = explicitActionId || `computer-use-${safeRefPart(input.sessionId)}-${safeRefPart(input.action.type)}-${safeRefPart(timestamp)}`;
  const dispatchInput = await dispatchInputFromPrimitiveAction(entry.session, input.action, {
    actionId,
    timestamp,
    beforeRefs: binding.latestObservation.refs,
    observeBeforeMutate: observeBeforeMutateEvidence(binding.latestObservation, entry.session, timestamp),
    adapter: binding.adapter,
    resolveTextRef: context.resolveTextRef,
    terminalWorkflowSelected: context.terminalWorkflowSelected,
    sharedSystemInputMode: context.sharedSystemInputMode,
  });
  if (!dispatchInput) return blocked(`unsupported_window_action:${input.action.type}`, [binding.windowActionSessionRef]);

  const sharedSystemInputLease = binding.adapter === 'system-input'
    ? acquireSharedSystemInputLease(context.sharedSystemInput, {
      sessionId: input.sessionId,
      inputAdapterRef: binding.inputAdapterRef,
      actionId,
      timestamp,
      windowActionSessionRef: binding.windowActionSessionRef,
    })
    : undefined;
  if (sharedSystemInputLease?.status === 'blocked') return sharedSystemInputLease.result;

  let dispatched: Awaited<ReturnType<typeof dispatchWindowAction>>;
  try {
    dispatched = await dispatchWindowAction(entry.session, dispatchInput, context.adapterHandlers, {
      agentId: 'computer-use',
      actorCursorRef: binding.cursorRef,
      timestamp,
    });
  } finally {
    if (sharedSystemInputLease?.status === 'acquired') {
      releaseSharedSystemInputLease(context.sharedSystemInput, sharedSystemInputLease.lease);
    }
  }
  if (dispatched.scopedInputAdapter.ref !== binding.inputAdapterRef) {
    return blocked('window_action_input_adapter_scope_mismatch', [
      binding.inputAdapterRef,
      dispatched.scopedInputAdapter.ref,
    ]);
  }
  const persisted = context.store.upsert(dispatched.session, {
    refs: [
      ...refsFromEvidence(dispatched.route.evidenceRefs),
      ...stringList(dispatched.adapterResult.evidenceRefs),
      ...stringList(dispatched.adapterResult.inputEventRefs),
      ...stringList(dispatched.adapterResult.afterEvidenceRefs),
    ],
    observationRefs: stringList(dispatched.adapterResult.afterEvidenceRefs),
    timestamp,
  });
  binding.latestWindowActionSession = persisted.session ?? dispatched.session;
  const status = dispatched.adapterResult.status ?? 'blocked';
  if (status !== 'completed') {
    return blocked(dispatched.adapterResult.blockedReason ?? `window_action_adapter_${status}`, [
      binding.windowActionSessionRef,
      ...refsFromEvidence(dispatched.route.evidenceRefs),
      ...stringList(dispatched.adapterResult.evidenceRefs),
    ]);
  }
  const afterObservationRef = firstString(dispatched.adapterResult.afterEvidenceRefs);
  const inputEventRef = firstString(dispatched.adapterResult.inputEventRefs);
  if (!afterObservationRef || !inputEventRef) {
    return blocked('window_action_adapter_evidence_incomplete', [
      binding.windowActionSessionRef,
      ...stringList(dispatched.adapterResult.evidenceRefs),
      ...stringList(dispatched.adapterResult.afterEvidenceRefs),
      ...stringList(dispatched.adapterResult.inputEventRefs),
    ]);
  }
  const executorEventRef = firstString(dispatched.adapterResult.evidenceRefs)
    ?? `executor-event:window-action-session/${safeRefPart(input.sessionId)}/${safeRefPart(actionId)}`;
  const actionRef = dispatched.session.events.at(-1)?.id
    ?? `window-action-ref:${safeRefPart(input.sessionId)}/${safeRefPart(actionId)}`;
  const invalidatedRefs = uniqueStrings([
    binding.latestObservation.observationRef,
    ...binding.latestObservation.refs,
  ]);
  return {
    status: 'completed',
    output: {
      sessionId: input.sessionId,
      actionRef,
      executorEventRef,
      inputEventRef,
      inputAdapterRef: binding.inputAdapterRef,
      cursorRef: binding.cursorRef,
      scopedInputLeaseRef: binding.scopedInputLeaseRef,
      beforeObservationRef: binding.latestObservation.observationRef,
      afterObservationRef,
      invalidatedRefs,
    },
    refs: uniqueStrings([
      actionRef,
      executorEventRef,
      inputEventRef,
      binding.inputAdapterRef,
      binding.cursorRef,
      binding.scopedInputLeaseRef,
      ...invalidatedRefs,
      afterObservationRef,
      ...refsFromEvidence(dispatched.route.evidenceRefs),
      ...(sharedSystemInputLease?.status === 'acquired' ? [sharedSystemInputLease.lease.ref] : []),
      ...stringList(dispatched.adapterResult.evidenceRefs),
    ]),
  };
}

function controlWindowActionSession(
  input: ComputerUseControlInput,
  context: {
    store: WindowActionSessionStore;
    now: () => Date;
    sessions: Map<string, BoundWindowActionPrimitiveSession>;
  },
): ComputerUsePrimitivePortResult<ComputerUseControlOutput> {
  const binding = context.sessions.get(input.sessionId);
  if (!binding) return blocked('window_action_primitive_session_unbound', []);
  const timestamp = context.now().toISOString();
  const options = { timestamp, refs: [binding.sessionRef] };
  const controlled = input.command === 'pause'
    ? context.store.pause(binding.windowActionSessionRef, options)
    : input.command === 'release'
      ? context.store.remove(binding.windowActionSessionRef, options)
      : input.command === 'stop' || input.command === 'cancel'
        ? context.store.stop(binding.windowActionSessionRef, options)
        : resumeWindowActionSession(binding, context.store, timestamp);
  if (controlled.status !== 'completed') {
    return blocked(controlled.reason ?? `window_action_control_${input.command}_blocked`, [
      binding.windowActionSessionRef,
      ...controlled.refs,
    ]);
  }
  if (input.command === 'release' || input.command === 'stop' || input.command === 'cancel') {
    context.sessions.delete(input.sessionId);
  } else {
    binding.latestWindowActionSession = controlled.session ?? binding.latestWindowActionSession;
  }
  const controlRef = controlled.refs[0] ?? `action-ledger:window-action-session/${safeRefPart(input.sessionId)}/control/${input.command}/${safeRefPart(timestamp)}`;
  return {
    status: 'completed',
    output: {
      sessionId: input.sessionId,
      controlRef,
      releasedRefs: input.command === 'release' || input.command === 'stop' || input.command === 'cancel'
        ? [binding.scopedInputLeaseRef, binding.inputAdapterRef, binding.cursorRef]
        : [],
    },
    refs: uniqueStrings([
      controlRef,
      ...controlled.refs,
      ...(input.command === 'release' || input.command === 'stop' || input.command === 'cancel'
        ? [binding.scopedInputLeaseRef, binding.inputAdapterRef, binding.cursorRef]
        : []),
    ]),
  };
}

function activeEntryFromTarget(input: ComputerUseBindInput, store: WindowActionSessionStore): WindowActionSessionStoreEntry | undefined {
  for (const ref of uniqueStrings([
    input.target.targetRef,
    input.target.windowRef,
    input.target.appRef,
  ])) {
    const entry = store.getActiveByRef(ref);
    if (entry) return entry;
  }
  return undefined;
}

function primaryAdapterForSession(
  session: WindowActionSession,
  handlers: WindowActionAdapterHandlers,
  sharedSystemInputMode: NonNullable<WindowActionSessionComputerUsePrimitivePortsOptions['sharedSystemInputMode']>,
): WindowActionAdapter | undefined {
  if (session.app.kind === 'browser' && handlers['browser-host-session']) return 'browser-host-session';
  if (session.app.kind === 'editor' && handlers['appium-mac2']) return 'appium-mac2';
  if (session.app.kind === 'editor' && handlers['app-native-command']) return 'app-native-command';
  if (session.app.kind === 'terminal' && handlers.terminal) return 'terminal';
  if (session.app.kind === 'file-manager' && handlers['file-manager']) return 'file-manager';
  if (handlers['accessibility-ui-automation']) return 'accessibility-ui-automation';
  if (sharedSystemInputMode !== 'blocked' && handlers['system-input']) return 'system-input';
  const first = (Object.keys(handlers) as WindowActionAdapter[]).find((adapter) => adapter !== 'system-input' && adapter !== 'blocked');
  return first;
}

function observationSnapshot(
  entry: WindowActionSessionStoreEntry,
  input: ComputerUseObserveInput,
  observedAt: string,
): BoundWindowActionPrimitiveSession['latestObservation'] | undefined {
  const refs = uniqueStrings([
    ...entry.observationRefs,
    ...entry.refs.filter((ref) => /(?:screenshot|frame|accessibility|state-snapshot|text|desktop-window)/i.test(ref)),
    entry.session.windowRef,
  ]);
  const screenshotRef = refs.find((ref) => /(?:screenshot|frame|desktop-native:.*screenshot|desktop-annotation:.*screenshot)/i.test(ref));
  const accessibilityRef = refs.find((ref) => /(?:accessibility|state-snapshot|ax)/i.test(ref));
  const elementRefs = refs.filter((ref) => /(?:desktop-window|window-action-session|element|target|window:)/i.test(ref));
  const textRefs = refs.filter((ref) => /(?:text|accessibility|state-snapshot|ax)/i.test(ref));
  if (!screenshotRef || !accessibilityRef || !elementRefs.length || !textRefs.length) return undefined;
  const observationRef = `observation:window-action-session/${safeRefPart(entry.session.id)}/${safeRefPart(observedAt)}`;
  return {
    observationRef,
    screenshotRef,
    accessibilityRef,
    elementRefs: uniqueStrings(elementRefs),
    textRefs: uniqueStrings(textRefs),
    observedAt,
    refs: uniqueStrings([
      observationRef,
      screenshotRef,
      accessibilityRef,
      ...elementRefs,
      ...textRefs,
      ...(input.includeTree ? [`accessibility-ui-automation:${safeRefPart(entry.session.id)}/tree`] : []),
    ]),
  };
}

async function dispatchInputFromPrimitiveAction(
  session: WindowActionSession,
  action: ComputerUseAtomicAction,
  options: {
    actionId: string;
    timestamp: string;
    beforeRefs: string[];
    observeBeforeMutate: WindowActionObserveBeforeMutateEvidence;
    adapter: WindowActionAdapter;
    resolveTextRef?: (ref: string) => Promise<string | undefined> | string | undefined;
    terminalWorkflowSelected?: boolean;
    sharedSystemInputMode?: WindowActionSessionComputerUsePrimitivePortsOptions['sharedSystemInputMode'];
  },
): Promise<WindowActionDispatchInput | undefined> {
  const base = {
    actionId: options.actionId,
    target: {
      app: session.app,
      capabilities: capabilitiesForAdapter(options.adapter, {
        terminalWorkflowSelected: options.terminalWorkflowSelected,
        sharedSystemInputMode: options.sharedSystemInputMode,
      }),
    },
    status: 'running' as const,
    timestamp: options.timestamp,
    beforeEvidenceRefs: evidenceRefsFromStrings(options.beforeRefs),
    observeBeforeMutate: options.observeBeforeMutate,
  };
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      ...base,
      action: 'click' as const,
      ...(action.point ? { point: { x: action.point.x, y: action.point.y } } : {}),
      targetDescription: action.elementRef,
    };
  }
  if (action.type === 'scroll') {
    return {
      ...base,
      action: 'scroll' as const,
      delta: scrollDelta(action.direction, action.amount),
    };
  }
  if (action.type === 'type') {
    if (!action.textRef || !options.resolveTextRef) return undefined;
    const text = await options.resolveTextRef(action.textRef);
    if (!text) return undefined;
    return {
      ...base,
      action: 'type' as const,
      text,
      textLength: text.length,
    };
  }
  if (action.type === 'wait') {
    return {
      ...base,
      action: 'wait' as const,
      durationMs: action.durationMs,
    };
  }
  if (action.type === 'app_command' && action.command === 'save') {
    return {
      ...base,
      action: 'save' as const,
      targetDescription: action.elementRef,
    };
  }
  return undefined;
}

function observeBeforeMutateEvidence(
  observation: NonNullable<BoundWindowActionPrimitiveSession['latestObservation']>,
  session: WindowActionSession,
  timestamp: string,
): WindowActionObserveBeforeMutateEvidence {
  return {
    status: 'current',
    observedAt: observation.observedAt,
    capturedAt: observation.observedAt,
    freshnessCheckedAt: timestamp,
    screenId: session.screenId,
    windowRef: session.windowRef,
    freshnessCheck: {
      status: 'current',
      observedAt: observation.observedAt,
      checkedAt: timestamp,
      maxAgeMs: 30_000,
    },
  };
}

function resumeWindowActionSession(
  binding: BoundWindowActionPrimitiveSession,
  store: WindowActionSessionStore,
  timestamp: string,
) {
  if (!binding.latestWindowActionSession) {
    return {
      status: 'blocked' as const,
      reason: 'window_action_session_resume_state_missing',
      refs: [binding.windowActionSessionRef],
    };
  }
  return store.upsert({
    ...binding.latestWindowActionSession,
    status: 'active',
    updatedAt: timestamp,
  }, {
    refs: [binding.sessionRef, `action-ledger:window-action-session/${safeRefPart(binding.sessionId)}/control/resume/${safeRefPart(timestamp)}`],
    timestamp,
  });
}

function capabilitiesForAdapter(
  adapter: WindowActionAdapter,
  options: {
    terminalWorkflowSelected?: boolean;
    sharedSystemInputMode?: WindowActionSessionComputerUsePrimitivePortsOptions['sharedSystemInputMode'];
  } = {},
): NonNullable<WindowActionDispatchInput['target']['capabilities']> {
  return {
    ...(adapter === 'browser-host-session' ? { browserHostSession: true } : {}),
    ...(adapter === 'browser-cdp-playwright' ? { cdp: true, playwright: true } : {}),
    ...(adapter === 'appium-mac2' ? { appiumMac2: true } : {}),
    ...(adapter === 'app-native-command' ? { appNativeCommand: true } : {}),
    ...(adapter === 'terminal' ? { terminal: true, ...(options.terminalWorkflowSelected ? { terminalWorkflow: true } : {}) } : {}),
    ...(adapter === 'file-manager' ? { fileManager: true } : {}),
    ...(adapter === 'accessibility-ui-automation' ? { accessibility: true, uiAutomation: true } : {}),
    ...(adapter === 'system-input' ? {
      systemInput: true,
      ...(options.sharedSystemInputMode === 'diagnostic' ? { diagnostic: true } : {}),
      ...(options.sharedSystemInputMode === 'explicit-handoff' ? { explicitHandoff: true } : {}),
    } : {}),
  };
}

function acquireSharedSystemInputLease(
  runtime: { activeLease?: SharedSystemInputRuntimeLease },
  input: {
    sessionId: string;
    inputAdapterRef: string;
    actionId: string;
    timestamp: string;
    windowActionSessionRef: string;
  },
): {
  status: 'acquired';
  lease: SharedSystemInputRuntimeLease;
} | {
  status: 'blocked';
  result: ComputerUsePrimitivePortResult<ComputerUseActOutput>;
} {
  if (runtime.activeLease) {
    return {
      status: 'blocked',
      result: blocked('shared_system_input_lease_busy', [
        'shared-system-input:global/focus-input-lease',
        runtime.activeLease.ref,
        runtime.activeLease.inputAdapterRef,
        input.windowActionSessionRef,
      ]),
    };
  }
  const lease = {
    ref: `shared-system-input-lease:computer-use/${safeRefPart(input.sessionId)}/${safeRefPart(input.actionId)}`,
    sessionId: input.sessionId,
    inputAdapterRef: input.inputAdapterRef,
    acquiredAt: input.timestamp,
  };
  runtime.activeLease = lease;
  return { status: 'acquired', lease };
}

function releaseSharedSystemInputLease(
  runtime: { activeLease?: SharedSystemInputRuntimeLease },
  lease: SharedSystemInputRuntimeLease,
) {
  if (runtime.activeLease?.ref === lease.ref) {
    runtime.activeLease = undefined;
  }
}

function scrollDelta(direction: ComputerUseAtomicAction['direction'], amount: number | undefined) {
  const value = Math.max(1, Math.round(amount ?? 300));
  if (direction === 'up') return { y: -value };
  if (direction === 'down') return { y: value };
  if (direction === 'left') return { x: -value };
  return { x: value };
}

function firstObservationRef(entry: WindowActionSessionStoreEntry): string | undefined {
  return entry.observationRefs[0];
}

function scopedInputAdapterRef(session: WindowActionSession, adapter: WindowActionAdapter) {
  return `scoped-input-adapter:${safeRefPart(session.id)}/computer-use/${safeRefPart(adapter)}`;
}

function uniqueSessionId(base: string, sessions: Map<string, unknown>) {
  let candidate = base || 'window-action-session';
  let index = 2;
  while (sessions.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function refsFromEvidence(values: WindowActionEvidenceRef[] | undefined): string[] {
  return values?.map((item) => item.ref).filter(Boolean) ?? [];
}

function evidenceRefsFromStrings(values: string[]): WindowActionEvidenceRef[] {
  return uniqueStrings(values).map((ref) => ({
    kind: evidenceKind(ref),
    ref,
  }));
}

function evidenceKind(ref: string) {
  const prefix = ref.split(':', 1)[0] ?? 'runtime';
  return safeRefPart(prefix) || 'runtime';
}

function firstString(value: unknown): string | undefined {
  return stringList(value)[0];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (isRecord(item) && typeof item.ref === 'string' && item.ref.trim()) return [item.ref.trim()];
      return [];
    });
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function safeRefPart(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const safe = value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96).toLowerCase();
  return safe || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function blocked<T>(blockedReason: string, refs: string[] = []): ComputerUsePrimitivePortResult<T> {
  return {
    status: 'blocked',
    blockedReason,
    refs: uniqueStrings(refs),
    diagnostics: [{
      code: blockedReason,
      message: blockedReason,
      severity: 'error',
      retryable: false,
    }],
  };
}
