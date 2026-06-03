import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  buildVirtualDisplayFrameTransportContract,
  buildVirtualDisplaySurfaceTransportDescriptor,
  probeVirtualDisplayProviders,
  summarizeVirtualDisplayFrameTelemetry,
  virtualDisplayReadinessToAdapterReadiness,
  type VirtualDisplayFrameTelemetrySample,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayReadiness,
} from '../virtual-display-provider.js';
import { sanitizeId } from '../utils.js';
import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  type MacosVirtualDisplayOperationEvidence,
  type MacosVirtualDisplayProviderHooks,
} from './macos-virtual-display-provider.js';
import {
  missingNativeDriverInputControlRefs,
  nativeDriverInputControlIsolationIssues,
  nativeDriverInputControlRefScopeIssues,
  nativeDriverInputControlSafeFailureDetail,
  nativeDriverInputIntentProjection,
  type NativeVirtualDisplayDriverInputControlContext,
  type NativeVirtualDisplayDriverInputControlHook,
  type NativeVirtualDisplayDriverInputControlOperation,
} from './native-driver-input-control.js';
import {
  captureMacosDisplayFrame,
  commandExists,
  defaultLaunchMacosTargetApp,
  findMacosTargetProcessIds,
  inventoryMacosAxWindows,
  listMacosDisplays,
  macosEditableWindowReadinessEvidence,
  moveMacosAxWindow,
  probeMacosAccessibility,
  probeMacosScreenRecording,
  selectMacosAxWindowForCgWindow,
  shortError,
  sleep,
  waitForMacosCgWindow,
  windowWithinDisplay,
  writeJsonRef,
  type MacosAxWindowInventoryEntry,
  type MacosAxWindowMoveResult,
  type MacosCgWindowInventoryEntry,
  type MacosDisplayFrameCapture,
  type MacosDisplayInventoryEntry,
  type MacosEditableWindowReadinessEvidence,
  type MacosEditableWindowReadinessSpec,
} from './macos-native-driver-helpers.js';

export interface MacosVirtualDisplayDriverTargetAppSpec {
  kind?: string;
  name?: string;
  bundleId?: string;
  appPath?: string;
  command?: string;
  args?: string[];
  processMatch?: string;
  windowTitlePattern?: string;
  editableWindowReadiness?: MacosEditableWindowReadinessSpec;
}

export interface MacosVirtualDisplayDriverDisplayHandle {
  displayId?: string | number;
  displayIndex?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  name?: string;
  destroy?: () => void | Promise<void>;
  raw?: unknown;
}

export interface MacosVirtualDisplayDriverLaunchResult {
  pids: number[];
  targetAppRef?: string;
  launchRef?: string;
  details?: Record<string, unknown>;
}

export interface MacosVirtualDisplayDriverInputAdapterCapability {
  ok: boolean;
  mechanism?: string;
  detail?: string;
  refs?: Record<string, string | string[] | undefined>;
}

export interface MacosVirtualDisplayDriverTargetWindow {
  cgWindow: MacosCgWindowInventoryEntry;
  axWindow?: MacosAxWindowInventoryEntry;
}

export interface MacosVirtualDisplayDriverDependencies {
  loadVirtualDisplayPackage?: () => unknown | Promise<unknown>;
  createVirtualDisplay?: (input: {
    packageModule: unknown;
    width: number;
    height: number;
    displayName: string;
  }) => MacosVirtualDisplayDriverDisplayHandle | Promise<MacosVirtualDisplayDriverDisplayHandle>;
  commandExists?: (command: string, options: VirtualDisplayProviderOperationOptions['probeOptions']) => boolean | Promise<boolean>;
  probeScreenRecording?: () => boolean | { ok: boolean; detail?: string } | Promise<boolean | { ok: boolean; detail?: string }>;
  probeAccessibility?: () => boolean | { ok: boolean; detail?: string } | Promise<boolean | { ok: boolean; detail?: string }>;
  listDisplays?: () => MacosDisplayInventoryEntry[] | Promise<MacosDisplayInventoryEntry[]>;
  launchApp?: (
    spec: MacosVirtualDisplayDriverTargetAppSpec,
    options: VirtualDisplayProviderOperationOptions,
  ) => MacosVirtualDisplayDriverLaunchResult | Promise<MacosVirtualDisplayDriverLaunchResult>;
  waitForTargetWindow?: (input: {
    pids: number[];
    spec: MacosVirtualDisplayDriverTargetAppSpec;
    timeoutMs: number;
  }) => MacosVirtualDisplayDriverTargetWindow | undefined | Promise<MacosVirtualDisplayDriverTargetWindow | undefined>;
  moveWindow?: (input: {
    window: MacosAxWindowInventoryEntry;
    display: MacosDisplayInventoryEntry;
  }) => MacosAxWindowMoveResult | Promise<MacosAxWindowMoveResult>;
  captureDisplayFrame?: (input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    display: MacosDisplayInventoryEntry;
    providerId: string;
  }) => MacosDisplayFrameCapture | Promise<MacosDisplayFrameCapture>;
  probeInputAdapterCapability?: (
    context: NativeVirtualDisplayDriverInputControlContext,
  ) => MacosVirtualDisplayDriverInputAdapterCapability | Promise<MacosVirtualDisplayDriverInputAdapterCapability>;
  sendInputIntent?: NativeVirtualDisplayDriverInputControlHook;
  pauseAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  resumeAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  safeStopSession?: NativeVirtualDisplayDriverInputControlHook;
  writeJsonRef?: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MacosVirtualDisplayDriverOptions {
  providerId?: string;
  targetApp?: MacosVirtualDisplayDriverTargetAppSpec;
  display?: {
    width?: number;
    height?: number;
    name?: string;
  };
  outDir?: string;
  windowTimeoutMs?: number;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
  dependencies?: MacosVirtualDisplayDriverDependencies;
}

interface MacosVirtualDisplayDriverState {
  packageModule?: unknown;
  displayHandle?: MacosVirtualDisplayDriverDisplayHandle;
  display?: MacosDisplayInventoryEntry;
  launch?: MacosVirtualDisplayDriverLaunchResult;
  targetWindow?: MacosVirtualDisplayDriverTargetWindow;
  refs?: DriverRefs;
  frameSequence: number;
}

