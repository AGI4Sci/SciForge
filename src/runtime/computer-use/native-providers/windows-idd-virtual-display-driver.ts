import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
  type WindowsIddVirtualDisplayOperationEvidence,
  type WindowsIddVirtualDisplayProviderHooks,
} from './windows-idd-virtual-display-provider.js';
import {
  missingNativeDriverInputControlRefs,
  nativeDriverInputIntentProjection,
  type NativeVirtualDisplayDriverInputControlHook,
  type NativeVirtualDisplayDriverInputControlOperation,
} from './native-driver-input-control.js';

export interface WindowsIddVirtualDisplayDriverTargetAppSpec {
  kind?: string;
  name?: string;
  appUserModelId?: string;
  appPath?: string;
  command?: string;
  args?: string[];
  processMatch?: string;
  windowTitlePattern?: string;
}

export interface WindowsIddVirtualDisplayDriverDisplayHandle {
  displayId?: string | number;
  adapterId?: string;
  targetId?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  name?: string;
  raw?: unknown;
}

export interface WindowsIddVirtualDisplayDriverLaunchResult {
  pids: number[];
  targetAppRef?: string;
  launchRef?: string;
  details?: Record<string, unknown>;
}

export interface WindowsIddVirtualDisplayDriverTargetWindow {
  pid: number;
  hwnd?: string | number;
  windowId?: string | number;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  raw?: unknown;
}

export interface WindowsIddVirtualDisplayDriverAttachResult {
  ok: boolean;
  surfaceId?: string;
  liveSurfaceRef?: string;
  details?: Record<string, unknown>;
}

export interface WindowsIddVirtualDisplayFrameCapture {
  frameRef: string;
  screenshotRef?: string;
  frameRecord: Record<string, unknown>;
}

export interface WindowsIddVirtualDisplayDriverDependencies {
  platform?: () => string;
  loadIddDriverApi?: () => unknown | Promise<unknown>;
  probeDriverInstalled?: (driverApi: unknown) =>
    | boolean
    | { ok: boolean; detail?: string }
    | Promise<boolean | { ok: boolean; detail?: string }>;
  probeDriverAuthorized?: (driverApi: unknown) =>
    | boolean
    | { ok: boolean; detail?: string }
    | Promise<boolean | { ok: boolean; detail?: string }>;
  probeCaptureAvailable?: (driverApi: unknown) =>
    | boolean
    | { ok: boolean; detail?: string }
    | Promise<boolean | { ok: boolean; detail?: string }>;
  createVirtualDisplay?: (input: {
    driverApi: unknown;
    width: number;
    height: number;
    displayName: string;
  }) => WindowsIddVirtualDisplayDriverDisplayHandle | Promise<WindowsIddVirtualDisplayDriverDisplayHandle>;
  launchApp?: (
    spec: WindowsIddVirtualDisplayDriverTargetAppSpec,
    options: VirtualDisplayProviderOperationOptions,
  ) => WindowsIddVirtualDisplayDriverLaunchResult | Promise<WindowsIddVirtualDisplayDriverLaunchResult>;
  findTargetWindow?: (input: {
    pids: number[];
    spec: WindowsIddVirtualDisplayDriverTargetAppSpec;
    timeoutMs: number;
  }) => WindowsIddVirtualDisplayDriverTargetWindow | undefined | Promise<WindowsIddVirtualDisplayDriverTargetWindow | undefined>;
  attachWindowToDisplay?: (input: {
    display: WindowsIddVirtualDisplayDriverDisplayHandle;
    window: WindowsIddVirtualDisplayDriverTargetWindow;
    driverApi: unknown;
  }) => WindowsIddVirtualDisplayDriverAttachResult | Promise<WindowsIddVirtualDisplayDriverAttachResult>;
  captureFrame?: (input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    display: WindowsIddVirtualDisplayDriverDisplayHandle;
    window: WindowsIddVirtualDisplayDriverTargetWindow;
    providerId: string;
    frameSequence: number;
    driverApi: unknown;
  }) => WindowsIddVirtualDisplayFrameCapture | Promise<WindowsIddVirtualDisplayFrameCapture>;
  sendInputIntent?: NativeVirtualDisplayDriverInputControlHook;
  pauseAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  resumeAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  safeStopSession?: NativeVirtualDisplayDriverInputControlHook;
  writeJsonRef?: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  now?: () => number;
}

