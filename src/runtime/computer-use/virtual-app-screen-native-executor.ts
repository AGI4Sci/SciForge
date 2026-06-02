import type { VirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import { virtualAppScreenRuntimeCommandRunId } from './virtual-app-screen-command.js';
import {
  InMemoryNativeVirtualAppScreenHost,
  validateNativeHostEvidenceLedger,
  type NativeHostLiveSurface,
  type NativeHostSurfaceTransport,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';
import {
  buildVirtualDisplaySurfaceTransportDescriptor,
  isVirtualDisplayReadinessControllable,
  isVirtualDisplaySurfaceTransportDescriptorSafe,
  virtualDisplaySurfaceTransportDescriptorFromRefs,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
  type VirtualDisplaySurfaceTransportDescriptor,
  type VirtualDisplayTransport,
} from './virtual-display-provider.js';
import { createVirtualDisplayProviderNativeHostAdapter } from './virtual-app-screen-host-provider-adapter.js';
import { recordVirtualAppScreenNativeHostSession } from './virtual-app-screen-native-host-session-store.js';
import {
  blockedVirtualAppScreenSessionManagerResult,
  registerVirtualAppScreenSessionExecutor,
  VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
  type VirtualAppScreenSessionManagerAttachResult,
  type VirtualAppScreenSessionManagerExecutor,
  type VirtualAppScreenSessionManagerStatus,
} from './virtual-app-screen-session-manager.js';

export interface VirtualAppScreenNativeExecutorOptions {
  executorId: string;
  providerId: string;
  supportedProfiles?: string[];
  provider: VirtualDisplayProviderL1Contract;
  targetAppKind?: string;
  targetAppName?: string;
}

type ProviderOperationName = 'probe' | 'createSession' | 'launchApp' | 'attachSurface' | 'readFrame';

export function createVirtualAppScreenNativeExecutor(
  options: VirtualAppScreenNativeExecutorOptions,
): VirtualAppScreenSessionManagerExecutor {
  return {
    executorId: options.executorId,
    providerId: options.providerId,
    supportedProfiles: options.supportedProfiles?.length ? [...options.supportedProfiles] : ['*'],
    attach: (command) => attachWithNativeProvider(command, options),
  };
}

export function registerVirtualAppScreenNativeExecutor(
  options: VirtualAppScreenNativeExecutorOptions,
): () => void {
  return registerVirtualAppScreenSessionExecutor(createVirtualAppScreenNativeExecutor(options));
}

async function attachWithNativeProvider(
  command: VirtualAppScreenRuntimeCommand,
  options: VirtualAppScreenNativeExecutorOptions,
): Promise<VirtualAppScreenSessionManagerAttachResult> {
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const operationOptions: VirtualDisplayProviderOperationOptions = {
    runId,
    targetAppKind: options.targetAppKind ?? command.profile ?? targetAppKindFromRef(command.refs.targetAppRef),
    targetAppName: options.targetAppName ?? command.profile,
  };
  const probe = await options.provider.probe(operationOptions);
  const readiness = probe.readiness;
  const probeBlocked = blockedOperation(command, options, 'probe', probe, readiness);
  if (probeBlocked) return probeBlocked;

  const createSession = await options.provider.createSession(operationOptions);
  const createBlocked = blockedOperation(command, options, 'createSession', createSession, readiness);
  if (createBlocked) return createBlocked;

  const launchApp = await options.provider.launchApp(operationOptions);
  const launchBlocked = blockedOperation(command, options, 'launchApp', launchApp, readiness);
  if (launchBlocked) return launchBlocked;

  const attachSurface = await options.provider.attachSurface(operationOptions);
  const attachBlocked = blockedOperation(command, options, 'attachSurface', attachSurface, readiness);
  if (attachBlocked) return attachBlocked;

  const readFrame = await options.provider.readFrame(operationOptions);
  const readFrameBlocked = blockedOperation(command, options, 'readFrame', readFrame, readiness);
  if (readFrameBlocked) return readFrameBlocked;

  const unsafeSurfaceTransport = unsafeExplicitSurfaceTransport(attachSurface, readFrame);
  if (unsafeSurfaceTransport) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen native executor rejected unsafe provider surface transport evidence from ${unsafeSurfaceTransport}.`,
    );
  }
  const platformDriverRefForRun = command.refs.platformDriverRef
    ?? platformDriverRef(providerId(options, probe), readiness, probe, createSession, attachSurface, readFrame);
  const surfaceTransport = attachedSurfaceTransportDescriptor(options, readiness, attachSurface, readFrame);
  const missing = [
    stringRef(createSession, 'sessionRef') ? undefined : 'createSession.sessionRef',
    stringRef(launchApp, 'targetWindowRef') ? undefined : 'launchApp.targetWindowRef',
    stringRef(attachSurface, 'liveSurfaceRef') ? undefined : 'attachSurface.liveSurfaceRef',
    stringRef(attachSurface, 'frameStreamRef') ? undefined : 'attachSurface.frameStreamRef',
    stringRef(readFrame, 'currentFrameRef') ? undefined : 'readFrame.currentFrameRef',
    surfaceTransport ? undefined : 'surfaceTransport',
    adapterReadinessRef(probe, createSession, attachSurface, readFrame) ? undefined : 'adapterReadinessRef',
    platformDriverRefForRun ? undefined : 'platformDriverRef',
    evidenceLedgerRef(createSession, launchApp, attachSurface, readFrame) ? undefined : 'evidenceLedgerRef',
    command.refs.guiPresentRef ? undefined : 'guiPresentRef',
  ].filter((entry): entry is string => Boolean(entry));
  if (missing.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen native executor did not materialize required provider refs: ${missing.join(', ')}.`,
    );
  }
  if (!surfaceTransport) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen native executor did not materialize required provider refs: surfaceTransport.',
    );
  }
  const inconsistentChain = validateProviderOperationChain(options, {
    probe,
    createSession,
    launchApp,
    attachSurface,
    readFrame,
    surfaceTransport,
  });
  if (inconsistentChain) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen native provider operation chain was inconsistent: ${inconsistentChain}.`,
    );
  }

  return attachWithNativeHost(command, options, {
    probe,
    createSession,
    launchApp,
    attachSurface,
    readFrame,
    operationOptions,
    surfaceTransport,
    readiness,
    platformDriverRef: platformDriverRefForRun,
  });
}

function attachWithNativeHost(
  command: VirtualAppScreenRuntimeCommand,
  options: VirtualAppScreenNativeExecutorOptions,
  input: {
    probe: VirtualDisplayProviderInvokeResult;
    createSession: VirtualDisplayProviderInvokeResult;
    launchApp: VirtualDisplayProviderInvokeResult;
    attachSurface: VirtualDisplayProviderInvokeResult;
    readFrame: VirtualDisplayProviderInvokeResult;
    operationOptions: VirtualDisplayProviderOperationOptions;
    surfaceTransport: VirtualDisplaySurfaceTransportDescriptor;
    readiness: VirtualDisplayReadiness | undefined;
    platformDriverRef: string | undefined;
  },
): VirtualAppScreenSessionManagerAttachResult {
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const providerIdForRun = providerId(options, input.probe);
  const host = new InMemoryNativeVirtualAppScreenHost(createVirtualDisplayProviderNativeHostAdapter({
    executorId: options.executorId,
    providerId: providerIdForRun,
    lifecycle: {
      probe: input.probe,
      createSession: input.createSession,
      launchApp: input.launchApp,
      attachSurface: input.attachSurface,
      readFrame: input.readFrame,
    },
    provider: options.provider,
    operationOptions: input.operationOptions,
  }));
  const hostSession = host.createSession(
    {
      profileId: command.profile ?? targetAppKindFromRef(command.refs.targetAppRef),
      defaultSurfaceTransport: nativeHostSurfaceTransport(input.surfaceTransport.transport),
      metadata: {
        providerId: providerIdForRun,
        providerSessionRef: stringRef(input.createSession, 'sessionRef'),
        providerLifecycleLedgerRef: stringRef(input.createSession, 'lifecycleLedgerRef'),
      },
    },
    {
      allowBackgroundRendering: true,
      allowSharedSystemInput: false,
      requestedPermissionRefs: input.readiness?.permissionRefs,
      providerReadinessRef: adapterReadinessRef(input.probe, input.createSession, input.attachSurface, input.readFrame),
    },
    {
      currentRunRef: stringRef(input.createSession, 'currentRunRef') ?? stringRef(input.probe, 'currentRunRef') ?? `.sciforge/vision-runs/${runId}/current-run.json`,
      evidenceRootRef: command.refs.evidenceLedgerRef ?? `.sciforge/vision-runs/${runId}/native-virtual-app-screen-host`,
      currentRunPointerRef: stringRef(input.createSession, 'currentRunRef') ?? `.sciforge/vision-runs/${runId}/current-run.json`,
      guiPresentRef: command.refs.guiPresentRef,
    },
  );
  if (hostSession.status !== 'ok') {
    return hostBlockedResult(command, options, hostSession.error.message);
  }

  const launched = host.launchOrAttachApp(hostSession.value.sessionId, {
    appId: targetAppKindFromRef(command.refs.targetAppRef),
    appRef: command.refs.targetAppRef ?? stringRef(input.launchApp, 'targetAppRef') ?? `app:${runId}/generic`,
    title: options.targetAppName ?? command.profile,
    metadata: {
      providerTargetAppRef: stringRef(input.launchApp, 'targetAppRef'),
      providerLifecycleEventRef: stringRef(input.launchApp, 'lifecycleEventRef'),
    },
  });
  if (launched.status !== 'ok') {
    return hostBlockedResult(command, options, launched.error.message);
  }

  const targetWindowRef = stringRef(input.launchApp, 'targetWindowRef') ?? stringRef(input.attachSurface, 'targetWindowRef');
  if (!targetWindowRef) {
    return hostBlockedResult(command, options, 'Native Host could not resolve a provider target window ref.');
  }
  const attached = host.attachSurface(hostSession.value.sessionId, {
    surfaceId: targetAppKindFromRef(command.refs.screenRef),
    screenRef: command.refs.screenRef ?? stringRef(input.attachSurface, 'screenRef') ?? `virtual-app-screen:${runId}/screen`,
    targetWindowRef,
    transport: nativeHostSurfaceTransport(input.surfaceTransport.transport),
  });
  if (attached.status !== 'ok') {
    return hostBlockedResult(command, options, attached.error.message);
  }

  const presented = host.presentSurface(hostSession.value.sessionId, attached.value.liveBindingAttachGrantRef);
  if (presented.status !== 'ok' || !presented.value.ok || !presented.value.validationLedgerEntryRef) {
    return hostBlockedResult(
      command,
      options,
      presented.status === 'ok'
        ? `Native Host grant validation failed: ${presented.value.issues.join(' ')}`
        : presented.error.message,
    );
  }

  const frame = host.readFrame(hostSession.value.sessionId, stringRef(input.readFrame, 'currentFrameRef'));
  if (frame.status !== 'ok') {
    return hostBlockedResult(command, options, frame.error.message);
  }
  const ledger = host.getLedger(hostSession.value.sessionId);
  if (!ledger) {
    return hostBlockedResult(command, options, 'Native Host did not expose an evidence ledger for the attached session.');
  }
  const ledgerValidation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireGrantValidation: true,
  });
  if (!ledgerValidation.ok) {
    return hostBlockedResult(command, options, `Native Host evidence ledger failed validation: ${ledgerValidation.issues.join(' ')}`);
  }

  const hostSurfaceTransport = hostSurfaceTransportDescriptor(providerIdForRun, attached.value, frame.value);
  const readinessRefForRun = adapterReadinessRef(input.probe, input.createSession, input.attachSurface, input.readFrame)!;
  const actionAdapterRefForRun = actionAdapterRef(input.probe, input.createSession, input.attachSurface, input.readFrame);
  recordVirtualAppScreenNativeHostSession({
    host,
    session: hostSession.value,
    surface: attached.value,
    frame: frame.value,
    refs: {
      inputLeaseRef: stringRef(input.readFrame, 'inputLeaseRef') ?? stringRef(input.attachSurface, 'inputLeaseRef'),
      actionAdapterRef: actionAdapterRefForRun,
      adapterReadinessRef: readinessRefForRun,
      evidenceLedgerRef: ledger.ledgerRef,
      grantValidationRef: presented.value.validationLedgerEntryRef,
    },
  });
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: options.executorId,
    providerId: providerIdForRun,
    refs: {
      currentRunRef: hostSession.value.evidenceContext.currentRunRef,
      sessionRef: hostSession.value.sessionRef,
      liveSurfaceRef: attached.value.liveSurfaceRef,
      surfaceTransportRef: attached.value.surfaceTransportRef,
      frameStreamRef: attached.value.frameStreamRef,
      currentFrameRef: frame.value.frameRef,
      frameTransportContractRef: hostSurfaceTransport.frameTransportContractRef,
      frameTelemetryRef: hostSurfaceTransport.frameTelemetryRef,
      mediaChannelRef: hostSurfaceTransport.mediaChannelRef,
      dataChannelRef: hostSurfaceTransport.dataChannelRef,
      providerLifecycleSessionRef: stringRef(input.createSession, 'sessionRef'),
      liveBindingAttachGrantRef: attached.value.liveBindingAttachGrantRef,
      grantValidationRef: presented.value.validationLedgerEntryRef,
      surfaceOwnerRef: attached.value.surfaceOwnerRef,
      displayOwnerRef: attached.value.displayOwnerRef,
      screenRef: attached.value.screenRef,
      targetAppRef: launched.value.app?.appRef ?? command.refs.targetAppRef ?? stringRef(input.createSession, 'targetAppRef') ?? stringRef(input.launchApp, 'targetAppRef'),
      targetWindowRef: attached.value.targetWindowRef,
      displayGroupRef: command.refs.displayGroupRef ?? stringRef(input.createSession, 'displayGroupRef'),
      inputLeaseRef: stringRef(input.readFrame, 'inputLeaseRef') ?? stringRef(input.attachSurface, 'inputLeaseRef'),
      actionAdapterRef: actionAdapterRefForRun,
      adapterReadinessRef: readinessRefForRun,
      platformDriverRef: input.platformDriverRef,
      permissionRef: command.refs.permissionRef ?? permissionRef(input.readiness),
      evidenceLedgerRef: ledger.ledgerRef,
      guiPresentRef: command.refs.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      platformDriverReady: Boolean(input.platformDriverRef),
      permissionRequired: permissionRequired(input.readiness),
      permissionGranted: permissionGranted(input.readiness),
      backgroundRenderable: input.readiness?.backgroundRenderable === true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: hostSurfaceTransport,
      evidenceRefs: uniqueRefs([
        stringRef(input.probe, 'adapterReadinessRef'),
        stringRef(input.createSession, 'lifecycleEventRef'),
        stringRef(input.createSession, 'sessionRef'),
        stringRef(input.launchApp, 'lifecycleEventRef'),
        stringRef(input.attachSurface, 'lifecycleEventRef'),
        input.surfaceTransport.surfaceTransportRef,
        input.surfaceTransport.frameTransportContractRef,
        stringRef(input.readFrame, 'currentFrameRef'),
        actionAdapterRef(input.probe, input.createSession, input.attachSurface, input.readFrame),
        evidenceLedgerRef(input.createSession, input.launchApp, input.attachSurface, input.readFrame),
        ledger.ledgerRef,
        ledger.headSha256 ? `${ledger.ledgerRef}#${ledger.headSha256}` : undefined,
        attached.value.surfaceOwnerRef,
        attached.value.displayOwnerRef,
        attached.value.liveBindingAttachGrantRef,
        presented.value.validationLedgerEntryRef,
        frame.value.frameRef,
        hostSurfaceTransport.surfaceTransportRef,
        hostSurfaceTransport.frameTransportContractRef,
        input.platformDriverRef,
        command.refs.permissionRef ?? permissionRef(input.readiness),
        command.refs.guiPresentRef,
      ]),
    },
  };
}