type MacosVirtualDisplayProviderRunResult = {
  refs: Record<string, string | string[] | undefined>;
  readiness?: VirtualDisplayReadiness;
  blockedReason?: string;
  mutatingActionExecuted?: boolean;
  providerEvidenceWritten?: boolean;
};

interface DriverRefs extends Record<string, string | string[] | undefined> {
  currentRunRef: string;
  providerRootRef: string;
  adapterReadinessRef: string;
  providerProbeRef: string;
  sessionRef: string;
  sessionLeaseRef: string;
  displayGroupRef: string;
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  displayRef: string;
  liveSurfaceRef: string;
  surfaceTransportRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  currentScreenshotRef: string;
  frameTransportContractRef: string;
  frameTelemetryRef: string;
  mediaChannelRef: string;
  dataChannelRef: string;
  inputLeaseRef: string;
  actionAdapterRef: string;
  inputHotPathRef: string;
  lifecycleLedgerRef: string;
  evidenceLedgerRef: string;
  blockedRef: string;
}

const requireFromHere = createRequire(import.meta.url);

export function createMacosVirtualDisplayDriverHooks(
  options: MacosVirtualDisplayDriverOptions = {},
): MacosVirtualDisplayProviderHooks {
  const providerId = options.providerId ?? MACOS_VIRTUAL_DISPLAY_PROVIDER_ID;
  const deps = options.dependencies ?? {};
  const state: MacosVirtualDisplayDriverState = { frameSequence: 0 };
  return {
    probe: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'probe', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const probe = await probeDriverReadiness(effectiveOptions, providerId, deps);
      state.packageModule = probe.packageModule;
      const refs = probeRefsFor(effectiveOptions, providerId);
      const adapterReadinessRef = requiredDriverRef(refs.adapterReadinessRef, 'adapterReadinessRef');
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), adapterReadinessRef, {
        schemaVersion: 'sciforge.virtual-display.macos.adapter-readiness.v1',
        providerId,
        readiness: probe.readiness,
        blockedReason: probe.blockedReason,
        currentRunOnly: true,
      });
      return {
        refs,
        readiness: probe.readiness,
        blockedReason: probe.blockedReason,
      };
    }),
    createSession: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'createSession', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const probe = await probeDriverReadiness(effectiveOptions, providerId, deps);
      state.packageModule = probe.packageModule;
      if (probe.blockedReason) return blockedEvidence(effectiveOptions, providerId, probe.readiness, probe.blockedReason);
      const refs = refsFor(effectiveOptions, providerId);
      state.refs = refs;
      const displayHandle = await createDisplayHandle(probe.packageModule, options, deps);
      state.displayHandle = displayHandle;
      const displays = await listDriverDisplays(deps);
      state.display = selectDisplayForHandle(displayHandle, displays);
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.sessionRef, {
        schemaVersion: 'sciforge.virtual-display.macos.session.v1',
        providerId,
        sessionRef: refs.sessionRef,
        displayRef: refs.displayRef,
        displayGroupRef: refs.displayGroupRef,
        screenRef: refs.screenRef,
        targetAppRef: refs.targetAppRef,
        displayHandle: displayHandleEvidence(displayHandle),
        displayIdentity: state.display,
        currentRunOnly: true,
      });
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.displayRef, {
        schemaVersion: 'sciforge.virtual-display.macos.display.v1',
        providerId,
        displayRef: refs.displayRef,
        displayHandle: displayHandleEvidence(displayHandle),
        displayIdentity: state.display,
        currentRunOnly: true,
      });
      return {
        refs: {
          ...refs,
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#createSession`,
        },
        readiness: readinessWithRuntimeIdentity(probe.readiness, state),
      };
    }),
    launchApp: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'launchApp', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const refs = state.refs ?? refsFor(effectiveOptions, providerId);
      const readiness = readyReadinessFor(effectiveOptions, providerId);
      if (!state.display) return blockedEvidence(operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider launchApp requires a created virtual display session.');
      const spec = targetAppSpecFor(effectiveOptions, options);
      if (!hasLaunchSpec(spec)) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider launchApp requires an explicit generic target app launch spec.');
      }
      let launch: MacosVirtualDisplayDriverLaunchResult;
      let targetWindow: MacosVirtualDisplayDriverTargetWindow;
      let editableWindowReadiness: MacosEditableWindowReadinessEvidence;
      try {
        launch = await launchDriverApp(spec, effectiveOptions, deps);
        state.launch = launch;
        if (!launch.pids.length && !hasDiscoverySpec(spec)) {
          return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider launchApp did not materialize a target process id.');
        }
        const discoveredWindow = await waitForDriverWindow({
          pids: launch.pids,
          spec,
          timeoutMs: options.windowTimeoutMs ?? 15000,
        }, deps);
        if (!discoveredWindow) {
          return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider launchApp could not find a target app window.');
        }
        targetWindow = discoveredWindow;
        state.targetWindow = targetWindow;
        editableWindowReadiness = editableWindowReadinessEvidenceFor(spec, targetWindow);
      } catch (error) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, `macOS VirtualDisplayProvider launchApp failed: ${shortError(error)}.`);
      }
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.targetWindowRef, {
        schemaVersion: 'sciforge.virtual-display.macos.target-window.v1',
        providerId,
        targetWindowRef: refs.targetWindowRef,
        targetAppRef: refs.targetAppRef,
        pids: launch.pids,
        cgWindow: targetWindow.cgWindow,
        axWindow: targetWindow.axWindow,
        editableWindowReadiness,
        launchDetails: launch.details,
        currentRunOnly: true,
      });
      if (editableWindowReadiness.required && !editableWindowReadiness.accepted) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, editableWindowReadinessBlockedReason());
      }
      return {
        refs: {
          ...refs,
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#launchApp`,
        },
        readiness: readinessWithRuntimeIdentity(readiness, state),
      };
    }),
    attachSurface: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'attachSurface', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const refs = state.refs ?? refsFor(effectiveOptions, providerId);
      const readiness = readinessWithRuntimeIdentity(readyReadinessFor(effectiveOptions, providerId), state);
      if (!state.display || !state.targetWindow) {
        return blockedEvidence(operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider attachSurface requires a display and target window.');
      }
      if (!state.targetWindow.axWindow) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider attachSurface requires Accessibility window identity for isolated window placement.');
      }
      const moveResult = await moveDriverWindow(state.targetWindow.axWindow, state.display, deps);
      if (!moveResult.ok) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, `macOS VirtualDisplayProvider attachSurface could not move the target window: ${moveResult.stdout}.`);
      }
      const positionedWindow = {
        ...state.targetWindow.cgWindow,
        ...moveResult.targetBounds,
      };
      if (!windowWithinDisplay(positionedWindow, state.display)) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider attachSurface could not prove the target window is inside the virtual display.');
      }
      state.targetWindow = {
        ...state.targetWindow,
        cgWindow: positionedWindow,
        axWindow: state.targetWindow.axWindow
          ? {
            ...state.targetWindow.axWindow,
            ...moveResult.targetBounds,
          }
          : undefined,
      };
      const transportRecords = transportRecordsFor(refs, providerId, readiness, state.frameSequence);
      await writeTransportRecords(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs, transportRecords, readiness);
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.liveSurfaceRef, {
        schemaVersion: 'sciforge.virtual-display.macos.live-surface.v1',
        providerId,
        liveSurfaceRef: refs.liveSurfaceRef,
        frameStreamRef: refs.frameStreamRef,
        surfaceTransportRef: refs.surfaceTransportRef,
        targetWindowRef: refs.targetWindowRef,
        displayRef: refs.displayRef,
        displayIdentity: state.display,
        windowBounds: moveResult.targetBounds,
        currentRunOnly: true,
      });
      return {
        refs: {
          ...refs,
          currentFrameRef: undefined,
          currentScreenshotRef: undefined,
          currentFrameSequence: String(state.frameSequence),
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#attachSurface`,
        },
        readiness,
      };
    }),
    readFrame: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'readFrame', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const refs = state.refs ?? refsFor(effectiveOptions, providerId);
      const currentRunDirRef = runDirRefForRefs(refs, effectiveOptions);
      const currentOutDir = outDirForRunDir(options, currentRunDirRef);
      const readiness = readinessWithRuntimeIdentity(readyReadinessFor(effectiveOptions, providerId), state);
      if (!state.display) {
        return blockedEvidence(operationOptions, providerId, readiness, 'macOS VirtualDisplayProvider readFrame requires a created virtual display.');
      }
      let capture: MacosDisplayFrameCapture;
      try {
        capture = await captureDriverFrame({
          outDir: currentOutDir,
          runDirRef: currentRunDirRef,
          phase: 'current',
          display: state.display,
          providerId,
        }, deps);
      } catch (error) {
        return cleanupAndBlockAfterCreatedDisplay(state, operationOptions, providerId, readiness, `macOS VirtualDisplayProvider readFrame capture failed: ${shortError(error)}.`);
      }
      state.frameSequence += 1;
      const frameRecord = {
        ...capture.frameRecord,
        frameRef: capture.frameRef,
        screenshotRef: capture.screenshotRef,
        currentFrameSequence: state.frameSequence,
      };
      await writeDriverJson(deps, currentOutDir, currentRunDirRef, capture.frameRef, frameRecord);
      const transportRefs = {
        ...refs,
        currentFrameRef: capture.frameRef,
        currentScreenshotRef: capture.screenshotRef,
      };
      const transportRecords = transportRecordsFor(transportRefs, providerId, readiness, state.frameSequence);
      await writeTransportRecords(deps, currentOutDir, currentRunDirRef, transportRefs, transportRecords, readiness);
      return {
        refs: {
          ...transportRefs,
          beforeFrameRef: capture.frameRef,
          afterFrameRef: capture.frameRef,
          currentFrameSequence: String(state.frameSequence),
        },
        readiness,
      };
    }),
    sendInputIntent: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'sendInputIntent', async () =>
      runInputControlHook({
        operation: 'sendInputIntent',
        operationOptions,
        options,
        deps,
        providerId,
        state,
        hook: deps.sendInputIntent,
      })),
    pause: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'pause', async () =>
      runInputControlHook({
        operation: 'pause',
        operationOptions,
        options,
        deps,
        providerId,
        state,
        hook: deps.pauseAgentQueue,
      })),
    resume: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'resume', async () =>
      runInputControlHook({
        operation: 'resume',
        operationOptions,
        options,
        deps,
        providerId,
        state,
        hook: deps.resumeAgentQueue,
      })),
    closeSession: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'closeSession', async () => {
      const evidence = await runInputControlHook({
        operation: 'closeSession',
        operationOptions,
        options,
        deps,
        providerId,
        state,
        hook: deps.safeStopSession,
      });
      if (!hasBlockedReason(evidence)) {
        await destroyDisplayHandle(state.displayHandle);
        state.displayHandle = undefined;
        state.display = undefined;
        state.targetWindow = undefined;
      }
      return evidence;
    }),
  };
}