export interface WindowsIddVirtualDisplayDriverOptions {
  providerId?: string;
  platform?: string;
  targetApp?: WindowsIddVirtualDisplayDriverTargetAppSpec;
  display?: {
    width?: number;
    height?: number;
    name?: string;
  };
  outDir?: string;
  windowTimeoutMs?: number;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
  dependencies?: WindowsIddVirtualDisplayDriverDependencies;
}

interface WindowsIddVirtualDisplayDriverState {
  driverApi?: unknown;
  display?: WindowsIddVirtualDisplayDriverDisplayHandle;
  launch?: WindowsIddVirtualDisplayDriverLaunchResult;
  targetWindow?: WindowsIddVirtualDisplayDriverTargetWindow;
  attachResult?: WindowsIddVirtualDisplayDriverAttachResult;
  refs?: DriverRefs;
  frameSequence: number;
}

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

export function createWindowsIddVirtualDisplayDriverHooks(
  options: WindowsIddVirtualDisplayDriverOptions = {},
): WindowsIddVirtualDisplayProviderHooks {
  const providerId = options.providerId ?? WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID;
  const deps = options.dependencies ?? {};
  const state: WindowsIddVirtualDisplayDriverState = { frameSequence: 0 };
  return {
    probe: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'probe', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const probe = await probeDriverReadiness(effectiveOptions, providerId, options, deps);
      state.driverApi = probe.driverApi;
      const refs = probeRefsFor(effectiveOptions, providerId);
      const adapterReadinessRef = requiredDriverRef(refs.adapterReadinessRef, 'adapterReadinessRef');
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), adapterReadinessRef, {
        schemaVersion: 'sciforge.virtual-display.windows-idd.adapter-readiness.v1',
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
      const probe = await probeDriverReadiness(effectiveOptions, providerId, options, deps);
      state.driverApi = probe.driverApi;
      if (probe.blockedReason) {
        return blockedEvidence(effectiveOptions, providerId, probe.readiness, probe.blockedReason);
      }
      const refs = refsFor(effectiveOptions, providerId);
      state.refs = refs;
      const display = await createDriverDisplay(probe.driverApi, options, deps);
      state.display = display;
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.sessionRef, {
        schemaVersion: 'sciforge.virtual-display.windows-idd.session.v1',
        providerId,
        sessionRef: refs.sessionRef,
        displayRef: refs.displayRef,
        displayGroupRef: refs.displayGroupRef,
        screenRef: refs.screenRef,
        targetAppRef: refs.targetAppRef,
        displayIdentity: safeRecord(display),
        currentRunOnly: true,
      });
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.displayRef, {
        schemaVersion: 'sciforge.virtual-display.windows-idd.display.v1',
        providerId,
        displayRef: refs.displayRef,
        displayIdentity: safeRecord(display),
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
      const readiness = readinessWithRuntimeIdentity(readyReadinessFor(effectiveOptions, providerId), state);
      if (!state.display) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider launchApp requires a created virtual display session.');
      }
      const spec = targetAppSpecFor(effectiveOptions, options);
      if (!hasLaunchSpec(spec)) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider launchApp requires an explicit generic target app launch spec.');
      }
      const launch = await launchDriverApp(spec, effectiveOptions, deps);
      state.launch = launch;
      if (!launch.pids.length) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider launchApp did not materialize a target process id.');
      }
      const targetWindow = await findDriverTargetWindow({
        pids: launch.pids,
        spec,
        timeoutMs: options.windowTimeoutMs ?? 15000,
      }, deps);
      if (!targetWindow) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider launchApp could not find a target app window.');
      }
      state.targetWindow = targetWindow;
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.targetWindowRef, {
        schemaVersion: 'sciforge.virtual-display.windows-idd.target-window.v1',
        providerId,
        targetWindowRef: refs.targetWindowRef,
        targetAppRef: refs.targetAppRef,
        pids: launch.pids,
        targetWindow,
        launchDetails: launch.details,
        currentRunOnly: true,
      });
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
      if (!state.driverApi || !state.display || !state.targetWindow) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider attachSurface requires driver API, display, and target window evidence.');
      }
      const attachResult = await attachDriverWindowToDisplay({
        display: state.display,
        window: state.targetWindow,
        driverApi: state.driverApi,
      }, deps);
      state.attachResult = attachResult;
      if (!attachResult.ok) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider attachSurface could not attach the target window to the IDD surface.');
      }
      const transportRecords = transportRecordsFor(refs, providerId, readiness, state.frameSequence);
      await writeTransportRecords(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs, transportRecords, readiness);
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.liveSurfaceRef, {
        schemaVersion: 'sciforge.virtual-display.windows-idd.live-surface.v1',
        providerId,
        liveSurfaceRef: refs.liveSurfaceRef,
        frameStreamRef: refs.frameStreamRef,
        surfaceTransportRef: refs.surfaceTransportRef,
        targetWindowRef: refs.targetWindowRef,
        displayRef: refs.displayRef,
        displayIdentity: safeRecord(state.display),
        targetWindow: state.targetWindow,
        attachResult,
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
      if (!state.driverApi || !state.display || !state.targetWindow || !state.attachResult?.ok) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider readFrame requires an attached IDD surface.');
      }
      let capture: WindowsIddVirtualDisplayFrameCapture;
      try {
        capture = await captureDriverFrame({
          outDir: currentOutDir,
          runDirRef: currentRunDirRef,
          phase: 'current',
          display: state.display,
          window: state.targetWindow,
          providerId,
          frameSequence: state.frameSequence + 1,
          driverApi: state.driverApi,
        }, deps);
      } catch (error) {
        return blockedEvidence(effectiveOptions, providerId, readiness, `Windows IDD VirtualDisplayProvider readFrame capture failed: ${shortError(error)}.`);
      }
      if (!capture.frameRef) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Windows IDD VirtualDisplayProvider readFrame capture did not return a current frame ref.');
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
        currentScreenshotRef: capture.screenshotRef ?? refs.currentScreenshotRef,
      };
      const transportRecords = transportRecordsFor(transportRefs, providerId, readiness, state.frameSequence);
      await writeTransportRecords(deps, currentOutDir, currentRunDirRef, transportRefs, transportRecords, readiness);
      return {
        refs: {
          ...transportRefs,
          beforeFrameRef: capture.frameRef,
          afterFrameRef: capture.frameRef,
          currentFrameSequence: String(state.frameSequence),
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#readFrame`,
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
    closeSession: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'closeSession', async () =>
      runInputControlHook({
        operation: 'closeSession',
        operationOptions,
        options,
        deps,
        providerId,
        state,
        hook: deps.safeStopSession,
      })),
  };
}

