import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  computerUseInputPolicyIds,
  computerUsePointerKeyboardOwnershipIds,
  normalizeComputerUseIndependentInputAdapter,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type {
  ComputerUseActionProvenance,
  ComputerUseConfig,
  ComputerUseLeaseScope,
  ComputerUseVisibleEvidenceInvalidation,
  GenericVisionAction,
  WindowBounds,
  WindowTargetResolution,
} from './types.js';
import {
  acquireComputerUseSchedulerLease,
  computerUseSchedulerLockId,
  computerUseStaleEvidenceInvalidationForAction,
  deriveComputerUseActionProvenance,
  schedulerLeaseTrace,
  validateComputerUseScopedAction,
} from './scheduler.js';
import { workspaceRel } from './utils.js';
import {
  applyVirtualRemoteSessionAction,
  collectVirtualRemoteSessionArtifacts,
  collectVirtualRemoteSessionVisibleTexts,
  initialVirtualRemoteSessionState,
  readVirtualRemoteSessionState,
  SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA,
  virtualRemoteSessionPath,
  writeVirtualRemoteSessionState,
  type VirtualRemoteSessionState,
} from './virtual-remote-session.js';

export const SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER = 'sciforge-simulated-remote-desktop';
export const SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA = 'sciforge.computer-use.independent-input-adapter.v1';
export const SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA = 'sciforge.computer-use.actor-cursor-log.v1';
export const SCIFORGE_EXECUTOR_PROJECTION_SCHEMA = 'sciforge.computer-use.executor-projection.v1';

type VirtualPointerState = {
  mode: 'virtual-pointer';
  icon: typeof computerUseInputPolicyIds.visualPointerShape;
  coordinateSpace: string;
  x?: number;
  y?: number;
  executorCoordinateSpace?: 'screen';
  executorX?: number;
  executorY?: number;
  targetDescription?: string;
  targetRegionDescription?: string;
  lastUpdatedAt?: string;
};

type VirtualKeyboardState = {
  mode: 'virtual-keyboard';
  pressedKeys: string[];
  keyEvents: Array<Record<string, unknown>>;
  typedTextLedger: Array<Record<string, unknown>>;
  lastUpdatedAt?: string;
};

type ActorCursorProjection = {
  schemaVersion: 'sciforge.computer-use.actor-cursor-projection.v1';
  actorId: string;
  cursorId: string;
  displayGroupId: string;
  screenId: string;
  windowId?: string;
  label: string;
  color: string;
  coordinateSpace: string;
  x?: number;
  y?: number;
  targetDescription?: string;
  lastEventId: string;
  lastUpdatedAt: string;
};

type ExecutorProjectionState = {
  schemaVersion: typeof SCIFORGE_EXECUTOR_PROJECTION_SCHEMA;
  projectionRef: string;
  eventCount: number;
  lastExecutorEventRef?: string;
  events: Array<Record<string, unknown>>;
  sharedSystemInputUsed: false;
  systemPointerMoved: false;
  systemKeyboardEventsSent: false;
  lastStaleEvidenceInvalidation?: ComputerUseVisibleEvidenceInvalidation;
};