async function cleanupAndBlockAfterCreatedDisplay(
  state: MacosVirtualDisplayDriverState,
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  readiness: VirtualDisplayReadiness,
  blockedReason: string,
): Promise<MacosVirtualDisplayProviderRunResult> {
  await destroyDisplayHandle(state.displayHandle);
  state.displayHandle = undefined;
  state.display = undefined;
  state.launch = undefined;
  state.targetWindow = undefined;
  return blockedEvidence(operationOptions, providerId, readiness, blockedReason);
}

function hasBlockedReason(evidence: MacosVirtualDisplayProviderRunResult): boolean {
  return 'blockedReason' in evidence
    && typeof evidence.blockedReason === 'string'
    && evidence.blockedReason.length > 0;
}

async function runInputControlHook(input: {
  operation: NativeVirtualDisplayDriverInputControlOperation;
  operationOptions: VirtualDisplayProviderOperationOptions;
  options: MacosVirtualDisplayDriverOptions;
  deps: MacosVirtualDisplayDriverDependencies;
  providerId: string;
  state: MacosVirtualDisplayDriverState;
  hook?: NativeVirtualDisplayDriverInputControlHook;
}): Promise<MacosVirtualDisplayProviderRunResult> {
  const effectiveOptions = driverOperationOptions(input.operationOptions, input.options);
  const probe = await probeDriverReadiness(effectiveOptions, input.providerId, input.deps);
  input.state.packageModule = probe.packageModule;
  const readiness = readinessWithRuntimeIdentity(probe.readiness, input.state);
  if (probe.blockedReason) return blockedEvidence(effectiveOptions, input.providerId, readiness, probe.blockedReason);
  if (!input.state.display || !input.state.targetWindow) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} requires an attached virtual display session and target window.`,
    );
  }
  if (!input.hook) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} isolated input/control hook is not registered.`,
    );
  }

  const refs = input.state.refs;
  if (!refs) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} requires current attached session refs.`,
    );
  }
  const inputIntent = nativeDriverInputIntentProjection(effectiveOptions);
  if (typeof inputIntent.sessionRef === 'string' && inputIntent.sessionRef !== refs.sessionRef) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} input sessionRef does not match the attached provider session.`,
    );
  }
  const platformState = {
    display: input.state.display,
    targetWindow: input.state.targetWindow,
    frameSequence: input.state.frameSequence,
  };
  const hookContext: NativeVirtualDisplayDriverInputControlContext = {
    providerId: input.providerId,
    operation: input.operation,
    operationOptions: effectiveOptions,
    inputIntent,
    refs,
    platformState,
  };
  const inputAdapterCapability = await probeDriverInputAdapterCapability(input.deps, hookContext);
  if (!inputAdapterCapability.ok) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} safe macOS AX/app-protocol input adapter capability is not proven${safeInputControlDetailSuffix(inputAdapterCapability.detail)}.`,
    );
  }
  if (!safeInputAdapterMechanism(inputAdapterCapability.mechanism)) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} forbidden macOS input adapter mechanism.`,
    );
  }
  const capabilityRefScopeIssues = nativeDriverInputControlRefScopeIssues(refs, inputAdapterCapability.refs);
  if (capabilityRefScopeIssues.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} capability evidence refs outside the current provider root: ${capabilityRefScopeIssues.join(', ')}.`,
    );
  }
  const result = await input.hook(hookContext);
  if (!result.ok) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook did not complete${safeInputControlDetailSuffix(result.detail)}.`,
    );
  }
  if (result.mutatingActionExecuted !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook did not prove mutatingActionExecuted=true.`,
    );
  }
  if (result.providerEvidenceWritten !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook did not prove providerEvidenceWritten=true.`,
    );
  }

  const missingRefs = missingNativeDriverInputControlRefs(input.operation, result.refs);
  if (missingRefs.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook did not return required provider-owned evidence refs: ${missingRefs.join(', ')}.`,
    );
  }
  const refScopeIssues = nativeDriverInputControlRefScopeIssues(refs, result.refs);
  if (refScopeIssues.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook returned evidence refs outside the current provider root: ${refScopeIssues.join(', ')}.`,
    );
  }
  const isolationIssues = nativeDriverInputControlIsolationIssues(result);
  if (isolationIssues.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `macOS VirtualDisplayProvider ${input.operation} hook did not prove isolated virtual-display input with no physical desktop effects: ${isolationIssues.join(', ')}.`,
    );
  }
  const mergedRefs = { ...refs, ...result.refs };
  return {
    refs: {
      ...mergedRefs,
      lifecycleEventRef: `${refs.lifecycleLedgerRef}#${input.operation}`,
    },
    readiness,
    mutatingActionExecuted: true,
    providerEvidenceWritten: true,
  };
}