async function runInputControlHook(input: {
  operation: NativeVirtualDisplayDriverInputControlOperation;
  operationOptions: VirtualDisplayProviderOperationOptions;
  options: WindowsIddVirtualDisplayDriverOptions;
  deps: WindowsIddVirtualDisplayDriverDependencies;
  providerId: string;
  state: WindowsIddVirtualDisplayDriverState;
  hook?: NativeVirtualDisplayDriverInputControlHook;
}) {
  const effectiveOptions = driverOperationOptions(input.operationOptions, input.options);
  const probe = await probeDriverReadiness(effectiveOptions, input.providerId, input.options, input.deps);
  input.state.driverApi = probe.driverApi;
  const readiness = readinessWithRuntimeIdentity(probe.readiness, input.state);
  if (probe.blockedReason) return blockedEvidence(effectiveOptions, input.providerId, readiness, probe.blockedReason);
  if (!input.state.driverApi || !input.state.display || !input.state.targetWindow || !input.state.attachResult?.ok) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} requires an attached IDD surface and target window.`,
    );
  }
  if (!input.hook) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} isolated input/control hook is not registered.`,
    );
  }

  const refs = input.state.refs;
  if (!refs) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} requires current attached session refs.`,
    );
  }
  const inputIntent = nativeDriverInputIntentProjection(effectiveOptions);
  if (typeof inputIntent.sessionRef === 'string' && inputIntent.sessionRef !== refs.sessionRef) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} input sessionRef does not match the attached provider session.`,
    );
  }
  const result = await input.hook({
    providerId: input.providerId,
    operation: input.operation,
    operationOptions: effectiveOptions,
    inputIntent,
    refs,
    platformState: {
      display: input.state.display,
      targetWindow: input.state.targetWindow,
      attachResult: input.state.attachResult,
      frameSequence: input.state.frameSequence,
    },
  });
  if (!result.ok) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} hook did not complete${result.detail ? `: ${result.detail}` : ''}.`,
    );
  }
  if (result.mutatingActionExecuted !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} hook did not prove mutatingActionExecuted=true.`,
    );
  }
  if (result.providerEvidenceWritten !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} hook did not prove providerEvidenceWritten=true.`,
    );
  }

  const missingRefs = missingNativeDriverInputControlRefs(input.operation, result.refs);
  if (missingRefs.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Windows IDD VirtualDisplayProvider ${input.operation} hook did not return required provider-owned evidence refs: ${missingRefs.join(', ')}.`,
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

