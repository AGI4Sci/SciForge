import { sanitizeId } from './utils.js';
import type { VirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import {
  buildVirtualDisplaySurfaceTransportDescriptor,
  isVirtualDisplaySurfaceTransportDescriptorSafe,
  type VirtualDisplaySurfaceTransportDescriptor,
} from './virtual-display-provider.js';
import {
  virtualAppScreenRuntimeCommandBlockedReason,
  virtualAppScreenRuntimeCommandVirtualScreenData,
} from './virtual-app-screen-command.js';
import {
  revalidateVirtualAppScreenProviderSession,
  recordVirtualAppScreenProviderSession,
  type VirtualAppScreenProviderSessionReconnectReason,
} from './virtual-app-screen-provider-session-store.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
} from './virtual-app-screen-native-host-session-store.js';
import type {
  NativeHostLedgerEntry,
  NativeHostResult,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

export const VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-session-manager.v1' as const;

export type VirtualAppScreenSessionManagerStatus =
  | 'attached'
  | 'blocked'
  | 'permission-missing'
  | 'adapter-unavailable'
  | 'requires-handoff';

export interface VirtualAppScreenSessionManagerExecutor {
  readonly executorId: string;
  readonly providerId: string;
  readonly supportedProfiles: string[];
  attach(command: VirtualAppScreenRuntimeCommand): Promise<VirtualAppScreenSessionManagerAttachResult> | VirtualAppScreenSessionManagerAttachResult;
}

export interface VirtualAppScreenSessionManagerAttachResult {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA;
  status: VirtualAppScreenSessionManagerStatus;
  executorId: string;
  providerId: string;
  refs: VirtualAppScreenSessionManagerRefs;
  evidence: VirtualAppScreenSessionManagerEvidence;
  blockedReason?: string;
}

export interface VirtualAppScreenSessionManagerRefs {
  currentRunRef: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  frameTransportContractRef?: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  providerSessionOwnerRef?: string;
  providerSessionReconnectRef?: string;
  providerLifecycleSessionRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  displayGroupRef?: string;
  inputLeaseRef?: string;
  actionAdapterRef?: string;
  adapterReadinessRef: string;
  platformDriverRef?: string;
  permissionRef?: string;
  evidenceLedgerRef?: string;
  hostEvidenceLedgerRef?: string;
  permissionHandoffLedgerEntryRef?: string;
  permissionRecheckLedgerEntryRef?: string;
  guiPresentRef?: string;
  blockedRef?: string;
  permissionHandoffRef?: string;
  permissionRecheckRef?: string;
}

export interface VirtualAppScreenSessionManagerEvidence {
  providerExecuted: boolean;
  mutatingActionExecuted: boolean;
  nativeSessionCreated: boolean;
  liveFrameAttached: boolean;
  currentFrameMaterialized: boolean;
  guiPresented: boolean;
  isolationVerified: boolean;
  providerSessionGrantValidated?: boolean;
  platformDriverReady?: boolean;
  permissionRequired?: boolean;
  permissionGranted?: boolean;
  backgroundRenderable?: boolean;
  diagnosticOnly?: boolean;
  affectsPhysicalDisplay: false;
  requiresFocusSteal: false;
  sharedSystemInputUsed: false;
  systemPointerMoved: false;
  systemKeyboardEventsSent: false;
  surfaceTransport?: VirtualDisplaySurfaceTransportDescriptor;
  evidenceRefs: string[];
}

export interface VirtualAppScreenSessionManagerAttachOptions {
  executors?: VirtualAppScreenSessionManagerExecutor[];
  dryRun?: boolean;
}

const registeredVirtualAppScreenSessionExecutors = new Map<string, VirtualAppScreenSessionManagerExecutor>();

export function registerVirtualAppScreenSessionExecutor(
  executor: VirtualAppScreenSessionManagerExecutor,
): () => void {
  if (!executor.executorId.trim()) {
    throw new Error('VirtualAppScreen session executor requires a stable executorId.');
  }
  if (registeredVirtualAppScreenSessionExecutors.has(executor.executorId)) {
    throw new Error(`VirtualAppScreen session executor "${executor.executorId}" is already registered.`);
  }
  registeredVirtualAppScreenSessionExecutors.set(executor.executorId, executor);
  return () => {
    if (registeredVirtualAppScreenSessionExecutors.get(executor.executorId) === executor) {
      registeredVirtualAppScreenSessionExecutors.delete(executor.executorId);
    }
  };
}

export function listVirtualAppScreenSessionExecutors(): VirtualAppScreenSessionManagerExecutor[] {
  return [...registeredVirtualAppScreenSessionExecutors.values()];
}

export async function attachVirtualAppScreenSession(
  command: VirtualAppScreenRuntimeCommand,
  options: VirtualAppScreenSessionManagerAttachOptions = {},
): Promise<VirtualAppScreenSessionManagerAttachResult> {
  if (command.action === 'permission-handoff') {
    const permissionLedger = recordNativeHostPermissionLedgerCommand(command, 'permission.handoff');
    if (permissionLedger?.status === 'blocked') {
      return blockedVirtualAppScreenSessionManagerResult(
        command,
        `VirtualAppScreen permission handoff could not be recorded by Native Host: ${permissionLedger.error.message}`,
      );
    }
    return withPermissionLedgerResult(
      blockedVirtualAppScreenSessionManagerResult(
        command,
        'VirtualAppScreen permission handoff is presentation-only; native provider attach must wait for an explicit permission recheck or screen attach command.',
      ),
      permissionLedger,
      'permission.handoff',
    );
  }
  const permissionRecheckLedger = command.action === 'permission-recheck'
    ? recordNativeHostPermissionLedgerCommand(command, 'permission.recheck')
    : undefined;
  if (command.action === 'permission-recheck') {
    if (permissionRecheckLedger?.status === 'blocked') {
      return blockedVirtualAppScreenSessionManagerResult(
        command,
        `VirtualAppScreen permission recheck could not be recorded by Native Host: ${permissionRecheckLedger.error.message}`,
      );
    }
  }
  const executor = selectVirtualAppScreenSessionExecutor(command, options.executors ?? listVirtualAppScreenSessionExecutors());
  if (!executor || options.dryRun === true) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      options.dryRun === true
        ? 'VirtualAppScreen native attach is dry-run; no provider executor was allowed to create a live session.'
        : 'No runtime-owned native VirtualAppScreen session executor is registered for this profile.',
    );
  }
  const result = await executor.attach(command);
  return withPermissionLedgerResult(
    attachProviderSessionOwnerRefs(command, validateVirtualAppScreenSessionManagerResult(command, result)),
    permissionRecheckLedger,
    'permission.recheck',
  );
}