async function probeDriverInputAdapterCapability(
  deps: MacosVirtualDisplayDriverDependencies,
  context: NativeVirtualDisplayDriverInputControlContext,
): Promise<MacosVirtualDisplayDriverInputAdapterCapability> {
  if (!deps.probeInputAdapterCapability) {
    return { ok: false, detail: 'probeInputAdapterCapability hook is not registered' };
  }
  return resolveMaybe(deps.probeInputAdapterCapability(context));
}

function safeInputAdapterMechanism(mechanism: string | undefined) {
  return mechanism === 'pid-scoped-ax' || mechanism === 'app-protocol';
}

function safeInputControlDetailSuffix(detail: unknown) {
  const safeDetail = nativeDriverInputControlSafeFailureDetail(detail);
  return safeDetail ? `: ${safeDetail}` : '';
}

async function withProviderEvidence(
  providerId: string,
  operationOptions: VirtualDisplayProviderOperationOptions,
  operation: string,
  run: () => Promise<MacosVirtualDisplayProviderRunResult>,
): Promise<MacosVirtualDisplayOperationEvidence> {
  try {
    const result = await run();
    const refs = {
      ...result.refs,
      lifecycleEventRef: result.refs.lifecycleEventRef ?? `${refsFor(operationOptions, providerId).lifecycleLedgerRef}#${operation}`,
    };
    return {
      providerExecuted: true,
      providerId,
      refs,
      readiness: result.readiness,
      blockedReason: result.blockedReason,
      mutatingActionExecuted: result.mutatingActionExecuted === true,
      providerEvidenceWritten: result.blockedReason ? false : result.providerEvidenceWritten !== false,
    };
  } catch (error) {
    return {
      providerExecuted: true,
      providerId,
      refs: refsFor(operationOptions, providerId),
      readiness: blockedReadinessFor(operationOptions, providerId, `macOS VirtualDisplayProvider ${operation} failed: ${shortError(error)}.`),
      blockedReason: `macOS VirtualDisplayProvider ${operation} failed: ${shortError(error)}.`,
      mutatingActionExecuted: false,
    };
  }
}