async function withProviderEvidence(
  providerId: string,
  operationOptions: VirtualDisplayProviderOperationOptions,
  operation: string,
  run: () => Promise<{
    refs: Record<string, string | string[] | undefined>;
    readiness?: VirtualDisplayReadiness;
    blockedReason?: string;
    mutatingActionExecuted?: boolean;
    providerEvidenceWritten?: boolean;
  }>,
): Promise<WindowsIddVirtualDisplayOperationEvidence> {
  try {
    const result = await run();
    return {
      providerExecuted: true,
      providerId,
      refs: {
        ...result.refs,
        lifecycleEventRef: result.refs.lifecycleEventRef ?? `${refsFor(operationOptions, providerId).lifecycleLedgerRef}#${operation}`,
      },
      readiness: result.readiness,
      blockedReason: result.blockedReason,
      mutatingActionExecuted: result.mutatingActionExecuted === true,
      providerEvidenceWritten: result.blockedReason ? false : result.providerEvidenceWritten !== false,
    };
  } catch (error) {
    const reason = `Windows IDD VirtualDisplayProvider ${operation} failed: ${shortError(error)}.`;
    return {
      providerExecuted: true,
      providerId,
      refs: refsFor(operationOptions, providerId),
      readiness: blockedReadinessFor(operationOptions, providerId, reason),
      blockedReason: reason,
      mutatingActionExecuted: false,
    };
  }
}

function driverOperationOptions(
  operationOptions: VirtualDisplayProviderOperationOptions,
  driverOptions: WindowsIddVirtualDisplayDriverOptions,
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
  options: WindowsIddVirtualDisplayDriverOptions,
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  const hostPlatform = options.platform ?? deps.platform?.() ?? process.platform;
  if (hostPlatform !== 'win32') {
    return {
      driverApi: undefined,
      readiness: blockedReadinessFor(operationOptions, providerId, 'Windows IDD VirtualDisplayProvider driver requires a win32 host platform.'),
      blockedReason: 'Windows IDD VirtualDisplayProvider driver requires a win32 host platform.',
    };
  }
  const driverApi = await loadDriverApi(deps);
  if (!driverApi) {
    return {
      driverApi,
      readiness: blockedReadinessFor(operationOptions, providerId, 'Windows IDD driver API is not available for the VirtualDisplayProvider driver.'),
      blockedReason: 'Windows IDD driver API is not available for the VirtualDisplayProvider driver.',
    };
  }
  const installed = await probeOk(deps.probeDriverInstalled ? deps.probeDriverInstalled(driverApi) : true);
  if (!installed.ok) {
    return {
      driverApi,
      readiness: blockedReadinessFor(operationOptions, providerId, `Windows IDD virtual display driver is not installed${installed.detail ? `: ${installed.detail}` : ''}.`),
      blockedReason: `Windows IDD virtual display driver is not installed${installed.detail ? `: ${installed.detail}` : ''}.`,
    };
  }
  const authorized = await probeOk(deps.probeDriverAuthorized ? deps.probeDriverAuthorized(driverApi) : operationOptions.probeOptions?.permissionGrants?.['permission:windows/idd-driver-authorized'] === true);
  if (!authorized.ok) {
    return {
      driverApi,
      readiness: permissionMissingReadinessFor(operationOptions, providerId, `Windows IDD driver authorization is not proven${authorized.detail ? `: ${authorized.detail}` : ''}.`),
      blockedReason: `Windows IDD driver authorization is not proven${authorized.detail ? `: ${authorized.detail}` : ''}.`,
    };
  }
  const captureAvailable = await probeOk(deps.probeCaptureAvailable ? deps.probeCaptureAvailable(driverApi) : Boolean(deps.captureFrame));
  if (!captureAvailable.ok) {
    return {
      driverApi,
      readiness: blockedReadinessFor(operationOptions, providerId, `Windows IDD frame capture API is not available${captureAvailable.detail ? `: ${captureAvailable.detail}` : ''}.`),
      blockedReason: `Windows IDD frame capture API is not available${captureAvailable.detail ? `: ${captureAvailable.detail}` : ''}.`,
    };
  }
  return {
    driverApi,
    readiness: readyReadinessFor(operationOptions, providerId),
    blockedReason: undefined,
  };
}