export async function reconnectVirtualAppScreenSession(
  command: VirtualAppScreenRuntimeCommand,
  _options: VirtualAppScreenSessionManagerAttachOptions = {},
): Promise<VirtualAppScreenSessionManagerAttachResult> {
  if (String(command.action) !== 'screen-reconnect') {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen provider session reconnect requires a screen reconnect command.',
    );
  }

  const refs = reconnectCommandRefs(command);
  const reconnect = revalidateVirtualAppScreenProviderSession({
    reason: reconnectReasonFromCommand(command),
    screenRef: command.refs.screenRef,
    sessionRef: command.refs.sessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    currentFrameRef: refs.currentFrameRef,
    currentFrameSequence: numericFrameSequence(command.currentFrameSequence),
    surfaceTransportRef: refs.surfaceTransportRef,
    providerSessionOwnerRef: refs.providerSessionOwnerRef,
    providerSessionReconnectRef: refs.providerSessionReconnectRef,
    liveBindingAttachGrantRef: refs.liveBindingAttachGrantRef,
    grantValidationRef: refs.grantValidationRef,
    adapterReadinessRef: command.refs.readinessRef,
    evidenceLedgerRef: command.refs.evidenceLedgerRef,
    guiPresentRef: command.refs.guiPresentRef,
  });
  if (reconnect.status !== 'reconnected' || !reconnect.record) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      reconnect.blockedReason ?? 'VirtualAppScreen provider session reconnect failed closed.',
    );
  }

  const record = reconnect.record;
  const surfaceTransport = buildVirtualDisplaySurfaceTransportDescriptor({
    providerId: record.providerId,
    transport: record.transport,
    surfaceTransportRef: record.surfaceTransportRef,
    liveSurfaceRef: record.liveSurfaceRef,
    frameStreamRef: record.frameStreamRef,
    currentFrameRef: record.currentFrameRef,
    frameTransportContractRef: record.frameTransportContractRef,
    frameTelemetryRef: record.frameTelemetryRef,
    mediaChannelRef: record.mediaChannelRef,
    dataChannelRef: record.dataChannelRef,
    currentFrameSequence: record.currentFrameSequence,
  });
  if (!isVirtualDisplaySurfaceTransportDescriptorSafe(surfaceTransport)) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen provider session reconnect could not reconstruct a safe surface transport descriptor.',
    );
  }

  return failClosedResult(command, {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: record.executorId,
    providerId: record.providerId,
    refs: {
      currentRunRef: record.currentRunRef,
      sessionRef: record.sessionRef,
      liveSurfaceRef: record.liveSurfaceRef,
      surfaceTransportRef: record.surfaceTransportRef,
      frameStreamRef: record.frameStreamRef,
      currentFrameRef: record.currentFrameRef,
      frameTransportContractRef: record.frameTransportContractRef,
      frameTelemetryRef: record.frameTelemetryRef,
      mediaChannelRef: record.mediaChannelRef,
      dataChannelRef: record.dataChannelRef,
      providerSessionOwnerRef: record.providerSessionOwnerRef,
      providerSessionReconnectRef: record.reconnectRef,
      providerLifecycleSessionRef: record.providerLifecycleSessionRef,
      liveBindingAttachGrantRef: record.liveBindingAttachGrantRef,
      grantValidationRef: record.grantValidationRef,
      screenRef: record.screenRef,
      targetAppRef: record.targetAppRef,
      targetWindowRef: record.targetWindowRef,
      displayGroupRef: record.displayGroupRef,
      inputLeaseRef: record.inputLeaseRef,
      actionAdapterRef: record.actionAdapterRef,
      adapterReadinessRef: record.adapterReadinessRef,
      platformDriverRef: record.platformDriverRef,
      permissionRef: record.permissionRef,
      evidenceLedgerRef: record.evidenceLedgerRef,
      hostEvidenceLedgerRef: record.evidenceLedgerRef,
      guiPresentRef: record.guiPresentRef,
    },
    evidence: {
      providerExecuted: false,
      mutatingActionExecuted: false,
      nativeSessionCreated: false,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: Boolean(record.guiPresentRef),
      isolationVerified: true,
      providerSessionGrantValidated: true,
      platformDriverReady: Boolean(record.platformDriverRef),
      permissionRequired: Boolean(record.permissionRef),
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport,
      evidenceRefs: uniqueRefs([
        ...reconnect.evidence.evidenceRefs,
        record.providerSessionOwnerRef,
        record.reconnectRef,
        record.providerLifecycleSessionRef,
        record.liveBindingAttachGrantRef,
        record.grantValidationRef,
        record.surfaceTransportRef,
        record.frameTransportContractRef,
        record.currentFrameRef,
      ]),
    },
  });
}

