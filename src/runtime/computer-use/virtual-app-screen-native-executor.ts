import type { VirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import { virtualAppScreenRuntimeCommandRunId } from './virtual-app-screen-command.js';
import {
  isVirtualDisplayReadinessControllable,
  isVirtualDisplaySurfaceTransportDescriptorSafe,
  virtualDisplaySurfaceTransportDescriptorFromRefs,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
  type VirtualDisplaySurfaceTransportDescriptor,
} from './virtual-display-provider.js';
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
  const surfaceTransport = attachedSurfaceTransportDescriptor(options, readiness, attachSurface, readFrame);
  const missing = [
    stringRef(createSession, 'sessionRef') ? undefined : 'createSession.sessionRef',
    stringRef(launchApp, 'targetWindowRef') ? undefined : 'launchApp.targetWindowRef',
    stringRef(attachSurface, 'liveSurfaceRef') ? undefined : 'attachSurface.liveSurfaceRef',
    stringRef(attachSurface, 'frameStreamRef') ? undefined : 'attachSurface.frameStreamRef',
    stringRef(readFrame, 'currentFrameRef') ? undefined : 'readFrame.currentFrameRef',
    surfaceTransport ? undefined : 'surfaceTransport',
    adapterReadinessRef(probe, createSession, attachSurface, readFrame) ? undefined : 'adapterReadinessRef',
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

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: options.executorId,
    providerId: providerId(options, probe),
    refs: {
      currentRunRef: stringRef(createSession, 'currentRunRef') ?? stringRef(probe, 'currentRunRef') ?? `.sciforge/vision-runs/${runId}/current-run.json`,
      sessionRef: stringRef(createSession, 'sessionRef'),
      liveSurfaceRef: stringRef(attachSurface, 'liveSurfaceRef'),
      surfaceTransportRef: surfaceTransport?.surfaceTransportRef,
      frameStreamRef: stringRef(attachSurface, 'frameStreamRef'),
      currentFrameRef: stringRef(readFrame, 'currentFrameRef'),
      frameTransportContractRef: surfaceTransport?.frameTransportContractRef,
      frameTelemetryRef: surfaceTransport?.frameTelemetryRef,
      mediaChannelRef: surfaceTransport?.mediaChannelRef,
      dataChannelRef: surfaceTransport?.dataChannelRef,
      screenRef: command.refs.screenRef ?? stringRef(createSession, 'screenRef') ?? stringRef(attachSurface, 'screenRef'),
      targetAppRef: command.refs.targetAppRef ?? stringRef(createSession, 'targetAppRef') ?? stringRef(launchApp, 'targetAppRef'),
      targetWindowRef: stringRef(launchApp, 'targetWindowRef') ?? stringRef(attachSurface, 'targetWindowRef'),
      displayGroupRef: command.refs.displayGroupRef ?? stringRef(createSession, 'displayGroupRef'),
      inputLeaseRef: stringRef(readFrame, 'inputLeaseRef') ?? stringRef(attachSurface, 'inputLeaseRef'),
      adapterReadinessRef: adapterReadinessRef(probe, createSession, attachSurface, readFrame)!,
      evidenceLedgerRef: evidenceLedgerRef(createSession, launchApp, attachSurface, readFrame),
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
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport,
      evidenceRefs: uniqueRefs([
        stringRef(probe, 'adapterReadinessRef'),
        stringRef(createSession, 'lifecycleEventRef'),
        stringRef(launchApp, 'lifecycleEventRef'),
        stringRef(attachSurface, 'lifecycleEventRef'),
        surfaceTransport?.surfaceTransportRef,
        surfaceTransport?.frameTransportContractRef,
        stringRef(readFrame, 'currentFrameRef'),
        evidenceLedgerRef(createSession, launchApp, attachSurface, readFrame),
        command.refs.guiPresentRef,
      ]),
    },
  };
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

function statusReason(status: VirtualDisplayProviderReadinessStatus) {
  return status === 'permission-missing'
    ? 'permission missing'
    : status === 'blocked'
      ? 'provider blocked'
      : 'provider ready';
}