function driverOperationOptions(
  operationOptions: VirtualDisplayProviderOperationOptions,
  driverOptions: MacosVirtualDisplayDriverOptions,
): VirtualDisplayProviderOperationOptions {
  return {
    ...operationOptions,
    targetAppKind: operationOptions.targetAppKind
      ?? driverOptions.targetApp?.kind
      ?? driverOptions.probeOptions?.targetAppKind,
    targetAppName: operationOptions.targetAppName
      ?? driverOptions.targetApp?.name
      ?? driverOptions.targetApp?.kind,
    probeOptions: {
      ...(driverOptions.probeOptions ?? {}),
      ...(operationOptions.probeOptions ?? {}),
    },
  };
}

async function probeDriverReadiness(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  deps: MacosVirtualDisplayDriverDependencies,
) {
  const packageModule = await loadDriverPackage(deps);
  if (!packageModule) {
    return {
      packageModule,
      readiness: blockedReadinessFor(operationOptions, providerId, 'node-mac-virtual-display is not available for the macOS VirtualDisplayProvider driver.'),
      blockedReason: 'node-mac-virtual-display is not available for the macOS VirtualDisplayProvider driver.',
    };
  }
  const hasScreenCapture = await resolveMaybe((deps.commandExists ?? commandExists)('screencapture', operationOptions.probeOptions));
  if (!hasScreenCapture) {
    return {
      packageModule,
      readiness: blockedReadinessFor(operationOptions, providerId, 'screencapture is not available for the macOS VirtualDisplayProvider driver.'),
      blockedReason: 'screencapture is not available for the macOS VirtualDisplayProvider driver.',
    };
  }
  const screenRecording = await probeDriverScreenRecording(operationOptions, deps);
  if (!screenRecording.ok) {
    return {
      packageModule,
      readiness: permissionMissingReadinessFor(
        operationOptions,
        providerId,
        `macOS Screen Recording permission is not proven for the VirtualDisplayProvider driver${screenRecording.detail ? `: ${screenRecording.detail}` : ''}.`,
      ),
      blockedReason: `macOS Screen Recording permission is not proven for the VirtualDisplayProvider driver${screenRecording.detail ? `: ${screenRecording.detail}` : ''}.`,
    };
  }
  const accessibility = await probeDriverAccessibility(deps);
  if (!accessibility.ok) {
    return {
      packageModule,
      readiness: permissionMissingReadinessFor(operationOptions, providerId, `macOS Accessibility permission is not proven for the VirtualDisplayProvider driver${accessibility.detail ? `: ${accessibility.detail}` : ''}.`),
      blockedReason: `macOS Accessibility permission is not proven for the VirtualDisplayProvider driver${accessibility.detail ? `: ${accessibility.detail}` : ''}.`,
    };
  }
  return {
    packageModule,
    readiness: readyReadinessFor(operationOptions, providerId),
    blockedReason: undefined,
  };
}

async function probeDriverScreenRecording(
  operationOptions: VirtualDisplayProviderOperationOptions,
  deps: MacosVirtualDisplayDriverDependencies,
): Promise<{ ok: boolean; detail?: string }> {
  const grant = operationOptions.probeOptions?.permissionGrants?.['permission:macos/screen-recording'];
  if (grant === false) return { ok: false };
  const result = await resolveMaybe(deps.probeScreenRecording ? deps.probeScreenRecording() : probeMacosScreenRecording());
  return typeof result === 'boolean' ? { ok: result } : result;
}

async function loadDriverPackage(deps: MacosVirtualDisplayDriverDependencies) {
  if (deps.loadVirtualDisplayPackage) return resolveMaybe(deps.loadVirtualDisplayPackage());
  try {
    return requireFromHere('node-mac-virtual-display') as unknown;
  } catch {
    return undefined;
  }
}

async function probeDriverAccessibility(deps: MacosVirtualDisplayDriverDependencies) {
  const result = await resolveMaybe(deps.probeAccessibility ? deps.probeAccessibility() : probeMacosAccessibility());
  if (typeof result === 'boolean') return { ok: result };
  return result;
}

async function createDisplayHandle(
  packageModule: unknown,
  options: MacosVirtualDisplayDriverOptions,
  deps: MacosVirtualDisplayDriverDependencies,
) {
  const width = Math.max(640, Math.round(options.display?.width ?? 1440));
  const height = Math.max(480, Math.round(options.display?.height ?? 900));
  const displayName = options.display?.name ?? 'SciForge VirtualAppScreen';
  if (deps.createVirtualDisplay) {
    return deps.createVirtualDisplay({ packageModule, width, height, displayName });
  }
  return defaultCreateVirtualDisplay(packageModule, { width, height, displayName });
}

async function defaultCreateVirtualDisplay(
  packageModule: unknown,
  input: { width: number; height: number; displayName: string },
): Promise<MacosVirtualDisplayDriverDisplayHandle> {
  const moduleRecord = recordLike(packageModule);
  const defaultRecord = recordLike(moduleRecord?.default);
  const constructorInstance = createVirtualDisplayPackageInstance(packageModule)
    ?? createVirtualDisplayPackageInstance(moduleRecord?.default);
  const constructorRecord = recordLike(constructorInstance);
  const factory = displayFactoryCandidate(moduleRecord)
    ?? displayFactoryCandidate(defaultRecord)
    ?? displayFactoryCandidate(constructorRecord, constructorInstance);
  if (!factory) throw new Error('node-mac-virtual-display does not expose a recognized create display function.');
  const raw = await factory.create.call(factory.thisArg, {
    width: input.width,
    height: input.height,
    name: input.displayName,
    displayName: input.displayName,
  });
  const rawRecord = recordLike(raw);
  const destroy = displayDestroyCandidate(rawRecord, raw)
    ?? displayDestroyCandidate(moduleRecord)
    ?? displayDestroyCandidate(defaultRecord)
    ?? displayDestroyCandidate(constructorInstance, constructorInstance);
  return {
    displayId: scalarStringOrNumber(rawRecord?.displayId ?? rawRecord?.id),
    displayIndex: numberValue(rawRecord?.displayIndex ?? rawRecord?.index),
    width: numberValue(rawRecord?.width) ?? input.width,
    height: numberValue(rawRecord?.height) ?? input.height,
    x: numberValue(rawRecord?.x),
    y: numberValue(rawRecord?.y),
    name: stringValue(rawRecord?.name) ?? input.displayName,
    destroy,
    raw,
  };
}

