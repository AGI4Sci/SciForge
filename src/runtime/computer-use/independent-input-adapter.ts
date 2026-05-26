import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  computerUseInputPolicyIds,
  computerUsePointerKeyboardOwnershipIds,
  normalizeComputerUseIndependentInputAdapter,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type { ComputerUseConfig, GenericVisionAction, WindowBounds, WindowTargetResolution } from './types.js';
import { acquireComputerUseSchedulerLease, computerUseSchedulerLockId, schedulerLeaseTrace } from './scheduler.js';
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
    };
  }
  if (!hasExecutableIndependentInputAdapter(config)) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: 'No executable independent input adapter provider is registered for this Computer Use run.',
    };
  }
  const lease = await acquireComputerUseSchedulerLease({
    targetResolution,
    lockId: computerUseSchedulerLockId(targetResolution, { sharedSystemInput: false }),
    runId: config.runId,
    stepId: action.type,
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
      },
    };
  }
  const now = new Date().toISOString();
  const statePath = join(options.runDir, 'independent-input-adapter.json');
  const iconPath = join(options.runDir, 'independent-input-pointer.svg');
  const sessionPath = virtualRemoteSessionPath(options.runDir);
  const stateRef = workspaceRel(options.workspace, statePath);
  const iconRef = workspaceRel(options.workspace, iconPath);
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
        targetResolution,
        now,
      });
    const state = await readAdapterState(statePath) ?? initialAdapterState({
      config,
      targetResolution,
      now,
      sessionRef,
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
    });
    await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
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
        virtualRemoteSessionRef: sessionRef,
        visibleArtifactRefs: visibleArtifacts.map((artifact) => artifact.artifactRef),
        visibleArtifacts,
        visibleTexts: collectVirtualRemoteSessionVisibleTexts(nextSession),
        pointerKeyboardOwnership: computerUsePointerKeyboardOwnershipIds.independentAdapter,
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
        actionCount: nextState.actions.length,
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
  session: VirtualRemoteSessionState;
}): IndependentInputAdapterState {
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
  },
): IndependentInputAdapterState {
  const record: Record<string, unknown> = {
    id: `step-${String(options.stepIndex).padStart(3, '0')}-${action.type}`,
    type: action.type,
    timestamp: options.now,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
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
    actions: [...state.actions, record],
    updatedAt: options.now,
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

function virtualPointerIconSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="SciForge virtual input pointer">',
    '<path d="M6 3 L25 16 L16 18 L12 28 L6 3 Z" fill="#00d5ff" stroke="#ff4bd8" stroke-width="2" stroke-linejoin="round"/>',
    '<path d="M16 6 V26 M6 16 H26" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>',
    '</svg>',
    '',
  ].join('\n');
}