type IndependentInputAdapterState = {
  schemaVersion: typeof SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA;
  adapter: 'remote-desktop';
  provider: typeof SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER;
  runId: string;
  userDeviceImpact: 'none';
  systemMouseEvents: 'not-sent';
  systemKeyboardEvents: 'not-sent';
  pointerKeyboardOwnership: typeof computerUsePointerKeyboardOwnershipIds.independentAdapter;
  targetSession: Record<string, unknown>;
  virtualRemoteSession: {
    schemaVersion: typeof SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA;
    stateRef: string;
    visibleArtifactRefs: string[];
  };
  virtualPointer: VirtualPointerState;
  virtualKeyboard: VirtualKeyboardState;
  actorCursorLog: {
    schemaVersion: typeof SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA;
    logRef: string;
    eventCount: number;
    appendOnly: true;
  };
  actorCursors: ActorCursorProjection[];
  executorProjection: ExecutorProjectionState;
  isolationFlags: {
    sharedSystemInputUsed: false;
    systemPointerMoved: false;
    systemKeyboardEventsSent: false;
    failClosedByDefault: true;
  };
  actions: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export function hasExecutableIndependentInputAdapter(config: ComputerUseConfig) {
  return executableIndependentInputAdapter(config) !== undefined;
}

export function executableIndependentInputAdapter(config: ComputerUseConfig) {
  const adapter = normalizeComputerUseIndependentInputAdapter(config.inputAdapter);
  if (adapter !== 'remote-desktop') return undefined;
  return normalizeIndependentInputAdapterProvider(config.independentInputAdapterProvider) === SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER
    ? adapter
    : undefined;
}

export function independentInputAdapterExecutionBoundary(config: ComputerUseConfig) {
  return hasExecutableIndependentInputAdapter(config)
    ? `${SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER}-input-adapter`
    : undefined;
}

export async function executeIndependentInputAdapterAction(
  action: GenericVisionAction,
  config: ComputerUseConfig,
  targetResolution: WindowTargetResolution,
  options: {
    workspace: string;
    runDir: string;
    stepIndex: number;
    taskText?: string;
  },
) {
  if (!targetResolution.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: targetResolution.reason,
      independentInputAdapter: sharedSystemInputFailClosedDiagnostic(config, 'blocked-unresolved-target'),
    };
  }
  if (!hasExecutableIndependentInputAdapter(config)) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: 'No executable independent input adapter provider is registered for this Computer Use run.',
      independentInputAdapter: sharedSystemInputFailClosedDiagnostic(config, 'blocked-no-independent-adapter'),
    };
  }
  const adapterTargetResolution = projectIndependentInputAdapterTargetResolution(config, action, targetResolution);
  const scopedAction = validateComputerUseScopedAction({
    action,
    targetResolution: adapterTargetResolution,
  });
  if (!scopedAction.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: scopedAction.reason,
      schedulerDecision: scopedAction,
      independentInputAdapter: sharedSystemInputFailClosedDiagnostic(config, 'blocked-scoped-scheduler'),
    };
  }
  const lease = await acquireComputerUseSchedulerLease({
    targetResolution: adapterTargetResolution,
    lockId: computerUseSchedulerLockId(adapterTargetResolution, { sharedSystemInput: false, leaseScope: scopedAction.leaseScope }),
    runId: config.runId,
    stepId: action.type,
    action,
    provenance: scopedAction.provenance,
    leaseScope: scopedAction.leaseScope,
    timeoutMs: config.schedulerLockTimeoutMs,
    staleMs: config.schedulerStaleLockMs,
  });
  if (!lease.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: lease.reason,
      schedulerLease: {
        mode: 'real-gui-executor-lock',
        lockId: lease.lockId,
        lockPath: lease.lockPath,
        waitMs: lease.waitMs,
        status: 'timeout',
        reason: lease.reason,
        leaseScope: scopedAction.leaseScope,
        provenance: scopedAction.provenance,
      },
    };
  }
  const now = new Date().toISOString();
  const statePath = join(options.runDir, 'independent-input-adapter.json');
  const iconPath = join(options.runDir, 'independent-input-pointer.svg');
  const actorCursorLogPath = join(options.runDir, 'actor-cursors.jsonl');
  const executorProjectionPath = join(options.runDir, 'executor-projection.json');
  const sessionPath = virtualRemoteSessionPath(options.runDir);
  const stateRef = workspaceRel(options.workspace, statePath);
  const iconRef = workspaceRel(options.workspace, iconPath);
  const actorCursorLogRef = workspaceRel(options.workspace, actorCursorLogPath);
  const executorProjectionRef = workspaceRel(options.workspace, executorProjectionPath);
  const sessionRef = workspaceRel(options.workspace, sessionPath);
  await writeFile(iconPath, virtualPointerIconSvg(), 'utf8');
  let result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    independentInputAdapter: Record<string, unknown>;
  } | undefined;
  try {
    const session = await readVirtualRemoteSessionState(options.runDir)
      ?? initialVirtualRemoteSessionState({
        config,
        targetResolution: adapterTargetResolution,
        now,
      });
    const state = await readAdapterState(statePath) ?? initialAdapterState({
      config,
      targetResolution: adapterTargetResolution,
      now,
      sessionRef,
      actorCursorLogRef,
      executorProjectionRef,
      session,
    });
    const nextSession = await applyVirtualRemoteSessionAction(options.workspace, options.runDir, session, action, {
      stepIndex: options.stepIndex,
      now,
      taskText: options.taskText,
    });
    const nextState = applyVirtualInputAction(state, action, {
      stepIndex: options.stepIndex,
      now,
      iconRef,
      sessionRef,
      session: nextSession,
      actorCursorLogRef,
      executorProjectionRef,
      provenance: scopedAction.provenance,
      leaseScope: scopedAction.leaseScope,
      schedulerLeaseRef: lease.lease.lockPath,
    });
    const cursorEvent = actorCursorLogEvent(nextState, action, {
      stepIndex: options.stepIndex,
      now,
      provenance: scopedAction.provenance,
      leaseScope: scopedAction.leaseScope,
      executorProjectionRef,
    });
    const executorEvent = executorProjectionEvent(nextState, action, {
      stepIndex: options.stepIndex,
      now,
      provenance: scopedAction.provenance,
      leaseScope: scopedAction.leaseScope,
      executorProjectionRef,
      schedulerLeaseRef: lease.lease.lockPath,
      staleEvidenceInvalidation: scopedAction.staleEvidenceInvalidation
        ?? computerUseStaleEvidenceInvalidationForAction(action, scopedAction.leaseScope),
    });
    const projectedState = applyActorCursorAndExecutorProjection(nextState, cursorEvent, executorEvent, {
      actorCursorLogRef,
      executorProjectionRef,
    });
    await appendFile(actorCursorLogPath, `${JSON.stringify(cursorEvent)}\n`, 'utf8');
    await writeFile(executorProjectionPath, `${JSON.stringify(projectedState.executorProjection, null, 2)}\n`, 'utf8');
    await writeFile(statePath, `${JSON.stringify(projectedState, null, 2)}\n`, 'utf8');
    await writeVirtualRemoteSessionState(options.workspace, options.runDir, nextSession);
    const visibleArtifacts = collectVirtualRemoteSessionArtifacts(nextSession);
    result = {
      exitCode: 0,
      stdout: [
        `independent-input-adapter provider=${SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER}`,
        `adapter=remote-desktop action=${action.type}`,
        `stateRef=${stateRef}`,
        'systemMouseEvents=not-sent systemKeyboardEvents=not-sent',
      ].join(' '),
      stderr: '',
      independentInputAdapter: {
        schemaVersion: SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA,
        adapter: 'remote-desktop',
        provider: SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
        stateRef,
        pointerIconRef: iconRef,
        actorCursorLogRef,
        executorProjectionRef,
        virtualRemoteSessionRef: sessionRef,
        visibleArtifactRefs: visibleArtifacts.map((artifact) => artifact.artifactRef),
        visibleArtifacts,
        visibleTexts: collectVirtualRemoteSessionVisibleTexts(nextSession),
        displayGroupId: scopedAction.provenance.displayGroupId,
        screenId: scopedAction.provenance.screenId,
        windowId: scopedAction.provenance.windowId,
        actorId: scopedAction.provenance.actorId,
        cursorId: scopedAction.provenance.cursorId,
        leaseScope: scopedAction.leaseScope,
        executorEventRef: executorEvent.executorEventRef,
        staleEvidenceInvalidation: executorEvent.staleEvidenceInvalidation,
        pointerKeyboardOwnership: computerUsePointerKeyboardOwnershipIds.independentAdapter,
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        actionCount: projectedState.actions.length,
        actorCursorEventCount: projectedState.actorCursorLog.eventCount,
        executorProjectionEventCount: projectedState.executorProjection.eventCount,
        sharedSystemInputDiagnostic: sharedSystemInputFailClosedDiagnostic(config, 'not-used-independent-adapter'),
      },
    };
  } finally {
    await lease.release();
  }
  if (!result) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: 'Independent input adapter execution failed before producing a result.',
      schedulerLease: schedulerLeaseTrace(lease.lease),
    };
  }
  return {
    ...result,
    schedulerLease: schedulerLeaseTrace(lease.lease),
  };
}