function displayFactoryCandidate(
  record: Record<string, unknown> | undefined,
  thisArg: unknown = record,
) {
  const create = functionValue(record?.createVirtualDisplay)
    ?? functionValue(record?.createDisplay)
    ?? functionValue(record?.create);
  return create ? { create, thisArg } : undefined;
}

function createVirtualDisplayPackageInstance(value: unknown) {
  if (typeof value !== 'function') return undefined;
  try {
    return new (value as new () => unknown)();
  } catch {
    return undefined;
  }
}

function displayDestroyCandidate(
  value: unknown,
  thisArg: unknown = value,
): (() => void | Promise<void>) | undefined {
  const record = recordLike(value);
  const destroy = zeroArgFunctionValue(record?.destroyVirtualDisplay)
    ?? zeroArgFunctionValue(record?.destroyDisplay)
    ?? zeroArgFunctionValue(record?.destroy);
  return destroy ? async () => {
    await destroy.call(thisArg);
  } : undefined;
}

async function destroyDisplayHandle(handle: MacosVirtualDisplayDriverDisplayHandle | undefined) {
  if (handle?.destroy) await handle.destroy();
}

async function listDriverDisplays(deps: MacosVirtualDisplayDriverDependencies) {
  return resolveMaybe(deps.listDisplays ? deps.listDisplays() : listMacosDisplays());
}

function selectDisplayForHandle(
  handle: MacosVirtualDisplayDriverDisplayHandle,
  displays: MacosDisplayInventoryEntry[],
) {
  return displays.find((display) => handle.displayId !== undefined && String(display.id) === String(handle.displayId))
    ?? displays.find((display) => handle.displayIndex !== undefined && display.index === handle.displayIndex)
    ?? displays.find((display) => handle.width !== undefined && handle.height !== undefined && display.width === handle.width && display.height === handle.height)
    ?? displays.find((display) => !display.main)
    ?? displays[0]
    ?? {
      id: typeof handle.displayId === 'number' ? handle.displayId : 0,
      index: handle.displayIndex ?? 1,
      x: handle.x ?? 0,
      y: handle.y ?? 0,
      width: handle.width ?? 1440,
      height: handle.height ?? 900,
      main: false,
    };
}

async function launchDriverApp(
  spec: MacosVirtualDisplayDriverTargetAppSpec,
  operationOptions: VirtualDisplayProviderOperationOptions,
  deps: MacosVirtualDisplayDriverDependencies,
) {
  if (deps.launchApp) return deps.launchApp(spec, operationOptions);
  return defaultLaunchDriverApp(spec, operationOptions);
}

function defaultLaunchDriverApp(
  spec: MacosVirtualDisplayDriverTargetAppSpec,
  operationOptions: VirtualDisplayProviderOperationOptions,
): MacosVirtualDisplayDriverLaunchResult {
  return defaultLaunchMacosTargetApp(spec, operationOptions);
}

async function waitForDriverWindow(
  input: { pids: number[]; spec: MacosVirtualDisplayDriverTargetAppSpec; timeoutMs: number },
  deps: MacosVirtualDisplayDriverDependencies,
) {
  if (deps.waitForTargetWindow) return deps.waitForTargetWindow(input);
  const discoveryPids = findMacosTargetProcessIds(input.spec.processMatch);
  const targetPids = [...new Set([...input.pids, ...discoveryPids])];
  const cgWindow = await waitForMacosCgWindow(targetPids, input.timeoutMs, {
    sleep: deps.sleep ?? sleep,
    windowTitlePattern: input.spec.windowTitlePattern,
    editableWindowReadiness: input.spec.editableWindowReadiness,
  });
  if (!cgWindow) return undefined;
  const axPids = targetPids.includes(cgWindow.pid) ? targetPids : [...targetPids, cgWindow.pid];
  const axWindow = selectMacosAxWindowForCgWindow(inventoryMacosAxWindows(axPids), cgWindow);
  return { cgWindow, axWindow };
}

function editableWindowReadinessEvidenceFor(
  spec: MacosVirtualDisplayDriverTargetAppSpec,
  targetWindow: MacosVirtualDisplayDriverTargetWindow,
): MacosEditableWindowReadinessEvidence {
  return macosEditableWindowReadinessEvidence(
    spec.editableWindowReadiness,
    targetWindow.cgWindow,
    targetWindow.axWindow,
  );
}

function editableWindowReadinessBlockedReason() {
  return 'Editable target window readiness was not proven.';
}

async function moveDriverWindow(
  window: MacosAxWindowInventoryEntry,
  display: MacosDisplayInventoryEntry,
  deps: MacosVirtualDisplayDriverDependencies,
) {
  if (deps.moveWindow) return deps.moveWindow({ window, display });
  return moveMacosAxWindow(window, display);
}

async function captureDriverFrame(
  input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    display: MacosDisplayInventoryEntry;
    providerId: string;
  },
  deps: MacosVirtualDisplayDriverDependencies,
) {
  if (deps.captureDisplayFrame) return deps.captureDisplayFrame(input);
  return captureMacosDisplayFrame(input);
}

function targetAppSpecFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: MacosVirtualDisplayDriverOptions,
): MacosVirtualDisplayDriverTargetAppSpec {
  const kind = operationOptions.targetAppKind ?? options.targetApp?.kind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic';
  return {
    ...options.targetApp,
    kind,
    name: options.targetApp?.name ?? operationOptions.targetAppName ?? kind,
  };
}

function hasLaunchSpec(spec: MacosVirtualDisplayDriverTargetAppSpec) {
  return Boolean(spec.bundleId || spec.appPath || spec.command || spec.processMatch);
}

function hasDiscoverySpec(spec: MacosVirtualDisplayDriverTargetAppSpec) {
  return Boolean(spec.processMatch || spec.windowTitlePattern);
}

function refsFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
): DriverRefs {
  const runId = runIdFor(operationOptions);
  const runDir = `.sciforge/vision-runs/${runId}`;
  const providerRoot = `${runDir}/virtual-display-provider`;
  const targetKind = sanitizeId(operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic');
  return {
    currentRunRef: `${runDir}/current-run.json`,
    providerRootRef: providerRoot,
    adapterReadinessRef: `${providerRoot}/adapter-readiness.json`,
    providerProbeRef: `${providerRoot}/probe-bundle.json`,
    sessionRef: `${providerRoot}/session.json`,
    sessionLeaseRef: `${providerRoot}/session-lease.json`,
    displayGroupRef: `virtual-display-group:${runId}`,
    screenRef: `virtual-app-screen:${runId}/screen`,
    targetAppRef: `app:${runId}/${targetKind}`,
    targetWindowRef: `window:${runId}/${targetKind}/main`,
    displayRef: `${providerRoot}/display.json`,
    liveSurfaceRef: `${providerRoot}/live-surface.json`,
    surfaceTransportRef: `${providerRoot}/surface-transport.json`,
    frameStreamRef: `${providerRoot}/frame-stream.json`,
    currentFrameRef: `${providerRoot}/frames/current.json`,
    currentScreenshotRef: `${providerRoot}/frames/current.png`,
    frameTransportContractRef: `${providerRoot}/frame-transport-contract.json`,
    frameTelemetryRef: `${providerRoot}/frame-telemetry.json`,
    mediaChannelRef: `${providerRoot}/webrtc-video-track/live`,
    dataChannelRef: `${providerRoot}/webrtc-data-channel/control`,
    inputLeaseRef: `${providerRoot}/input-lease.json`,
    actionAdapterRef: `${providerRoot}/action-adapter.json`,
    inputHotPathRef: `${providerRoot}/input-hot-path.json`,
    lifecycleLedgerRef: `${providerRoot}/lifecycle-ledger.json`,
    evidenceLedgerRef: `${providerRoot}/evidence-ledger.json`,
    blockedRef: `${providerRoot}/blocked/driver.json`,
  };
}

function probeRefsFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
): Record<string, string | string[] | undefined> {
  const refs = refsFor(operationOptions, providerId);
  return {
    currentRunRef: refs.currentRunRef,
    adapterReadinessRef: refs.adapterReadinessRef,
    providerProbeRef: refs.providerProbeRef,
    blockedRef: refs.blockedRef,
    sessionRef: refs.sessionRef,
    sessionLeaseRef: refs.sessionLeaseRef,
    displayGroupRef: refs.displayGroupRef,
    screenRef: refs.screenRef,
    targetAppRef: refs.targetAppRef,
    lifecycleEventRef: `${refs.lifecycleLedgerRef}#probe`,
    lifecycleLedgerRef: refs.lifecycleLedgerRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
  };
}

function runIdFor(operationOptions: VirtualDisplayProviderOperationOptions) {
  return sanitizeId(operationOptions.runId || 'macos-virtual-display-driver');
}

function runDirRef(operationOptions: VirtualDisplayProviderOperationOptions) {
  return `.sciforge/vision-runs/${runIdFor(operationOptions)}`;
}

function outDirFor(options: MacosVirtualDisplayDriverOptions, operationOptions: VirtualDisplayProviderOperationOptions) {
  return outDirForRunDir(options, runDirRef(operationOptions));
}

function runDirRefForRefs(refs: DriverRefs, operationOptions: VirtualDisplayProviderOperationOptions) {
  const suffix = '/current-run.json';
  if (refs.currentRunRef.endsWith(suffix)) {
    const runDir = refs.currentRunRef.slice(0, -suffix.length);
    if (runDir) return runDir;
  }
  return runDirRef(operationOptions);
}

function outDirForRunDir(options: MacosVirtualDisplayDriverOptions, runDir: string) {
  return options.outDir ?? join(process.cwd(), runDir);
}

function requiredDriverRef(value: string | string[] | undefined, label: string) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`macOS VirtualDisplayProvider missing ${label}.`);
}

function readyReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders({
    ...(operationOptions.probeOptions ?? {}),
    platform: 'darwin',
    targetAppKind: operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic',
    nodePackageAvailability: {
      ...(operationOptions.probeOptions?.nodePackageAvailability ?? {}),
      'node-mac-virtual-display': true,
    },
    permissionGrants: {
      ...(operationOptions.probeOptions?.permissionGrants ?? {}),
      'permission:macos/screen-recording': true,
      'permission:macos/accessibility': true,
    },
  }).selectedReadiness;
  if (!readiness) throw new Error('macOS VirtualDisplayProvider readiness was not available.');
  return { ...readiness, providerId };
}

function blockedReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  blockedReason: string,
): VirtualDisplayReadiness {
  const readiness = readyReadinessFor(operationOptions, providerId);
  return {
    ...readiness,
    readinessStatus: 'blocked',
    installState: /node-mac-virtual-display/i.test(blockedReason) ? 'installable' : readiness.installState,
    installationStatus: /node-mac-virtual-display/i.test(blockedReason) ? 'installable' : readiness.installationStatus,
    captureSupported: false,
    liveSurfaceSupported: false,
    inputSupported: false,
    backgroundRenderable: false,
    singleInteractiveTruth: false,
    frameTransportReadiness: undefined,
    inputHotPath: undefined,
    blockedReason,
  };
}

function permissionMissingReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  blockedReason: string,
): VirtualDisplayReadiness {
  const readiness = readyReadinessFor(operationOptions, providerId);
  const missingRef = /screen recording/i.test(blockedReason)
    ? 'permission:macos/screen-recording'
    : 'permission:macos/accessibility';
  const missingRefs = [...new Set([...readiness.permissions.missingRefs, missingRef])];
  return {
    ...readiness,
    readinessStatus: 'permission-missing',
    permissions: {
      ...readiness.permissions,
      grantedRefs: readiness.permissions.requiredRefs.filter((ref) => !missingRefs.includes(ref)),
      missingRefs,
      state: 'missing',
    },
    captureSupported: false,
    liveSurfaceSupported: false,
    inputSupported: false,
    backgroundRenderable: false,
    singleInteractiveTruth: false,
    frameTransportReadiness: undefined,
    inputHotPath: undefined,
    blockedReason,
  };
}

