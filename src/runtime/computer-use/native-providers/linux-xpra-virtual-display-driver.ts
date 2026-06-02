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
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
  type LinuxXpraVirtualDisplayOperationEvidence,
  type LinuxXpraVirtualDisplayProviderHooks,
} from './linux-xpra-virtual-display-provider.js';
import {
  missingNativeDriverInputControlRefs,
  nativeDriverInputIntentProjection,
  type NativeVirtualDisplayDriverInputControlHook,
  type NativeVirtualDisplayDriverInputControlOperation,
} from './native-driver-input-control.js';
import {
  captureLinuxXpraSessionFrame,
  commandExists,
  launchLinuxXpraApp,
  probeLinuxXpraInputIsolation,
  shortError,
  sleep,
  startLinuxXpraSession,
  waitForLinuxXpraWindow,
  writeJsonRef,
  xpraDisplayForRunId,
  type LinuxXpraFrameCapture,
  type LinuxXpraInputIsolationProbe,
  type LinuxXpraLaunchResult,
  type LinuxXpraSessionHandle,
  type LinuxXpraTargetAppSpec,
  type LinuxXpraWindowInventoryEntry,
} from './linux-xpra-driver-helpers.js';

export interface LinuxXpraVirtualDisplayDriverTargetAppSpec extends LinuxXpraTargetAppSpec {}

export interface LinuxXpraVirtualDisplayDriverDependencies {
  commandExists?: (command: string, options: VirtualDisplayProviderOperationOptions['probeOptions']) => boolean | Promise<boolean>;
  probeInputIsolation?: () => boolean | LinuxXpraInputIsolationProbe | Promise<boolean | LinuxXpraInputIsolationProbe>;
  probeFrameCapture?: () => boolean | LinuxXpraInputIsolationProbe | Promise<boolean | LinuxXpraInputIsolationProbe>;
  startSession?: (input: {
    sessionId: string;
    display: string;
    width: number;
    height: number;
    targetApp: LinuxXpraVirtualDisplayDriverTargetAppSpec;
  }) => LinuxXpraSessionHandle | Promise<LinuxXpraSessionHandle>;
  launchApp?: (
    session: LinuxXpraSessionHandle,
    spec: LinuxXpraVirtualDisplayDriverTargetAppSpec,
    options: VirtualDisplayProviderOperationOptions,
  ) => LinuxXpraLaunchResult | Promise<LinuxXpraLaunchResult>;
  waitForTargetWindow?: (input: {
    session: LinuxXpraSessionHandle;
    pids: number[];
    spec: LinuxXpraVirtualDisplayDriverTargetAppSpec;
    timeoutMs: number;
  }) => LinuxXpraWindowInventoryEntry | undefined | Promise<LinuxXpraWindowInventoryEntry | undefined>;
  captureSessionFrame?: (input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    session: LinuxXpraSessionHandle;
    providerId: string;
  }) => LinuxXpraFrameCapture | Promise<LinuxXpraFrameCapture>;
  sendInputIntent?: NativeVirtualDisplayDriverInputControlHook;
  pauseAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  resumeAgentQueue?: NativeVirtualDisplayDriverInputControlHook;
  safeStopSession?: NativeVirtualDisplayDriverInputControlHook;
  writeJsonRef?: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LinuxXpraVirtualDisplayDriverOptions {
  providerId?: string;
  targetApp?: LinuxXpraVirtualDisplayDriverTargetAppSpec;
  session?: {
    display?: string;
    width?: number;
    height?: number;
    name?: string;
  };
  outDir?: string;
  windowTimeoutMs?: number;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
  dependencies?: LinuxXpraVirtualDisplayDriverDependencies;
}