function normalizeIndependentInputAdapterProvider(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized) return undefined;
  if (normalized === SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER || normalized === 'simulated-remote-desktop') {
    return SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER;
  }
  return normalized;
}

function projectIndependentInputAdapterTargetResolution(
  config: ComputerUseConfig,
  action: GenericVisionAction,
  targetResolution: Extract<WindowTargetResolution, { ok: true }>,
): Extract<WindowTargetResolution, { ok: true }> {
  if (targetResolution.captureKind === 'window') return targetResolution;
  if (action.windowId || action.leaseScope) return targetResolution;
  const displayId = targetResolution.displayId ?? config.windowTarget.displayId ?? config.captureDisplays[0] ?? 1;
  const displayGroupId = config.windowTarget.displayGroupId ?? targetResolution.displayGroupId ?? `display-group-${displayId}`;
  const screenId = config.windowTarget.screenId ?? targetResolution.screenId ?? `screen-${displayId}`;
  const virtualWindowId = config.windowTarget.virtualWindowId ?? `virtual-remote-session-window-${displayId}`;
  const bounds = targetResolution.bounds ?? config.windowTarget.bounds ?? { x: 0, y: 0, width: 1280, height: 720 };
  return {
    ...targetResolution,
    target: {
      ...targetResolution.target,
      enabled: true,
      mode: 'app-window',
      displayGroupId,
      screenId,
      virtualWindowId,
      appName: targetResolution.appName ?? config.windowTarget.appName ?? 'Virtual Remote Session',
      title: targetResolution.title ?? config.windowTarget.title ?? 'Simulated Remote Desktop',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    captureKind: 'window',
    displayGroupId,
    screenId,
    virtualWindowId,
    appName: targetResolution.appName ?? config.windowTarget.appName ?? 'Virtual Remote Session',
    title: targetResolution.title ?? config.windowTarget.title ?? 'Simulated Remote Desktop',
    displayId,
    bounds,
    contentRect: targetResolution.contentRect ?? config.windowTarget.contentRect ?? bounds,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: `virtual-remote-session-${displayGroupId}-${screenId}-${virtualWindowId}`,
    diagnostics: [
      ...targetResolution.diagnostics,
      'projected display fallback to package-owned simulated remote desktop window for scoped executor lease',
    ],
  };
}

async function readAdapterState(path: string): Promise<IndependentInputAdapterState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isAdapterState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function initialAdapterState(options: {
  config: ComputerUseConfig;
  targetResolution: Extract<WindowTargetResolution, { ok: true }>;
  now: string;
  sessionRef: string;
  actorCursorLogRef: string;
  executorProjectionRef: string;
  session: VirtualRemoteSessionState;
}): IndependentInputAdapterState {
  const provenance = deriveComputerUseActionProvenance({
    action: { type: 'wait', ms: 0 },
    targetResolution: options.targetResolution,
  });
  return {
    schemaVersion: SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA,
    adapter: 'remote-desktop',
    provider: SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
    runId: options.config.runId ?? 'computer-use',
    userDeviceImpact: 'none',
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    pointerKeyboardOwnership: computerUsePointerKeyboardOwnershipIds.independentAdapter,
    targetSession: {
      mode: options.targetResolution.captureKind,
      source: options.targetResolution.source,
      windowId: options.targetResolution.windowId,
      displayGroupId: provenance.displayGroupId,
      screenId: provenance.screenId,
      virtualWindowId: provenance.windowId,
      appName: options.targetResolution.appName,
      title: options.targetResolution.title,
      coordinateSpace: options.targetResolution.coordinateSpace,
      bounds: options.targetResolution.bounds,
      contentRect: options.targetResolution.contentRect,
      schedulerLockId: options.targetResolution.schedulerLockId,
    },
    virtualRemoteSession: {
      schemaVersion: SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA,
      stateRef: options.sessionRef,
      visibleArtifactRefs: options.session.visibleArtifacts.map((artifact) => artifact.artifactRef),
    },
    virtualPointer: {
      mode: 'virtual-pointer',
      icon: computerUseInputPolicyIds.visualPointerShape,
      coordinateSpace: options.targetResolution.coordinateSpace,
      lastUpdatedAt: options.now,
    },
    virtualKeyboard: {
      mode: 'virtual-keyboard',
      pressedKeys: [],
      keyEvents: [],
      typedTextLedger: [],
      lastUpdatedAt: options.now,
    },
    actorCursorLog: {
      schemaVersion: SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA,
      logRef: options.actorCursorLogRef,
      eventCount: 0,
      appendOnly: true,
    },
    actorCursors: [{
      schemaVersion: 'sciforge.computer-use.actor-cursor-projection.v1',
      actorId: provenance.actorId,
      cursorId: provenance.cursorId,
      displayGroupId: provenance.displayGroupId,
      screenId: provenance.screenId,
      windowId: provenance.windowId,
      label: provenance.actorId,
      color: '#00d5ff',
      coordinateSpace: options.targetResolution.coordinateSpace,
      lastEventId: 'initial-presence',
      lastUpdatedAt: options.now,
    }],
    executorProjection: {
      schemaVersion: SCIFORGE_EXECUTOR_PROJECTION_SCHEMA,
      projectionRef: options.executorProjectionRef,
      eventCount: 0,
      events: [],
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
    isolationFlags: {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      failClosedByDefault: true,
    },
    actions: [],
    createdAt: options.now,
    updatedAt: options.now,
  };
}

function applyVirtualInputAction(
  state: IndependentInputAdapterState,
  action: GenericVisionAction,
  options: {
    stepIndex: number;
    now: string;
    iconRef: string;
    sessionRef: string;
    session: VirtualRemoteSessionState;
    actorCursorLogRef: string;
    executorProjectionRef: string;
    provenance: ComputerUseActionProvenance;
    leaseScope: ComputerUseLeaseScope;
    schedulerLeaseRef: string;
  },
): IndependentInputAdapterState {
  const record: Record<string, unknown> = {
    id: `step-${String(options.stepIndex).padStart(3, '0')}-${action.type}`,
    type: action.type,
    timestamp: options.now,
    displayGroupId: options.provenance.displayGroupId,
    screenId: options.provenance.screenId,
    windowId: options.provenance.windowId,
    actorId: options.provenance.actorId,
    cursorId: options.provenance.cursorId,
    leaseScope: options.leaseScope,
    schedulerLeaseRef: options.schedulerLeaseRef,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
  const virtualPointer = { ...state.virtualPointer, lastUpdatedAt: options.now };
  const virtualKeyboard = {
    ...state.virtualKeyboard,
    keyEvents: [...state.virtualKeyboard.keyEvents],
    typedTextLedger: [...state.virtualKeyboard.typedTextLedger],
    lastUpdatedAt: options.now,
  };
  if (action.type === 'click' || action.type === 'double_click') {
    Object.assign(virtualPointer, virtualPointerCoordinates(state, action.x, action.y));
    virtualPointer.targetDescription = action.targetDescription;
    virtualPointer.targetRegionDescription = action.targetRegionDescription;
    record.clickCount = action.type === 'double_click' ? 2 : 1;
    record.pointer = pointerRecord(virtualPointer, options.iconRef);
  } else if (action.type === 'drag') {
    Object.assign(virtualPointer, virtualPointerCoordinates(state, action.toX, action.toY));
    virtualPointer.targetDescription = action.toTargetDescription ?? action.targetDescription;
    virtualPointer.targetRegionDescription = action.targetRegionDescription;
    record.fromTargetDescription = action.fromTargetDescription;
    record.toTargetDescription = action.toTargetDescription;
    record.pointer = pointerRecord(virtualPointer, options.iconRef);
  } else if (action.type === 'scroll') {
    record.direction = action.direction;
    record.amount = action.amount;
    record.pointer = pointerRecord(virtualPointer, options.iconRef);
  } else if (action.type === 'type_text') {
    virtualKeyboard.typedTextLedger.push({ timestamp: options.now, text: action.text });
    record.textLength = action.text.length;
  } else if (action.type === 'press_key') {
    virtualKeyboard.keyEvents.push({ timestamp: options.now, key: action.key, phase: 'press-release' });
    record.key = action.key;
  } else if (action.type === 'hotkey') {
    virtualKeyboard.keyEvents.push({ timestamp: options.now, keys: action.keys, phase: 'chord-press-release' });
    record.keys = action.keys;
  } else if (action.type === 'open_app') {
    record.appName = action.appName;
    state.targetSession = { ...state.targetSession, activeAppName: action.appName, updatedAt: options.now };
  } else if (action.type === 'wait') {
    record.ms = action.ms;
  }
  return {
    ...state,
    virtualRemoteSession: {
      schemaVersion: SCIFORGE_VIRTUAL_REMOTE_SESSION_SCHEMA,
      stateRef: options.sessionRef,
      visibleArtifactRefs: options.session.visibleArtifacts.map((artifact) => artifact.artifactRef),
    },
    virtualPointer,
    virtualKeyboard,
    actorCursorLog: state.actorCursorLog ?? {
      schemaVersion: SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA,
      logRef: options.actorCursorLogRef,
      eventCount: 0,
      appendOnly: true,
    },
    actorCursors: Array.isArray(state.actorCursors) ? state.actorCursors : [],
    executorProjection: state.executorProjection ?? {
      schemaVersion: SCIFORGE_EXECUTOR_PROJECTION_SCHEMA,
      projectionRef: options.executorProjectionRef,
      eventCount: 0,
      events: [],
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
    isolationFlags: state.isolationFlags ?? {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      failClosedByDefault: true,
    },
    actions: [...state.actions, record],
    updatedAt: options.now,
  };
}

function actorCursorLogEvent(
  state: IndependentInputAdapterState,
  action: GenericVisionAction,
  options: {
    stepIndex: number;
    now: string;
    provenance: ComputerUseActionProvenance;
    leaseScope: ComputerUseLeaseScope;
    executorProjectionRef: string;
  },
) {
  const actionRecord = state.actions[state.actions.length - 1] ?? {};
  const pointer = isRecord(actionRecord.pointer) ? actionRecord.pointer : undefined;
  return {
    schemaVersion: SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA,
    id: `cursor-event-${String(options.stepIndex).padStart(3, '0')}-${action.type}`,
    eventType: 'intent-proposal',
    actionType: action.type,
    timestamp: options.now,
    displayGroupId: options.provenance.displayGroupId,
    screenId: options.provenance.screenId,
    windowId: options.provenance.windowId,
    actorId: options.provenance.actorId,
    cursorId: options.provenance.cursorId,
    leaseScope: options.leaseScope,
    pointer,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    executorProjectionRef: options.executorProjectionRef,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    appendOnly: true,
  };
}

function executorProjectionEvent(
  state: IndependentInputAdapterState,
  action: GenericVisionAction,
  options: {
    stepIndex: number;
    now: string;
    provenance: ComputerUseActionProvenance;
    leaseScope: ComputerUseLeaseScope;
    executorProjectionRef: string;
    schedulerLeaseRef: string;
    staleEvidenceInvalidation?: ComputerUseVisibleEvidenceInvalidation;
  },
) {
  const actionRecord = state.actions[state.actions.length - 1] ?? {};
  const executorEventRef = `executor-projection:${String(options.stepIndex).padStart(3, '0')}:${action.type}`;
  return {
    schemaVersion: 'sciforge.computer-use.executor-projection-event.v1',
    id: `executor-event-${String(options.stepIndex).padStart(3, '0')}-${action.type}`,
    executorEventRef,
    projectionRef: options.executorProjectionRef,
    timestamp: options.now,
    actionId: actionRecord.id,
    actionType: action.type,
    status: 'projected-to-isolated-adapter',
    displayGroupId: options.provenance.displayGroupId,
    screenId: options.provenance.screenId,
    windowId: options.provenance.windowId,
    actorId: options.provenance.actorId,
    cursorId: options.provenance.cursorId,
    leaseScope: options.leaseScope,
    schedulerLeaseRef: options.schedulerLeaseRef,
    pointer: isRecord(actionRecord.pointer) ? actionRecord.pointer : undefined,
    keyboard: keyboardProjectionForAction(action),
    staleEvidenceInvalidation: options.staleEvidenceInvalidation,
    executor: SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
}

function applyActorCursorAndExecutorProjection(
  state: IndependentInputAdapterState,
  cursorEvent: Record<string, unknown>,
  executorEvent: Record<string, unknown>,
  refs: {
    actorCursorLogRef: string;
    executorProjectionRef: string;
  },
): IndependentInputAdapterState {
  const actorId = stringField(cursorEvent.actorId) ?? 'actor-agent';
  const cursorId = stringField(cursorEvent.cursorId) ?? `${actorId}-cursor`;
  const existingCursors = Array.isArray(state.actorCursors) ? state.actorCursors : [];
  const actorCursors = upsertActorCursorProjection(existingCursors, cursorEvent);
  const priorProjection = state.executorProjection ?? {
    schemaVersion: SCIFORGE_EXECUTOR_PROJECTION_SCHEMA,
    projectionRef: refs.executorProjectionRef,
    eventCount: 0,
    events: [],
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
  const events = [...priorProjection.events, executorEvent];
  return {
    ...state,
    actorCursorLog: {
      schemaVersion: SCIFORGE_ACTOR_CURSOR_LOG_SCHEMA,
      logRef: refs.actorCursorLogRef,
      eventCount: (state.actorCursorLog?.eventCount ?? 0) + 1,
      appendOnly: true,
    },
    actorCursors,
    executorProjection: {
      schemaVersion: SCIFORGE_EXECUTOR_PROJECTION_SCHEMA,
      projectionRef: refs.executorProjectionRef,
      eventCount: events.length,
      lastExecutorEventRef: stringField(executorEvent.executorEventRef),
      events,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      lastStaleEvidenceInvalidation: isVisibleEvidenceInvalidation(executorEvent.staleEvidenceInvalidation)
        ? executorEvent.staleEvidenceInvalidation
        : undefined,
    },
    isolationFlags: {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      failClosedByDefault: true,
    },
    actions: state.actions.map((record, index, all) => index === all.length - 1
      ? {
          ...record,
          actorCursorEventRef: stringField(cursorEvent.id),
          executorEventRef: stringField(executorEvent.executorEventRef),
          actorId,
          cursorId,
          sharedSystemInputUsed: false,
          systemPointerMoved: false,
          systemKeyboardEventsSent: false,
        }
      : record),
  };
}

function upsertActorCursorProjection(
  existingCursors: ActorCursorProjection[],
  cursorEvent: Record<string, unknown>,
): ActorCursorProjection[] {
  const actorId = stringField(cursorEvent.actorId) ?? 'actor-agent';
  const cursorId = stringField(cursorEvent.cursorId) ?? `${actorId}-cursor`;
  const pointer = isRecord(cursorEvent.pointer) ? cursorEvent.pointer : {};
  const next: ActorCursorProjection = {
    schemaVersion: 'sciforge.computer-use.actor-cursor-projection.v1',
    actorId,
    cursorId,
    displayGroupId: stringField(cursorEvent.displayGroupId) ?? 'display-group-default',
    screenId: stringField(cursorEvent.screenId) ?? 'screen-default',
    windowId: stringField(cursorEvent.windowId),
    label: actorId,
    color: '#00d5ff',
    coordinateSpace: stringField(pointer.coordinateSpace) ?? 'window-local',
    x: numberField(pointer.x),
    y: numberField(pointer.y),
    targetDescription: stringField(cursorEvent.targetDescription),
    lastEventId: stringField(cursorEvent.id) ?? 'unknown-event',
    lastUpdatedAt: stringField(cursorEvent.timestamp) ?? new Date().toISOString(),
  };
  const found = existingCursors.findIndex((cursor) => cursor.actorId === actorId && cursor.cursorId === cursorId);
  if (found < 0) return [...existingCursors, next];
  return existingCursors.map((cursor, index) => index === found ? next : cursor);
}

function keyboardProjectionForAction(action: GenericVisionAction) {
  if (action.type === 'type_text') return { mode: 'type_text', textLength: action.text.length };
  if (action.type === 'press_key') return { mode: 'press_key', key: action.key };
  if (action.type === 'hotkey') return { mode: 'hotkey', keys: action.keys };
  return undefined;
}

function sharedSystemInputFailClosedDiagnostic(config: ComputerUseConfig, status: string) {
  return {
    schemaVersion: SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA,
    adapter: normalizeComputerUseIndependentInputAdapter(config.inputAdapter) ?? 'not-configured',
    provider: normalizeIndependentInputAdapterProvider(config.independentInputAdapterProvider) ?? 'not-registered',
    status,
    failClosedByDefault: true,
    requestedSharedSystemInput: Boolean(config.allowSharedSystemInput),
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    userDeviceImpact: 'none',
    diagnosticOnly: true,
  };
}

function virtualPointerCoordinates(
  state: IndependentInputAdapterState,
  executorX: number | undefined,
  executorY: number | undefined,
): Partial<VirtualPointerState> {
  if (typeof executorX !== 'number' || typeof executorY !== 'number') return {};
  const coordinateSpace = stringField(state.targetSession.coordinateSpace) ?? state.virtualPointer.coordinateSpace;
  const bounds = windowBoundsAt(state.targetSession, 'contentRect') ?? windowBoundsAt(state.targetSession, 'bounds');
  if (isWindowBoundCoordinateSpace(coordinateSpace) && bounds) {
    return {
      coordinateSpace,
      x: executorX - bounds.x,
      y: executorY - bounds.y,
      executorCoordinateSpace: 'screen',
      executorX,
      executorY,
    };
  }
  return {
    coordinateSpace,
    x: executorX,
    y: executorY,
  };
}

function pointerRecord(pointer: VirtualPointerState, iconRef: string) {
  return {
    mode: pointer.mode,
    icon: pointer.icon,
    iconRef,
    coordinateSpace: pointer.coordinateSpace,
    x: pointer.x,
    y: pointer.y,
    executorCoordinateSpace: pointer.executorCoordinateSpace,
    executorX: pointer.executorX,
    executorY: pointer.executorY,
    targetDescription: pointer.targetDescription,
  };
}

function isAdapterState(value: unknown): value is IndependentInputAdapterState {
  return typeof value === 'object'
    && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion === SCIFORGE_INDEPENDENT_INPUT_ADAPTER_SCHEMA;
}

function isWindowBoundCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
}

function windowBoundsAt(value: Record<string, unknown>, key: string): WindowBounds | undefined {
  const child = value[key];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return undefined;
  const record = child as Record<string, unknown>;
  const x = numberField(record.x);
  const y = numberField(record.y);
  const width = numberField(record.width);
  const height = numberField(record.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVisibleEvidenceInvalidation(value: unknown): value is ComputerUseVisibleEvidenceInvalidation {
  return isRecord(value)
    && value.invalidatesVisibleState === true
    && isRecord(value.scope)
    && typeof value.staleBy === 'string';
}

function virtualPointerIconSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="SciForge virtual input pointer">',
    '<path d="M6 3 L25 16 L16 18 L12 28 L6 3 Z" fill="#00d5ff" stroke="#ff4bd8" stroke-width="2" stroke-linejoin="round"/>',
    '<path d="M16 6 V26 M6 16 H26" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>',
    '</svg>',
    '',
  ].join('\n');
}