export function selectVirtualAppScreenSessionExecutor(
  command: VirtualAppScreenRuntimeCommand,
  executors: VirtualAppScreenSessionManagerExecutor[],
): VirtualAppScreenSessionManagerExecutor | undefined {
  const profile = command.profile ?? profileFromTargetAppRef(command.refs.targetAppRef);
  if (profile) {
    const exact = executors.find((executor) => executor.supportedProfiles.includes(profile));
    if (exact) return exact;
  }
  return executors.find((executor) => executor.supportedProfiles.includes('*'));
}

export function validateVirtualAppScreenSessionManagerResult(
  command: VirtualAppScreenRuntimeCommand,
  result: VirtualAppScreenSessionManagerAttachResult,
): VirtualAppScreenSessionManagerAttachResult {
  if (result.schemaVersion !== VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA) {
    return blockedVirtualAppScreenSessionManagerResult(command, 'VirtualAppScreen session executor returned an invalid schema version.');
  }
  if (result.status !== 'attached') return failClosedResult(command, result);
  const refs = result.refs;
  const evidence = result.evidence;
  const missing = [
    refs.sessionRef ? undefined : 'sessionRef',
    refs.liveSurfaceRef ? undefined : 'liveSurfaceRef',
    refs.frameStreamRef ? undefined : 'frameStreamRef',
    refs.currentFrameRef ? undefined : 'currentFrameRef',
    isVirtualDisplaySurfaceTransportDescriptorSafe(evidence.surfaceTransport) ? undefined : 'surfaceTransport',
    typeof evidence.surfaceTransport?.currentFrameSequence === 'number'
      && Number.isFinite(evidence.surfaceTransport.currentFrameSequence)
      && evidence.surfaceTransport.currentFrameSequence >= 0
      ? undefined
      : 'currentFrameSequence',
    refs.adapterReadinessRef ? undefined : 'adapterReadinessRef',
    refs.platformDriverRef ? undefined : 'platformDriverRef',
    evidence.platformDriverReady ? undefined : 'platformDriverReady',
    evidence.permissionRequired === false || evidence.permissionGranted === true ? undefined : 'permissionGranted',
    evidence.backgroundRenderable === true ? undefined : 'backgroundRenderable',
    evidence.diagnosticOnly === false ? undefined : 'diagnosticOnly',
    evidence.providerExecuted ? undefined : 'providerExecuted',
    evidence.nativeSessionCreated ? undefined : 'nativeSessionCreated',
    evidence.liveFrameAttached ? undefined : 'liveFrameAttached',
    evidence.currentFrameMaterialized ? undefined : 'currentFrameMaterialized',
    evidence.guiPresented ? undefined : 'guiPresented',
    evidence.isolationVerified ? undefined : 'isolationVerified',
  ].filter((item): item is string => Boolean(item));
  if (missing.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen session executor claimed attached without required evidence: ${missing.join(', ')}.`,
    );
  }
  const surfaceTransportMismatches = surfaceTransportDescriptorMismatches(result);
  if (surfaceTransportMismatches.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen session executor returned mismatched surface transport refs: ${surfaceTransportMismatches.join(', ')}.`,
    );
  }
  const continuityMismatches = [
    command.refs.sessionRef && command.refs.sessionRef !== refs.sessionRef ? 'sessionRef' : undefined,
    requestedLiveSurfaceRef(command) && requestedLiveSurfaceRef(command) !== refs.liveSurfaceRef ? 'liveSurfaceRef' : undefined,
    command.refs.frameStreamRef && command.refs.frameStreamRef !== refs.frameStreamRef ? 'frameStreamRef' : undefined,
    command.refs.currentFrameRef && command.refs.currentFrameRef !== refs.currentFrameRef ? 'currentFrameRef' : undefined,
    command.refs.surfaceTransportRef && command.refs.surfaceTransportRef !== refs.surfaceTransportRef ? 'surfaceTransportRef' : undefined,
  ].filter((item): item is string => Boolean(item));
  if (continuityMismatches.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen session executor returned refs that do not match the requested current session: ${continuityMismatches.join(', ')}.`,
    );
  }
  return failClosedResult(command, result);
}

export function virtualAppScreenSessionManagerResultToVirtualScreenData(
  command: VirtualAppScreenRuntimeCommand,
  result: VirtualAppScreenSessionManagerAttachResult,
) {
  if (result.status !== 'attached') {
    return {
      ...virtualAppScreenRuntimeCommandVirtualScreenData(command),
      status: result.status === 'permission-missing' || result.status === 'requires-handoff' ? 'requires-handoff' : 'blocked',
      attachState: result.status,
      evidenceLedgerRef: result.refs.hostEvidenceLedgerRef ?? result.refs.evidenceLedgerRef ?? command.refs.evidenceLedgerRef,
      hostEvidenceLedgerRef: result.refs.hostEvidenceLedgerRef,
      permissionHandoffLedgerEntryRef: result.refs.permissionHandoffLedgerEntryRef,
      permissionRecheckLedgerEntryRef: result.refs.permissionRecheckLedgerEntryRef,
      verificationRefs: uniqueRefs([
        ...result.evidence.evidenceRefs,
        result.refs.hostEvidenceLedgerRef,
        result.refs.permissionHandoffLedgerEntryRef,
        result.refs.permissionRecheckLedgerEntryRef,
      ]),
      blockedReason: result.blockedReason ?? virtualAppScreenRuntimeCommandBlockedReason(command),
      runSummary: {
        status: result.status,
        blockedReason: result.blockedReason ?? virtualAppScreenRuntimeCommandBlockedReason(command),
        frameCount: 0,
        screenCount: command.refs.screenRef ? 1 : 0,
        realNativeSidecarExecuted: false,
        completionEligible: false,
        productRuntimeAccepted: true,
        sessionManagerExecutorId: result.executorId,
      },
    };
  }

  const surfaceTransport = result.evidence.surfaceTransport;
  return {
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    title: 'Computer Use Virtual Screen',
    status: 'ready',
    attachState: 'attached',
    surfaceMode: 'live',
    currentRunRef: result.refs.currentRunRef,
    displayGroupRef: result.refs.displayGroupRef,
    screenRef: result.refs.screenRef ?? command.refs.screenRef,
    visibleScreenRefs: [result.refs.screenRef ?? command.refs.screenRef].filter(Boolean),
    targetAppRef: result.refs.targetAppRef ?? command.refs.targetAppRef,
    targetWindowRef: result.refs.targetWindowRef,
    sessionRef: result.refs.sessionRef,
    hostSessionRef: result.refs.sessionRef,
    liveSurfaceRef: result.refs.liveSurfaceRef,
    surfaceTransportRef: result.refs.surfaceTransportRef,
    surfaceOwnerRef: result.refs.surfaceOwnerRef,
    displayOwnerRef: result.refs.displayOwnerRef,
    providerSessionOwnerRef: result.refs.providerSessionOwnerRef,
    providerSessionReconnectRef: result.refs.providerSessionReconnectRef,
    liveBindingAttachGrantRef: result.refs.liveBindingAttachGrantRef,
    liveBindingAttachGrantStatus: result.evidence.providerSessionGrantValidated ? 'validated' : undefined,
    grantValidationRef: result.refs.grantValidationRef,
    grantValidationStatus: result.evidence.providerSessionGrantValidated ? 'validated' : undefined,
    providerSessionRevalidated: !result.evidence.nativeSessionCreated,
    surfaceTransport: surfaceTransport?.transport,
    surfaceTransportDescriptor: surfaceTransport,
    frameStreamRef: result.refs.frameStreamRef,
    currentFrameRef: result.refs.currentFrameRef,
    frameTransport: surfaceTransport?.frameTransportContractRef
      ? {
        ref: surfaceTransport.frameTransportContractRef,
        transport: surfaceTransport.transport,
        diagnosticOnly: surfaceTransport.diagnosticOnly,
        sequence: surfaceTransport.currentFrameSequence,
      }
      : undefined,
    frameTelemetry: surfaceTransport?.frameTelemetryRef
      ? {
        ref: surfaceTransport.frameTelemetryRef,
        transport: surfaceTransport.transport,
        diagnosticOnly: surfaceTransport.diagnosticOnly,
        sequence: surfaceTransport.currentFrameSequence,
      }
      : undefined,
    currentFrameSequence: surfaceTransport?.currentFrameRef
      ? {
        ref: surfaceTransport.currentFrameRef,
        transport: surfaceTransport.transport,
        diagnosticOnly: surfaceTransport.diagnosticOnly,
        sequence: surfaceTransport.currentFrameSequence,
      }
      : undefined,
    inputLeaseRef: result.refs.inputLeaseRef,
    actionAdapterRef: result.refs.actionAdapterRef,
    adapterReadinessRef: result.refs.adapterReadinessRef,
    platformDriverRef: result.refs.platformDriverRef,
    platformDriverStatus: result.evidence.platformDriverReady ? 'ready' : undefined,
    permissionRef: result.refs.permissionRef,
    permissionStatus: result.evidence.permissionGranted === true
      ? 'granted'
      : result.evidence.permissionRequired === false
        ? 'not-required'
        : undefined,
    permissionRequired: result.evidence.permissionRequired,
    permissionGranted: result.evidence.permissionGranted,
    sharedInputAllowed: false,
    evidenceLedgerRef: result.refs.hostEvidenceLedgerRef ?? result.refs.evidenceLedgerRef,
    hostEvidenceLedgerRef: result.refs.hostEvidenceLedgerRef,
    permissionHandoffLedgerEntryRef: result.refs.permissionHandoffLedgerEntryRef,
    permissionRecheckLedgerEntryRef: result.refs.permissionRecheckLedgerEntryRef,
    guiPresentRefs: result.refs.guiPresentRef ? [result.refs.guiPresentRef] : [],
    verificationRefs: result.evidence.evidenceRefs,
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      backgroundRenderable: result.evidence.backgroundRenderable === true,
      diagnosticOnly: result.evidence.diagnosticOnly === false ? false : true,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      providerExecuted: result.evidence.providerExecuted,
      failClosedByDefault: true,
    },
    runSummary: {
      status: 'ready',
      frameCount: 1,
      screenCount: 1,
      realNativeSidecarExecuted: result.evidence.providerExecuted,
      providerSessionRevalidated: !result.evidence.nativeSessionCreated,
      completionEligible: false,
      productRuntimeAccepted: true,
      sessionManagerExecutorId: result.executorId,
    },
  };
}

export function blockedVirtualAppScreenSessionManagerResult(
  command: VirtualAppScreenRuntimeCommand,
  blockedReason: string,
): VirtualAppScreenSessionManagerAttachResult {
  const scope = sanitizeId([
    'virtual-app-screen',
    command.action,
    command.refs.screenRef,
    command.refs.activationRef,
    command.refs.targetAppRef,
  ].filter(Boolean).join('-'));
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: command.action === 'permission-handoff' ? 'requires-handoff' : 'blocked',
    executorId: 'virtual-app-screen-session-manager:none',
    providerId: 'virtual-display-provider:none',
    refs: {
      currentRunRef: `.sciforge/vision-runs/${scope}/current-run.json`,
      screenRef: command.refs.screenRef,
      targetAppRef: command.refs.targetAppRef,
      adapterReadinessRef: command.refs.readinessRef,
      evidenceLedgerRef: command.refs.evidenceLedgerRef,
      guiPresentRef: command.refs.guiPresentRef,
      blockedRef: command.refs.blockedRef ?? `computer-use:session-manager/${scope}/blocked/no-native-executor.json`,
      permissionHandoffRef: command.refs.permissionHandoffRef,
      permissionRecheckRef: command.refs.permissionRecheckRef,
    },
    evidence: {
      providerExecuted: false,
      mutatingActionExecuted: false,
      nativeSessionCreated: false,
      liveFrameAttached: false,
      currentFrameMaterialized: false,
      guiPresented: false,
      isolationVerified: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      evidenceRefs: [command.refs.readinessRef, command.refs.evidenceLedgerRef, command.refs.guiPresentRef].filter((ref): ref is string => Boolean(ref)),
    },
    blockedReason,
  };
}

function failClosedResult(
  command: VirtualAppScreenRuntimeCommand,
  result: VirtualAppScreenSessionManagerAttachResult,
): VirtualAppScreenSessionManagerAttachResult {
  if (
    result.evidence.affectsPhysicalDisplay
    || result.evidence.requiresFocusSteal
    || result.evidence.sharedSystemInputUsed
    || result.evidence.systemPointerMoved
    || result.evidence.systemKeyboardEventsSent
  ) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen session executor attempted to use physical desktop or shared system input, so the product path failed closed.',
    );
  }
  return result;
}

function surfaceTransportDescriptorMismatches(result: VirtualAppScreenSessionManagerAttachResult) {
  const descriptor = result.evidence.surfaceTransport;
  if (!isVirtualDisplaySurfaceTransportDescriptorSafe(descriptor)) return [];
  return [
    descriptor.providerId !== result.providerId ? 'providerId' : undefined,
    descriptor.surfaceTransportRef !== result.refs.surfaceTransportRef ? 'surfaceTransportRef' : undefined,
    descriptor.liveSurfaceRef !== result.refs.liveSurfaceRef ? 'liveSurfaceRef' : undefined,
    descriptor.frameStreamRef !== result.refs.frameStreamRef ? 'frameStreamRef' : undefined,
    descriptor.currentFrameRef !== result.refs.currentFrameRef ? 'currentFrameRef' : undefined,
    descriptor.frameTransportContractRef !== result.refs.frameTransportContractRef ? 'frameTransportContractRef' : undefined,
    optionalRefMismatch('frameTelemetryRef', descriptor.frameTelemetryRef, result.refs.frameTelemetryRef),
    optionalRefMismatch('mediaChannelRef', descriptor.mediaChannelRef, result.refs.mediaChannelRef),
    optionalRefMismatch('dataChannelRef', descriptor.dataChannelRef, result.refs.dataChannelRef),
  ].filter((item): item is string => Boolean(item));
}

function optionalRefMismatch(name: string, left: string | undefined, right: string | undefined) {
  return left === right ? undefined : name;
}

function attachProviderSessionOwnerRefs(
  command: VirtualAppScreenRuntimeCommand,
  result: VirtualAppScreenSessionManagerAttachResult,
): VirtualAppScreenSessionManagerAttachResult {
  const record = recordVirtualAppScreenProviderSession(command, result);
  if (!record) return result;
  return {
    ...result,
    refs: {
      ...result.refs,
      providerSessionOwnerRef: record.providerSessionOwnerRef,
      providerSessionReconnectRef: record.reconnectRef,
      liveBindingAttachGrantRef: record.liveBindingAttachGrantRef,
      grantValidationRef: record.grantValidationRef,
    },
    evidence: {
      ...result.evidence,
      providerSessionGrantValidated: true,
      evidenceRefs: uniqueRefs([
        ...result.evidence.evidenceRefs,
        record.providerSessionOwnerRef,
        record.reconnectRef,
        record.providerLifecycleSessionRef,
        record.liveBindingAttachGrantRef,
        record.grantValidationRef,
      ]),
    },
  };
}

function recordNativeHostPermissionLedgerCommand(
  command: VirtualAppScreenRuntimeCommand,
  type: 'permission.handoff' | 'permission.recheck',
): NativeHostResult<{ entry: NativeHostLedgerEntry; evidenceLedgerRef: string }> | undefined {
  const record = readVirtualAppScreenNativeHostSessionRecord({
    sessionRef: command.refs.sessionRef,
    screenRef: command.refs.screenRef,
  });
  if (!record) return undefined;
  const request = {
    permissionHandoffRef: command.refs.permissionHandoffRef,
    recheckRef: command.refs.permissionRecheckRef,
    permissionRef: command.refs.permissionRef,
    adapterReadinessRef: command.refs.readinessRef,
    platformDriverRef: command.refs.platformDriverRef,
    blockedRef: command.refs.blockedRef,
  };
  const result = type === 'permission.handoff'
    ? record.host.recordPermissionHandoff(record.sessionId, request)
    : record.host.recordPermissionRecheck(record.sessionId, request);
  if (result.status === 'blocked') return result;
  return {
    status: 'ok',
    value: {
      entry: result.value,
      evidenceLedgerRef: record.host.getLedger(record.sessionId)?.ledgerRef ?? record.evidenceLedgerRef,
    },
  };
}

function withPermissionLedgerResult(
  result: VirtualAppScreenSessionManagerAttachResult,
  permissionLedger: NativeHostResult<{ entry: NativeHostLedgerEntry; evidenceLedgerRef: string }> | undefined,
  type: 'permission.handoff' | 'permission.recheck',
): VirtualAppScreenSessionManagerAttachResult {
  if (!permissionLedger || permissionLedger.status === 'blocked') return result;
  const entryRefKey = type === 'permission.handoff'
    ? 'permissionHandoffLedgerEntryRef'
    : 'permissionRecheckLedgerEntryRef';
  return {
    ...result,
    refs: {
      ...result.refs,
      hostEvidenceLedgerRef: permissionLedger.value.evidenceLedgerRef,
      evidenceLedgerRef: result.refs.evidenceLedgerRef ?? permissionLedger.value.evidenceLedgerRef,
      [entryRefKey]: permissionLedger.value.entry.eventRef,
    },
    evidence: {
      ...result.evidence,
      evidenceRefs: uniqueRefs([
        ...result.evidence.evidenceRefs,
        permissionLedger.value.evidenceLedgerRef,
        permissionLedger.value.entry.eventRef,
      ]),
    },
  };
}

function uniqueRefs(refs: Array<string | undefined>) {
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref?.trim())))];
}

function reconnectReasonFromCommand(command: VirtualAppScreenRuntimeCommand): VirtualAppScreenProviderSessionReconnectReason {
  const reason = (command as { reconnectReason?: string }).reconnectReason;
  return reason === 'resize'
    || reason === 'tab-switch'
    || reason === 'workspace-restore'
    || reason === 'provider-reconnect'
    ? reason
    : 'provider-reconnect';
}

function reconnectCommandRefs(command: VirtualAppScreenRuntimeCommand) {
  const refs = command.refs as VirtualAppScreenRuntimeCommand['refs'] & {
    liveSurfaceRef?: string;
    frameStreamRef?: string;
    currentFrameRef?: string;
    surfaceTransportRef?: string;
    providerSessionOwnerRef?: string;
    providerSessionReconnectRef?: string;
    liveBindingAttachGrantRef?: string;
    grantValidationRef?: string;
  };
  return {
    liveSurfaceRef: refs.liveSurfaceRef ?? refs.surfaceRef,
    frameStreamRef: refs.frameStreamRef,
    currentFrameRef: refs.currentFrameRef,
    surfaceTransportRef: refs.surfaceTransportRef,
    providerSessionOwnerRef: refs.providerSessionOwnerRef,
    providerSessionReconnectRef: refs.providerSessionReconnectRef,
    liveBindingAttachGrantRef: refs.liveBindingAttachGrantRef,
    grantValidationRef: refs.grantValidationRef,
  };
}

function numericFrameSequence(value: number | string | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function requestedLiveSurfaceRef(command: VirtualAppScreenRuntimeCommand) {
  return command.refs.liveSurfaceRef ?? command.refs.surfaceRef;
}

function profileFromTargetAppRef(targetAppRef: string | undefined) {
  return targetAppRef?.split('/').filter(Boolean).at(-1);
}