interface LinuxXpraVirtualDisplayDriverState {
  session?: LinuxXpraSessionHandle;
  launch?: LinuxXpraLaunchResult;
  targetWindow?: LinuxXpraWindowInventoryEntry;
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

export function createLinuxXpraVirtualDisplayDriverHooks(
  options: LinuxXpraVirtualDisplayDriverOptions = {},
): LinuxXpraVirtualDisplayProviderHooks {
  const providerId = options.providerId ?? LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID;
  const deps = options.dependencies ?? {};
  const state: LinuxXpraVirtualDisplayDriverState = { frameSequence: 0 };
  return {
    probe: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'probe', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const probe = await probeDriverReadiness(effectiveOptions, providerId, deps);
      const refs = probeRefsFor(effectiveOptions, providerId);
      const adapterReadinessRef = requiredDriverRef(refs.adapterReadinessRef, 'adapterReadinessRef');
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), adapterReadinessRef, {
        schemaVersion: 'sciforge.virtual-display.linux-xpra.adapter-readiness.v1',
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
      if (probe.blockedReason) return blockedEvidence(effectiveOptions, providerId, probe.readiness, probe.blockedReason);
      const refs = refsFor(effectiveOptions, providerId);
      state.refs = refs;
      const spec = targetAppSpecFor(effectiveOptions, options);
      const session = await startDriverSession(effectiveOptions, options, spec, deps);
      state.session = session;
      await writeSessionRecords(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs, providerId, readinessWithRuntimeIdentity(probe.readiness, state), session, spec);
      return {
        refs: {
          ...refs,
          targetWindowRef: undefined,
          liveSurfaceRef: undefined,
          currentFrameRef: undefined,
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#createSession`,
        },
        readiness: readinessWithRuntimeIdentity(probe.readiness, state),
      };
    }),
    launchApp: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'launchApp', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const refs = state.refs ?? refsFor(effectiveOptions, providerId);
      const readiness = readinessWithRuntimeIdentity(readyReadinessFor(effectiveOptions, providerId), state);
      if (!state.session) return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider launchApp requires a created Xpra app session.');
      const spec = targetAppSpecFor(effectiveOptions, options);
      if (!spec.command) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider launchApp requires an explicit generic target app command.');
      }
      const launch = await launchDriverApp(state.session, spec, effectiveOptions, deps);
      state.launch = launch;
      const targetWindow = await waitForDriverWindow({
        session: state.session,
        pids: launch.pids,
        spec,
        timeoutMs: options.windowTimeoutMs ?? 15000,
      }, deps);
      if (!targetWindow) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider launchApp could not find a target app window in the Xpra session.');
      }
      state.targetWindow = targetWindow;
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.targetWindowRef, {
        schemaVersion: 'sciforge.virtual-display.linux-xpra.target-window.v1',
        providerId,
        targetWindowRef: refs.targetWindowRef,
        targetAppRef: refs.targetAppRef,
        sessionRef: refs.sessionRef,
        pids: launch.pids,
        xpraWindow: targetWindow,
        launchDetails: launch.details,
        currentRunOnly: true,
      });
      return {
        refs: {
          ...refs,
          liveSurfaceRef: undefined,
          currentFrameRef: undefined,
          lifecycleEventRef: `${refs.lifecycleLedgerRef}#launchApp`,
        },
        readiness: readinessWithRuntimeIdentity(readiness, state),
      };
    }),
    attachSurface: (operationOptions) => withProviderEvidence(providerId, operationOptions, 'attachSurface', async () => {
      const effectiveOptions = driverOperationOptions(operationOptions, options);
      const refs = state.refs ?? refsFor(effectiveOptions, providerId);
      const readiness = readinessWithRuntimeIdentity(readyReadinessFor(effectiveOptions, providerId), state);
      if (!state.session || !state.targetWindow) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider attachSurface requires a session and target window.');
      }
      if (!isWindowInsideSession(state.targetWindow, state.session)) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider attachSurface could not prove the target window belongs to the Xpra app session bounds.');
      }
      const transportRecords = transportRecordsFor(refs, providerId, readiness, state.frameSequence);
      await writeTransportRecords(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs, transportRecords, readiness);
      await writeDriverJson(deps, outDirFor(options, effectiveOptions), runDirRef(effectiveOptions), refs.liveSurfaceRef, {
        schemaVersion: 'sciforge.virtual-display.linux-xpra.live-surface.v1',
        providerId,
        liveSurfaceRef: refs.liveSurfaceRef,
        frameStreamRef: refs.frameStreamRef,
        surfaceTransportRef: refs.surfaceTransportRef,
        targetWindowRef: refs.targetWindowRef,
        sessionRef: refs.sessionRef,
        xpraDisplay: state.session.display,
        xpraWindow: state.targetWindow,
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
      if (!state.session) {
        return blockedEvidence(effectiveOptions, providerId, readiness, 'Linux Xpra VirtualDisplayProvider readFrame requires a created Xpra app session.');
      }
      let capture: LinuxXpraFrameCapture;
      try {
        capture = await captureDriverFrame({
          outDir: currentOutDir,
          runDirRef: currentRunDirRef,
          phase: 'current',
          session: state.session,
          providerId,
        }, deps);
        if (!capture.frameRef || !capture.screenshotRef) throw new Error('capture did not return frame and screenshot refs');
      } catch (error) {
        return blockedEvidence(effectiveOptions, providerId, readiness, `Linux Xpra VirtualDisplayProvider readFrame capture failed: ${shortError(error)}.`);
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
  options: LinuxXpraVirtualDisplayDriverOptions;
  deps: LinuxXpraVirtualDisplayDriverDependencies;
  providerId: string;
  state: LinuxXpraVirtualDisplayDriverState;
  hook?: NativeVirtualDisplayDriverInputControlHook;
}) {
  const effectiveOptions = driverOperationOptions(input.operationOptions, input.options);
  const probe = await probeDriverReadiness(effectiveOptions, input.providerId, input.deps);
  const readiness = readinessWithRuntimeIdentity(probe.readiness, input.state);
  if (probe.blockedReason) return blockedEvidence(effectiveOptions, input.providerId, readiness, probe.blockedReason);
  if (!input.state.session || !input.state.targetWindow) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} requires an attached Xpra app session and target window.`,
    );
  }
  if (!input.hook) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} isolated input/control hook is not registered.`,
    );
  }

  const refs = input.state.refs;
  if (!refs) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} requires current attached session refs.`,
    );
  }
  const inputIntent = nativeDriverInputIntentProjection(effectiveOptions);
  if (typeof inputIntent.sessionRef === 'string' && inputIntent.sessionRef !== refs.sessionRef) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} input sessionRef does not match the attached provider session.`,
    );
  }
  const result = await input.hook({
    providerId: input.providerId,
    operation: input.operation,
    operationOptions: effectiveOptions,
    inputIntent,
    refs,
    platformState: {
      session: input.state.session,
      targetWindow: input.state.targetWindow,
      frameSequence: input.state.frameSequence,
    },
  });
  if (!result.ok) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} hook did not complete${result.detail ? `: ${result.detail}` : ''}.`,
    );
  }
  if (result.mutatingActionExecuted !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} hook did not prove mutatingActionExecuted=true.`,
    );
  }
  if (result.providerEvidenceWritten !== true) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} hook did not prove providerEvidenceWritten=true.`,
    );
  }

  const missingRefs = missingNativeDriverInputControlRefs(input.operation, result.refs);
  if (missingRefs.length) {
    return blockedEvidence(
      effectiveOptions,
      input.providerId,
      readiness,
      `Linux Xpra VirtualDisplayProvider ${input.operation} hook did not return required provider-owned evidence refs: ${missingRefs.join(', ')}.`,
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
): Promise<LinuxXpraVirtualDisplayOperationEvidence> {
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
    const blockedReason = `Linux Xpra VirtualDisplayProvider ${operation} failed: ${shortError(error)}.`;
    return {
      providerExecuted: true,
      providerId,
      refs: refsFor(operationOptions, providerId),
      readiness: blockedReadinessFor(operationOptions, providerId, blockedReason),
      blockedReason,
      mutatingActionExecuted: false,
    };
  }
}

function driverOperationOptions(
  operationOptions: VirtualDisplayProviderOperationOptions,
  driverOptions: LinuxXpraVirtualDisplayDriverOptions,
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
  deps: LinuxXpraVirtualDisplayDriverDependencies,
) {
  const hasXpra = await resolveMaybe((deps.commandExists ?? commandExists)('xpra', operationOptions.probeOptions));
  if (!hasXpra) {
    const blockedReason = 'xpra command is not available for the Linux Xpra VirtualDisplayProvider driver.';
    return {
      readiness: blockedReadinessFor(operationOptions, providerId, blockedReason),
      blockedReason,
    };
  }
  const captureProbe = await probeDriverCapability(deps.probeFrameCapture?.() ?? true);
  if (!captureProbe.ok) {
    const blockedReason = `Linux Xpra frame capture is not proven for the VirtualDisplayProvider driver${captureProbe.detail ? `: ${captureProbe.detail}` : ''}.`;
    return {
      readiness: blockedReadinessFor(operationOptions, providerId, blockedReason),
      blockedReason,
    };
  }
  const inputProbe = await probeDriverCapability(deps.probeInputIsolation ? deps.probeInputIsolation() : probeLinuxXpraInputIsolation());
  if (!inputProbe.ok) {
    const blockedReason = `Linux Xpra isolated input adapter is not proven for the VirtualDisplayProvider driver${inputProbe.detail ? `: ${inputProbe.detail}` : ''}.`;
    return {
      readiness: blockedReadinessFor(operationOptions, providerId, blockedReason),
      blockedReason,
    };
  }
  return {
    readiness: readyReadinessFor(operationOptions, providerId),
    blockedReason: undefined,
  };
}

async function probeDriverCapability(value: boolean | LinuxXpraInputIsolationProbe | Promise<boolean | LinuxXpraInputIsolationProbe>) {
  const result = await resolveMaybe(value);
  if (typeof result === 'boolean') return { ok: result };
  return result;
}

async function startDriverSession(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: LinuxXpraVirtualDisplayDriverOptions,
  targetApp: LinuxXpraVirtualDisplayDriverTargetAppSpec,
  deps: LinuxXpraVirtualDisplayDriverDependencies,
) {
  const runId = runIdFor(operationOptions);
  const width = Math.max(640, Math.round(options.session?.width ?? 1440));
  const height = Math.max(480, Math.round(options.session?.height ?? 900));
  const sessionId = sanitizeId(options.session?.name ?? `sciforge-${runId}`);
  const display = options.session?.display ?? xpraDisplayForRunId(runId);
  if (deps.startSession) return deps.startSession({ sessionId, display, width, height, targetApp });
  return startLinuxXpraSession({ sessionId, display, width, height });
}

async function launchDriverApp(
  session: LinuxXpraSessionHandle,
  spec: LinuxXpraVirtualDisplayDriverTargetAppSpec,
  operationOptions: VirtualDisplayProviderOperationOptions,
  deps: LinuxXpraVirtualDisplayDriverDependencies,
) {
  if (deps.launchApp) return deps.launchApp(session, spec, operationOptions);
  return launchLinuxXpraApp({ session, spec });
}

async function waitForDriverWindow(
  input: {
    session: LinuxXpraSessionHandle;
    pids: number[];
    spec: LinuxXpraVirtualDisplayDriverTargetAppSpec;
    timeoutMs: number;
  },
  deps: LinuxXpraVirtualDisplayDriverDependencies,
) {
  if (deps.waitForTargetWindow) return deps.waitForTargetWindow(input);
  return waitForLinuxXpraWindow(input, {
    sleep: deps.sleep ?? sleep,
  });
}

async function captureDriverFrame(
  input: {
    outDir: string;
    runDirRef: string;
    phase: string;
    session: LinuxXpraSessionHandle;
    providerId: string;
  },
  deps: LinuxXpraVirtualDisplayDriverDependencies,
) {
  if (deps.captureSessionFrame) return deps.captureSessionFrame(input);
  return captureLinuxXpraSessionFrame(input);
}

function targetAppSpecFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: LinuxXpraVirtualDisplayDriverOptions,
): LinuxXpraVirtualDisplayDriverTargetAppSpec {
  const kind = operationOptions.targetAppKind ?? options.targetApp?.kind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic';
  return {
    ...options.targetApp,
    kind,
    name: options.targetApp?.name ?? operationOptions.targetAppName ?? kind,
  };
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
  return sanitizeId(operationOptions.runId || 'linux-xpra-virtual-display-driver');
}

function runDirRef(operationOptions: VirtualDisplayProviderOperationOptions) {
  return `.sciforge/vision-runs/${runIdFor(operationOptions)}`;
}

function outDirFor(options: LinuxXpraVirtualDisplayDriverOptions, operationOptions: VirtualDisplayProviderOperationOptions) {
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

function outDirForRunDir(options: LinuxXpraVirtualDisplayDriverOptions, runDir: string) {
  return options.outDir ?? join(process.cwd(), runDir);
}

function requiredDriverRef(value: string | string[] | undefined, label: string) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`Linux Xpra VirtualDisplayProvider missing ${label}.`);
}

function readyReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
): VirtualDisplayReadiness {
  const readiness = probeVirtualDisplayProviders({
    ...(operationOptions.probeOptions ?? {}),
    platform: 'linux',
    targetAppKind: operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic',
    commandAvailability: {
      ...(operationOptions.probeOptions?.commandAvailability ?? {}),
      xpra: true,
    },
  }).selectedReadiness;
  if (!readiness) throw new Error('Linux Xpra VirtualDisplayProvider readiness was not available.');
  return { ...readiness, providerId };
}

function blockedReadinessFor(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  blockedReason: string,
): VirtualDisplayReadiness {
  const readiness = readyReadinessFor(operationOptions, providerId);
  const missingXpra = /\bxpra\b/i.test(blockedReason);
  return {
    ...readiness,
    readinessStatus: 'blocked',
    installState: missingXpra ? 'installable' : readiness.installState,
    installationStatus: missingXpra ? 'installable' : readiness.installationStatus,
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
  state: LinuxXpraVirtualDisplayDriverState,
): VirtualDisplayReadiness {
  return {
    ...readiness,
    appIdentity: state.launch ? { pids: state.launch.pids, details: state.launch.details } : readiness.appIdentity,
    displayIdentity: state.session
      ? {
        sessionId: state.session.sessionId,
        display: state.session.display,
        width: state.session.width,
        height: state.session.height,
      }
      : readiness.displayIdentity,
    windowIdentity: state.targetWindow ? { xpraWindow: state.targetWindow } : readiness.windowIdentity,
  };
}

function blockedEvidence(
  operationOptions: VirtualDisplayProviderOperationOptions,
  providerId: string,
  readiness: VirtualDisplayReadiness,
  blockedReason: string,
) {
  return {
    refs: refsFor(operationOptions, providerId),
    readiness: {
      ...readiness,
      readinessStatus: 'blocked' as const,
      blockedReason,
    },
    blockedReason,
  };
}

async function writeSessionRecords(
  deps: LinuxXpraVirtualDisplayDriverDependencies,
  outDir: string,
  runDir: string,
  refs: DriverRefs,
  providerId: string,
  readiness: VirtualDisplayReadiness,
  session: LinuxXpraSessionHandle,
  targetApp: LinuxXpraVirtualDisplayDriverTargetAppSpec,
) {
  await writeDriverJson(deps, outDir, runDir, refs.sessionRef, {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.session.v1',
    providerId,
    sessionRef: refs.sessionRef,
    sessionLeaseRef: refs.sessionLeaseRef,
    displayGroupRef: refs.displayGroupRef,
    screenRef: refs.screenRef,
    targetAppRef: refs.targetAppRef,
    xpraSession: safeRecord(session),
    targetApp: safeRecord(targetApp),
    currentRunOnly: true,
  });
  await writeDriverJson(deps, outDir, runDir, refs.displayRef, {
    schemaVersion: 'sciforge.virtual-display.linux-xpra.display.v1',
    providerId,
    displayRef: refs.displayRef,
    sessionRef: refs.sessionRef,
    xpraDisplay: session.display,
    width: session.width,
    height: session.height,
    currentRunOnly: true,
  });
  await writeDriverJson(deps, outDir, runDir, refs.adapterReadinessRef, virtualDisplayReadinessToAdapterReadiness(readiness));
  await writeDriverJson(deps, outDir, runDir, refs.inputLeaseRef, {
    schemaVersion: 'sciforge.virtual-display.input-lease.v1',
    providerId,
    inputLeaseRef: refs.inputLeaseRef,
    sessionRef: refs.sessionRef,
    owner: 'agent',
    currentRunOnly: true,
  });
  await writeDriverJson(deps, outDir, runDir, refs.actionAdapterRef, {
    schemaVersion: 'sciforge.virtual-display.action-adapter.v1',
    providerId,
    actionAdapterRef: refs.actionAdapterRef,
    backendKind: readiness.backendKind,
    inputAdapters: readiness.inputIsolation.inputAdapterRefs,
    currentRunOnly: true,
  });
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
  deps: LinuxXpraVirtualDisplayDriverDependencies,
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
    transportMs: 9,
    decodeToPresentMs: 7,
    endToEndMs: 26,
    frameBytes: 64_000,
    bufferedFrames: 0,
    maxBufferedFrames: 2,
    currentFrameRef,
  } as VirtualDisplayFrameTelemetrySample & { currentFrameRef: string }];
}

async function writeDriverJson(
  deps: LinuxXpraVirtualDisplayDriverDependencies,
  outDir: string,
  runDir: string,
  ref: string,
  data: unknown,
) {
  const writer = deps.writeJsonRef ?? writeJsonRef;
  await writer(outDir, runDir, ref, data);
}

function isWindowInsideSession(window: LinuxXpraWindowInventoryEntry, session: LinuxXpraSessionHandle) {
  return window.x >= -8
    && window.y >= -8
    && window.width > 0
    && window.height > 0
    && window.x + Math.min(window.width, 80) <= session.width + 8
    && window.y + Math.min(window.height, 80) <= session.height + 8;
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

async function resolveMaybe<T>(value: T | Promise<T>): Promise<T> {
  return value;
}