async function loadDriverApi(deps: WindowsIddVirtualDisplayDriverDependencies) {
  if (!deps.loadIddDriverApi) return undefined;
  return resolveMaybe(deps.loadIddDriverApi());
}

async function probeOk(
  value: boolean | { ok: boolean; detail?: string } | Promise<boolean | { ok: boolean; detail?: string }>,
) {
  const result = await resolveMaybe(value);
  if (typeof result === 'boolean') return { ok: result };
  return result;
}

async function createDriverDisplay(
  driverApi: unknown,
  options: WindowsIddVirtualDisplayDriverOptions,
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  const width = Math.max(640, Math.round(options.display?.width ?? 1440));
  const height = Math.max(480, Math.round(options.display?.height ?? 900));
  const displayName = options.display?.name ?? 'SciForge VirtualAppScreen';
  if (deps.createVirtualDisplay) {
    return deps.createVirtualDisplay({ driverApi, width, height, displayName });
  }
  return defaultCreateVirtualDisplay(driverApi, { width, height, displayName });
}

async function defaultCreateVirtualDisplay(
  driverApi: unknown,
  input: { width: number; height: number; displayName: string },
): Promise<WindowsIddVirtualDisplayDriverDisplayHandle> {
  const api = recordLike(driverApi);
  const factory = functionValue(api?.createVirtualDisplay)
    ?? functionValue(api?.createDisplay)
    ?? functionValue(api?.createIddDisplay);
  if (!factory) throw new Error('Windows IDD driver API does not expose a recognized create display function.');
  const raw = await factory({
    width: input.width,
    height: input.height,
    name: input.displayName,
    displayName: input.displayName,
  });
  const rawRecord = recordLike(raw);
  return {
    displayId: scalarStringOrNumber(rawRecord?.displayId ?? rawRecord?.id),
    adapterId: stringValue(rawRecord?.adapterId),
    targetId: stringValue(rawRecord?.targetId),
    width: numberValue(rawRecord?.width) ?? input.width,
    height: numberValue(rawRecord?.height) ?? input.height,
    x: numberValue(rawRecord?.x),
    y: numberValue(rawRecord?.y),
    name: stringValue(rawRecord?.name) ?? input.displayName,
    raw,
  };
}

async function launchDriverApp(
  spec: WindowsIddVirtualDisplayDriverTargetAppSpec,
  operationOptions: VirtualDisplayProviderOperationOptions,
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  if (deps.launchApp) return deps.launchApp(spec, operationOptions);
  throw new Error(`No Windows IDD launch dependency is registered for target app ${spec.kind ?? spec.name ?? 'generic'}.`);
}

async function findDriverTargetWindow(
  input: { pids: number[]; spec: WindowsIddVirtualDisplayDriverTargetAppSpec; timeoutMs: number },
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  if (deps.findTargetWindow) return deps.findTargetWindow(input);
  throw new Error('No Windows IDD target window dependency is registered.');
}

async function attachDriverWindowToDisplay(
  input: {
    display: WindowsIddVirtualDisplayDriverDisplayHandle;
    window: WindowsIddVirtualDisplayDriverTargetWindow;
    driverApi: unknown;
  },
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  if (deps.attachWindowToDisplay) return deps.attachWindowToDisplay(input);
  const api = recordLike(input.driverApi);
  const attach = functionValue(api?.attachWindowToDisplay)
    ?? functionValue(api?.attachWindow)
    ?? functionValue(api?.bindWindowToDisplay);
  if (!attach) throw new Error('Windows IDD driver API does not expose a recognized attach window function.');
  const raw = await attach(input);
  if (typeof raw === 'boolean') return { ok: raw };
  const rawRecord = recordLike(raw);
  return {
    ok: rawRecord?.ok === true,
    surfaceId: stringValue(rawRecord?.surfaceId),
    liveSurfaceRef: stringValue(rawRecord?.liveSurfaceRef),
    details: safeRecord(rawRecord),
  };
}

async function captureDriverFrame(
  input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    display: WindowsIddVirtualDisplayDriverDisplayHandle;
    window: WindowsIddVirtualDisplayDriverTargetWindow;
    providerId: string;
    frameSequence: number;
    driverApi: unknown;
  },
  deps: WindowsIddVirtualDisplayDriverDependencies,
) {
  if (deps.captureFrame) return deps.captureFrame(input);
  throw new Error('No Windows IDD frame capture dependency is registered.');
}

function targetAppSpecFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: WindowsIddVirtualDisplayDriverOptions,
): WindowsIddVirtualDisplayDriverTargetAppSpec {
  const kind = operationOptions.targetAppKind ?? options.targetApp?.kind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic';
  return {
    ...options.targetApp,
    kind,
    name: options.targetApp?.name ?? operationOptions.targetAppName ?? kind,
  };
}

function hasLaunchSpec(spec: WindowsIddVirtualDisplayDriverTargetAppSpec) {
  return Boolean(spec.appUserModelId || spec.appPath || spec.command || spec.processMatch);
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
  return sanitizeId(operationOptions.runId || 'windows-idd-virtual-display-driver');
}

function runDirRef(operationOptions: VirtualDisplayProviderOperationOptions) {
  return `.sciforge/vision-runs/${runIdFor(operationOptions)}`;
}

function outDirFor(options: WindowsIddVirtualDisplayDriverOptions, operationOptions: VirtualDisplayProviderOperationOptions) {
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

function outDirForRunDir(options: WindowsIddVirtualDisplayDriverOptions, runDir: string) {
  return options.outDir ?? join(process.cwd(), runDir);
}

function requiredDriverRef(value: string | string[] | undefined, label: string) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`Windows IDD VirtualDisplayProvider missing ${label}.`);
}

function readyReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders({
    ...(operationOptions.probeOptions ?? {}),
    platform: 'win32',
    targetAppKind: operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic',
    manualRequirementAvailability: {
      ...(operationOptions.probeOptions?.manualRequirementAvailability ?? {}),
      'windows-idd-virtual-display-driver': true,
    },
    permissionGrants: {
      ...(operationOptions.probeOptions?.permissionGrants ?? {}),
      'permission:windows/idd-driver-authorized': true,
    },
  }).selectedReadiness;
  if (!readiness) throw new Error('Windows IDD VirtualDisplayProvider readiness was not available.');
  return { ...readiness, providerId };
}

function blockedReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  blockedReason: string,
): VirtualDisplayReadiness {
  const readiness = readyReadinessFor(operationOptions, providerId);
  const installBlocked = /driver api|not installed|win32 host/i.test(blockedReason);
  return {
    ...readiness,
    readinessStatus: 'blocked',
    installState: installBlocked ? 'installable' : readiness.installState,
    installationStatus: installBlocked ? 'installable' : readiness.installationStatus,
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
  const missingRef = 'permission:windows/idd-driver-authorized';
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
  state: WindowsIddVirtualDisplayDriverState,
): VirtualDisplayReadiness {
  return {
    ...readiness,
    displayIdentity: state.display ? safeRecord(state.display) : readiness.displayIdentity,
    windowIdentity: state.targetWindow ? safeRecord(state.targetWindow) : readiness.windowIdentity,
  };
}

function blockedEvidence(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  readiness: VirtualDisplayReadiness,
  blockedReason: string,
) {
  const readinessStatus: VirtualDisplayReadiness['readinessStatus'] = /permission|authorization/i.test(blockedReason)
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
  deps: WindowsIddVirtualDisplayDriverDependencies,
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
    captureToEncodeMs: 10,
    transportMs: 10,
    decodeToPresentMs: 8,
    endToEndMs: 28,
    frameBytes: 64_000,
    bufferedFrames: 0,
    maxBufferedFrames: 2,
    currentFrameRef,
  } as VirtualDisplayFrameTelemetrySample & { currentFrameRef: string }];
}

async function writeDriverJson(
  deps: WindowsIddVirtualDisplayDriverDependencies,
  outDir: string,
  runDir: string,
  ref: string,
  data: unknown,
) {
  const writer = deps.writeJsonRef ?? writeJsonRef;
  await writer(outDir, runDir, ref, data);
}

async function writeJsonRef(outDir: string, runDir: string, ref: string, data: unknown) {
  const path = localPathForRef(outDir, runDir, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function localPathForRef(outDir: string, runDir: string, ref: string) {
  if (ref.startsWith(`${runDir}/`)) return join(outDir, ref.slice(runDir.length + 1));
  return join(outDir, 'refs', `${sanitizeId(ref)}.json`);
}

function safeRecord(value: unknown): Record<string, unknown> {
  const record = recordLike(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, entry]) => entry === undefined || typeof entry !== 'function')
      .map(([key, entry]) => [key, entry === undefined ? null : entry]),
  );
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

function shortError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

async function resolveMaybe<T>(value: T | Promise<T>): Promise<T> {
  return value;
}