function hostBlockedResult(
  command: VirtualAppScreenRuntimeCommand,
  options: Pick<VirtualAppScreenNativeExecutorOptions, 'executorId' | 'providerId'>,
  reason: string,
): VirtualAppScreenSessionManagerAttachResult {
  const blocked = blockedVirtualAppScreenSessionManagerResult(command, reason);
  return {
    ...blocked,
    executorId: options.executorId,
    providerId: options.providerId,
  };
}

function hostSurfaceTransportDescriptor(
  providerIdForRun: string,
  surface: NativeHostLiveSurface,
  frame: { frameRef: string; frameSequence: number },
): VirtualDisplaySurfaceTransportDescriptor {
  return buildVirtualDisplaySurfaceTransportDescriptor({
    providerId: providerIdForRun,
    transport: virtualDisplayTransportFromNativeHostSurface(surface.surfaceTransport),
    surfaceTransportRef: surface.surfaceTransportRef,
    liveSurfaceRef: surface.liveSurfaceRef,
    frameStreamRef: surface.frameStreamRef,
    currentFrameRef: frame.frameRef,
    frameTransportContractRef: surface.frameTransportContractRef ?? nativeHostSurfaceRef(surface, 'frame-transport-contract.json'),
    frameTelemetryRef: surface.frameTelemetryRef ?? nativeHostSurfaceRef(surface, 'frame-telemetry.json'),
    mediaChannelRef: surface.mediaChannelRef,
    dataChannelRef: surface.dataChannelRef,
    currentFrameSequence: frame.frameSequence,
  });
}