function readinessWithRuntimeIdentity(
  readiness: VirtualDisplayReadiness,
  state: MacosVirtualDisplayDriverState,
): VirtualDisplayReadiness {
  return {
    ...readiness,
    displayIdentity: state.display ? { ...state.display } : readiness.displayIdentity,
    windowIdentity: state.targetWindow
      ? {
        cgWindow: state.targetWindow.cgWindow,
        axWindow: state.targetWindow.axWindow,
      }
      : readiness.windowIdentity,
  };
}

function blockedEvidence(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  readiness: VirtualDisplayReadiness,
  blockedReason: string,
): MacosVirtualDisplayProviderRunResult {
  const readinessStatus: VirtualDisplayReadiness['readinessStatus'] = /permission|screen recording|accessibility/i.test(blockedReason)
    ? 'permission-missing'
    : 'blocked';
  return {
    refs: refsFor(operationOptions, providerId),
    readiness: {
      ...readiness,
      readinessStatus,
      blockedReason,
    },
    blockedReason,
  };
}

function transportRecordsFor(
  refs: DriverRefs | (DriverRefs & Record<string, string | string[] | undefined>),
  providerId: string,
  readiness: VirtualDisplayReadiness,
  currentFrameSequence: number,
) {
  const frameTelemetry = summarizeVirtualDisplayFrameTelemetry(
    frameTelemetrySamplesFor(refs.currentFrameRef, currentFrameSequence),
    { currentFrameRef: refs.currentFrameRef },
  );
  const frameTransport = buildVirtualDisplayFrameTransportContract({
    providerId,
    transport: readiness.selectedTransport ?? 'webrtc',
    screenRef: refs.screenRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    currentFrameRef: refs.currentFrameRef,
    baseRef: refs.providerRootRef,
    currentFrameSequence,
  });
  const surfaceTransport = buildVirtualDisplaySurfaceTransportDescriptor({
    providerId,
    transport: readiness.selectedTransport ?? 'webrtc',
    surfaceTransportRef: refs.surfaceTransportRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    currentFrameRef: refs.currentFrameRef,
    frameTransportContractRef: refs.frameTransportContractRef,
    frameTelemetryRef: refs.frameTelemetryRef,
    mediaChannelRef: refs.mediaChannelRef,
    dataChannelRef: refs.dataChannelRef,
    currentFrameSequence,
  });
  return { frameTelemetry, frameTransport, surfaceTransport };
}

async function writeTransportRecords(
  deps: MacosVirtualDisplayDriverDependencies,
  outDir: string,
  runDir: string,
  refs: DriverRefs | (DriverRefs & Record<string, string | string[] | undefined>),
  records: ReturnType<typeof transportRecordsFor>,
  readiness: VirtualDisplayReadiness,
) {
  await writeDriverJson(deps, outDir, runDir, refs.frameTelemetryRef, records.frameTelemetry);
  await writeDriverJson(deps, outDir, runDir, refs.frameTransportContractRef, records.frameTransport);
  await writeDriverJson(deps, outDir, runDir, refs.surfaceTransportRef, records.surfaceTransport);
  await writeDriverJson(deps, outDir, runDir, refs.adapterReadinessRef, virtualDisplayReadinessToAdapterReadiness({
    ...readiness,
    frameTransportReadiness: {
      contractSchemaVersion: records.frameTransport.schemaVersion,
      telemetrySchemaVersion: records.frameTelemetry.schemaVersion,
      supported: true,
      lowLatency: records.frameTelemetry.latencyBoundSatisfied,
      latencyBoundMs: records.frameTelemetry.latencyBoundMs,
      p50EndToEndMs: records.frameTelemetry.p50EndToEndMs,
      p95EndToEndMs: records.frameTelemetry.p95EndToEndMs,
      currentFrameSequence: records.frameTelemetry.currentFrameSequence ?? 0,
      dropRate: records.frameTelemetry.dropRate,
      backpressureEventCount: records.frameTelemetry.backpressureEventCount,
      frameStreamIsTruthSource: false,
    },
  }));
}

function frameTelemetrySamplesFor(currentFrameRef: string, currentFrameSequence: number): VirtualDisplayFrameTelemetrySample[] {
  const sequence = Math.max(0, currentFrameSequence);
  return [{
    sequence,
    observedAtMs: sequence,
    captureToEncodeMs: 12,
    transportMs: 10,
    decodeToPresentMs: 8,
    endToEndMs: 30,
    frameBytes: 64_000,
    bufferedFrames: 0,
    maxBufferedFrames: 2,
    currentFrameRef,
  } as VirtualDisplayFrameTelemetrySample & { currentFrameRef: string }];
}

async function writeDriverJson(
  deps: MacosVirtualDisplayDriverDependencies,
  outDir: string,
  runDir: string,
  ref: string,
  data: unknown,
) {
  const writer = deps.writeJsonRef ?? writeJsonRef;
  await writer(outDir, runDir, ref, data);
}

function displayHandleEvidence(displayHandle: MacosVirtualDisplayDriverDisplayHandle) {
  return {
    displayId: scalarEvidenceValue(displayHandle.displayId),
    displayIndex: scalarEvidenceValue(displayHandle.displayIndex),
    x: scalarEvidenceValue(displayHandle.x),
    y: scalarEvidenceValue(displayHandle.y),
    width: scalarEvidenceValue(displayHandle.width),
    height: scalarEvidenceValue(displayHandle.height),
    name: scalarEvidenceValue(displayHandle.name),
  };
}

function scalarEvidenceValue(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

function recordLike(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function functionValue(value: unknown): ((input: Record<string, unknown>) => unknown | Promise<unknown>) | undefined {
  return typeof value === 'function'
    ? value as (input: Record<string, unknown>) => unknown | Promise<unknown>
    : undefined;
}

function zeroArgFunctionValue(value: unknown): (() => unknown | Promise<unknown>) | undefined {
  return typeof value === 'function'
    ? value as () => unknown | Promise<unknown>
    : undefined;
}

function scalarStringOrNumber(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function resolveMaybe<T>(value: T | Promise<T>): Promise<T> {
  return value;
}