function nativeHostSurfaceTransport(transport: VirtualDisplayTransport): NativeHostSurfaceTransport {
  return transport === 'webrtc' ? 'webrtc' : 'native-frame-stream';
}

function virtualDisplayTransportFromNativeHostSurface(transport: NativeHostSurfaceTransport): VirtualDisplayTransport {
  return transport === 'webrtc' ? 'webrtc' : 'native-frame-stream';
}

function nativeHostSurfaceRef(surface: NativeHostLiveSurface, leaf: string): string {
  return `computer-use:native-host/surfaces/${targetAppKindFromRef(surface.surfaceId)}/${leaf}`;
}

function blockedOperation(
  command: VirtualAppScreenRuntimeCommand,
  options: VirtualAppScreenNativeExecutorOptions,
  operation: ProviderOperationName,
  result: VirtualDisplayProviderInvokeResult,
  readiness: VirtualDisplayReadiness | undefined,
): VirtualAppScreenSessionManagerAttachResult | undefined {
  if (result.rawPayloadWritten !== false) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen native provider ${operation} returned an inline/raw provider payload, so the product path failed closed.`,
    );
  }
  if (result.status !== 'ready') {
    return providerBlockedResult(
      command,
      options,
      result,
      `${operation} was not ready: ${result.blockedReason ?? statusReason(result.status)}.`,
    );
  }
  if (result.providerExecuted !== true) {
    return providerBlockedResult(
      command,
      options,
      result,
      `${operation} did not provide native provider execution evidence.`,
    );
  }
  const checkedReadiness = result.readiness ?? readiness;
  if (!isVirtualDisplayReadinessControllable(checkedReadiness)) {
    return providerBlockedResult(
      command,
      options,
      result,
      `${operation} did not prove isolated controllable VirtualDisplay readiness.`,
    );
  }
  return undefined;
}

function providerBlockedResult(
  command: VirtualAppScreenRuntimeCommand,
  options: VirtualAppScreenNativeExecutorOptions,
  result: VirtualDisplayProviderInvokeResult,
  reason: string,
): VirtualAppScreenSessionManagerAttachResult {
  const blocked = blockedVirtualAppScreenSessionManagerResult(command, reason);
  return {
    ...blocked,
    status: statusFromProviderResult(result),
    executorId: options.executorId,
    providerId: providerId(options, result),
    refs: {
      ...blocked.refs,
      currentRunRef: stringRef(result, 'currentRunRef') ?? blocked.refs.currentRunRef,
      adapterReadinessRef: stringRef(result, 'adapterReadinessRef') ?? blocked.refs.adapterReadinessRef,
      blockedRef: stringRef(result, 'blockedRef') ?? blocked.refs.blockedRef,
    },
    evidence: {
      ...blocked.evidence,
      evidenceRefs: uniqueRefs([
        ...blocked.evidence.evidenceRefs,
        stringRef(result, 'adapterReadinessRef'),
        stringRef(result, 'blockedRef'),
      ]),
    },
  };
}

function statusFromProviderResult(result: VirtualDisplayProviderInvokeResult): VirtualAppScreenSessionManagerStatus {
  if (result.status === 'permission-missing') return 'permission-missing';
  if (!result.providerId) return 'adapter-unavailable';
  return 'blocked';
}

function providerId(
  options: Pick<VirtualAppScreenNativeExecutorOptions, 'providerId'>,
  result: VirtualDisplayProviderInvokeResult,
) {
  return result.providerId ?? options.providerId;
}

function adapterReadinessRef(...results: VirtualDisplayProviderInvokeResult[]) {
  return firstRef(results, 'adapterReadinessRef');
}

function evidenceLedgerRef(...results: VirtualDisplayProviderInvokeResult[]) {
  return firstRef([...results].reverse(), 'evidenceLedgerRef');
}

function actionAdapterRef(...results: VirtualDisplayProviderInvokeResult[]) {
  return firstRef([...results].reverse(), 'actionAdapterRef');
}

function platformDriverRef(
  providerIdForRun: string,
  readiness: VirtualDisplayReadiness | undefined,
  ...results: VirtualDisplayProviderInvokeResult[]
) {
  return firstRef([...results].reverse(), 'platformDriverRef')
    ?? firstRef([...results].reverse(), 'driverRef')
    ?? (
      isVirtualDisplayReadinessControllable(readiness)
        ? `computer-use:native-host/platform-drivers/${safeRefSegment(providerIdForRun)}/ready.json`
        : undefined
    );
}

function permissionRef(readiness: VirtualDisplayReadiness | undefined) {
  return readiness?.permissions.grantedRefs[0] ?? readiness?.permissions.requiredRefs[0];
}

function permissionRequired(readiness: VirtualDisplayReadiness | undefined) {
  return Boolean(readiness?.permissions.requiredRefs.length);
}

function permissionGranted(readiness: VirtualDisplayReadiness | undefined) {
  return readiness?.permissions.state === 'granted'
    || readiness?.permissions.state === 'not-required';
}

function unsafeExplicitSurfaceTransport(...results: VirtualDisplayProviderInvokeResult[]) {
  for (const result of results) {
    if (result.surfaceTransport !== undefined && !isVirtualDisplaySurfaceTransportDescriptorSafe(result.surfaceTransport)) {
      return `${result.intent}.surfaceTransport`;
    }
  }
  return undefined;
}

function attachedSurfaceTransportDescriptor(
  options: Pick<VirtualAppScreenNativeExecutorOptions, 'providerId'>,
  readiness: VirtualDisplayReadiness | undefined,
  attachSurface: VirtualDisplayProviderInvokeResult,
  readFrame: VirtualDisplayProviderInvokeResult,
): VirtualDisplaySurfaceTransportDescriptor | undefined {
  if (isVirtualDisplaySurfaceTransportDescriptorSafe(readFrame.surfaceTransport)) {
    return readFrame.surfaceTransport;
  }
  if (isVirtualDisplaySurfaceTransportDescriptorSafe(attachSurface.surfaceTransport)) {
    return attachSurface.surfaceTransport;
  }
  return virtualDisplaySurfaceTransportDescriptorFromRefs({
    providerId: providerId(options, readFrame),
    readiness: readFrame.readiness ?? attachSurface.readiness ?? readiness,
    refs: readFrame.refs,
    fallbackRefs: [attachSurface.refs],
  });
}

function validateProviderOperationChain(
  options: Pick<VirtualAppScreenNativeExecutorOptions, 'providerId'>,
  input: {
    probe: VirtualDisplayProviderInvokeResult;
    createSession: VirtualDisplayProviderInvokeResult;
    launchApp: VirtualDisplayProviderInvokeResult;
    attachSurface: VirtualDisplayProviderInvokeResult;
    readFrame: VirtualDisplayProviderInvokeResult;
    surfaceTransport: VirtualDisplaySurfaceTransportDescriptor;
  },
) {
  const expectedProviderId = providerId(options, input.probe);
  for (const result of [input.probe, input.createSession, input.launchApp, input.attachSurface, input.readFrame]) {
    if (result.providerId && result.providerId !== expectedProviderId) {
      return `${result.intent}.providerId did not match probe.providerId`;
    }
  }

  const currentRunRef = stringRef(input.createSession, 'currentRunRef') ?? stringRef(input.probe, 'currentRunRef');
  if (!currentRunRef) return 'createSession.currentRunRef was missing';
  for (const operation of ['createSession', 'launchApp', 'attachSurface', 'readFrame'] as const) {
    const mismatch = requireMatchingRef(input[operation], operation, 'currentRunRef', currentRunRef, 'createSession.currentRunRef');
    if (mismatch) return mismatch;
  }

  const sessionRef = stringRef(input.createSession, 'sessionRef');
  if (!sessionRef) return 'createSession.sessionRef was missing';
  for (const operation of ['launchApp', 'attachSurface', 'readFrame'] as const) {
    const mismatch = requireMatchingRef(input[operation], operation, 'sessionRef', sessionRef, 'createSession.sessionRef');
    if (mismatch) return mismatch;
  }

  const targetWindowRef = stringRef(input.launchApp, 'targetWindowRef');
  if (!targetWindowRef) return 'launchApp.targetWindowRef was missing';
  for (const operation of ['attachSurface', 'readFrame'] as const) {
    const mismatch = requireMatchingRef(input[operation], operation, 'targetWindowRef', targetWindowRef, 'launchApp.targetWindowRef');
    if (mismatch) return mismatch;
  }

  const liveSurfaceRef = stringRef(input.attachSurface, 'liveSurfaceRef');
  if (!liveSurfaceRef) return 'attachSurface.liveSurfaceRef was missing';
  const readLiveSurfaceMismatch = requireMatchingRef(input.readFrame, 'readFrame', 'liveSurfaceRef', liveSurfaceRef, 'attachSurface.liveSurfaceRef');
  if (readLiveSurfaceMismatch) return readLiveSurfaceMismatch;

  const frameStreamRef = stringRef(input.attachSurface, 'frameStreamRef');
  if (!frameStreamRef) return 'attachSurface.frameStreamRef was missing';
  const readFrameStreamMismatch = requireMatchingRef(input.readFrame, 'readFrame', 'frameStreamRef', frameStreamRef, 'attachSurface.frameStreamRef');
  if (readFrameStreamMismatch) return readFrameStreamMismatch;

  for (const key of ['surfaceTransportRef', 'frameTransportContractRef'] as const) {
    const expected = stringRef(input.attachSurface, key);
    if (!expected) return `attachSurface.${key} was missing`;
    const mismatch = requireMatchingRef(input.readFrame, 'readFrame', key, expected, `attachSurface.${key}`);
    if (mismatch) return mismatch;
  }

  const evidenceLedgerRef = stringRef(input.createSession, 'evidenceLedgerRef');
  if (!evidenceLedgerRef) return 'createSession.evidenceLedgerRef was missing';
  for (const operation of ['launchApp', 'attachSurface', 'readFrame'] as const) {
    const mismatch = requireMatchingRef(input[operation], operation, 'evidenceLedgerRef', evidenceLedgerRef, 'createSession.evidenceLedgerRef');
    if (mismatch) return mismatch;
  }

  const readFrameCurrentFrameRef = stringRef(input.readFrame, 'currentFrameRef');
  if (!readFrameCurrentFrameRef) return 'readFrame.currentFrameRef was missing';
  const descriptorMismatch = requireSurfaceTransportDescriptorConsistency(input.surfaceTransport, {
    providerId: expectedProviderId,
    liveSurfaceRef,
    frameStreamRef,
    currentFrameRef: readFrameCurrentFrameRef,
    surfaceTransportRef: stringRef(input.attachSurface, 'surfaceTransportRef')!,
    frameTransportContractRef: stringRef(input.attachSurface, 'frameTransportContractRef')!,
  });
  if (descriptorMismatch) return descriptorMismatch;

  const attachSequence = nonNegativeSequence(input.attachSurface);
  const readSequence = nonNegativeSequence(input.readFrame);
  if (readSequence === undefined) return 'readFrame.currentFrameSequence was missing or invalid';
  if (attachSequence !== undefined && readSequence < attachSequence) {
    return 'readFrame.currentFrameSequence moved backwards from attachSurface.currentFrameSequence';
  }

  return undefined;
}

function requireMatchingRef(
  result: VirtualDisplayProviderInvokeResult,
  operation: ProviderOperationName,
  key: string,
  expected: string,
  expectedLabel: string,
) {
  const value = stringRef(result, key);
  if (!value) return `${operation}.${key} was missing`;
  if (value !== expected) return `${operation}.${key} did not match ${expectedLabel}`;
  return undefined;
}

function requireSurfaceTransportDescriptorConsistency(
  descriptor: VirtualDisplaySurfaceTransportDescriptor,
  expected: {
    providerId: string;
    liveSurfaceRef: string;
    frameStreamRef: string;
    currentFrameRef: string;
    surfaceTransportRef: string;
    frameTransportContractRef: string;
  },
) {
  for (const key of [
    'providerId',
    'liveSurfaceRef',
    'frameStreamRef',
    'currentFrameRef',
    'surfaceTransportRef',
    'frameTransportContractRef',
  ] as const) {
    if (descriptor[key] !== expected[key]) return `surfaceTransport.${key} did not match provider operation refs`;
  }
  return undefined;
}

function nonNegativeSequence(result: VirtualDisplayProviderInvokeResult) {
  const raw = stringRef(result, 'currentFrameSequence');
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstRef(results: VirtualDisplayProviderInvokeResult[], key: string) {
  for (const result of results) {
    const ref = stringRef(result, key);
    if (ref) return ref;
  }
  return undefined;
}

function stringRef(result: VirtualDisplayProviderInvokeResult, key: string) {
  const value = result.refs[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function uniqueRefs(refs: Array<string | undefined>) {
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref?.trim())))];
}

function targetAppKindFromRef(targetAppRef: string | undefined) {
  return targetAppRef?.split('/').filter(Boolean).at(-1) ?? 'generic';
}

function safeRefSegment(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'provider';
}

function statusReason(status: VirtualDisplayProviderReadinessStatus) {
  return status === 'permission-missing'
    ? 'permission missing'
    : status === 'blocked'
      ? 'provider blocked'
      : 'provider ready';
}
