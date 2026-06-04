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
  readVirtualAppScreenProviderSessionRecord,
  recordVirtualAppScreenProviderSession,
  updateVirtualAppScreenProviderSessionReadiness,
  type VirtualAppScreenProviderSessionRecord,
  type VirtualAppScreenSurfaceIdentity,
  type VirtualAppScreenProviderSessionReconnectReason,
} from './virtual-app-screen-provider-session-store.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
  updateVirtualAppScreenNativeHostSessionReadiness,
  type VirtualAppScreenNativeHostSessionRecord,
} from './virtual-app-screen-native-host-session-store.js';
import {
  createDefaultProductNativeVirtualAppScreenHost,
  deriveNativeHostMinimalEvidenceReplayRefs,
  type NativeHostPreflightRecord,
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
  currentRunPointerRef?: string;
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
  surfaceIdentityRef?: string;
  surfaceIdentity?: VirtualAppScreenSurfaceIdentity;
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
  preflightRef?: string;
  preflightLedgerRef?: string;
  preflightLedgerEntryRef?: string;
  hostReadinessRef?: string;
  hostLifecycleReplayRefs?: string[];
  minimalEvidenceReplayRefs?: string[];
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

interface NativeHostPermissionLedgerRecord {
  entry: NativeHostLedgerEntry;
  evidenceLedgerRef: string;
  record: VirtualAppScreenNativeHostSessionRecord;
  providerSessionRecord?: VirtualAppScreenProviderSessionRecord;
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
    const permissionLedger = await recordNativeHostPermissionLedgerCommand(command, 'permission.handoff');
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
    ? await recordNativeHostPermissionLedgerCommand(command, 'permission.recheck')
    : undefined;
  if (command.action === 'permission-recheck') {
    if (permissionRecheckLedger?.status === 'blocked') {
      return blockedVirtualAppScreenSessionManagerResult(
        command,
        `VirtualAppScreen permission recheck could not be recorded by Native Host: ${permissionRecheckLedger.error.message}`,
      );
    }
    const existingSessionResult = permissionRecheckLedger?.status === 'ok'
      ? existingNativeHostSessionManagerResult(command, permissionRecheckLedger.value)
      : undefined;
    if (existingSessionResult) return existingSessionResult;
  }
  const executor = selectVirtualAppScreenSessionExecutor(command, options.executors ?? listVirtualAppScreenSessionExecutors());
  if (!executor || options.dryRun === true) {
    return withDefaultNativeHostPreflight(
      blockedVirtualAppScreenSessionManagerResult(
        command,
        options.dryRun === true
          ? 'VirtualAppScreen native attach is dry-run; no provider executor was allowed to create a live session.'
          : 'No runtime-owned native VirtualAppScreen session executor is registered for this profile.',
      ),
      command,
    );
  }
  const result = normalizeNativeHostEvidenceRefs(await executor.attach(command));
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
    surfaceIdentityRef: refs.surfaceIdentityRef,
    surfaceOwnerRef: refs.surfaceOwnerRef,
    displayOwnerRef: refs.displayOwnerRef,
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
      surfaceIdentityRef: record.surfaceIdentityRef,
      surfaceIdentity: record.surfaceIdentity,
      providerLifecycleSessionRef: record.providerLifecycleSessionRef,
      liveBindingAttachGrantRef: record.liveBindingAttachGrantRef,
      grantValidationRef: record.grantValidationRef,
      surfaceOwnerRef: record.surfaceOwnerRef,
      displayOwnerRef: record.displayOwnerRef,
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
        record.surfaceIdentityRef,
        record.surfaceIdentity.surfaceOwnerRef,
        record.surfaceIdentity.displayOwnerRef,
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

function existingNativeHostSessionManagerResult(
  command: VirtualAppScreenRuntimeCommand,
  permissionLedger: NativeHostPermissionLedgerRecord,
): VirtualAppScreenSessionManagerAttachResult | undefined {
  const record = permissionLedger.record;
  const providerRecord = permissionLedger.providerSessionRecord ?? readVirtualAppScreenProviderSessionRecord({
    screenRef: record.screenRef,
    sessionRef: record.sessionRef,
  });
  if (!providerRecord) return undefined;

  const currentFrameRef = record.currentFrameRef ?? providerRecord.currentFrameRef;
  const surfaceTransport = buildVirtualDisplaySurfaceTransportDescriptor({
    providerId: providerRecord.providerId,
    transport: providerRecord.transport,
    surfaceTransportRef: providerRecord.surfaceTransportRef,
    liveSurfaceRef: record.liveSurfaceRef ?? providerRecord.liveSurfaceRef,
    frameStreamRef: record.frameStreamRef ?? providerRecord.frameStreamRef,
    currentFrameRef,
    frameTransportContractRef: providerRecord.frameTransportContractRef,
    frameTelemetryRef: providerRecord.frameTelemetryRef,
    mediaChannelRef: providerRecord.mediaChannelRef,
    dataChannelRef: providerRecord.dataChannelRef,
    currentFrameSequence: record.currentFrameSequence ?? providerRecord.currentFrameSequence,
  });
  if (!isVirtualDisplaySurfaceTransportDescriptorSafe(surfaceTransport)) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen permission recheck could not reconstruct a safe current-session surface transport descriptor.',
    );
  }

  const ledger = record.host.getLedger(record.sessionId);
  const minimalEvidenceReplayRefs = ledger ? deriveNativeHostMinimalEvidenceReplayRefs(ledger) : [];
  return failClosedResult(command, {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: providerRecord.executorId,
    providerId: providerRecord.providerId,
    refs: {
      currentRunRef: record.currentRunRef,
      currentRunPointerRef: record.currentRunPointerRef,
      sessionRef: record.sessionRef,
      liveSurfaceRef: record.liveSurfaceRef ?? providerRecord.liveSurfaceRef,
      surfaceTransportRef: providerRecord.surfaceTransportRef,
      frameStreamRef: record.frameStreamRef ?? providerRecord.frameStreamRef,
      currentFrameRef,
      frameTransportContractRef: providerRecord.frameTransportContractRef,
      frameTelemetryRef: providerRecord.frameTelemetryRef,
      mediaChannelRef: providerRecord.mediaChannelRef,
      dataChannelRef: providerRecord.dataChannelRef,
      providerSessionOwnerRef: providerRecord.providerSessionOwnerRef,
      providerSessionReconnectRef: providerRecord.reconnectRef,
      surfaceIdentityRef: providerRecord.surfaceIdentityRef,
      surfaceIdentity: providerRecord.surfaceIdentity,
      providerLifecycleSessionRef: providerRecord.providerLifecycleSessionRef,
      liveBindingAttachGrantRef: record.liveBindingAttachGrantRef ?? providerRecord.liveBindingAttachGrantRef,
      grantValidationRef: record.grantValidationRef ?? providerRecord.grantValidationRef,
      surfaceOwnerRef: providerRecord.surfaceOwnerRef,
      displayOwnerRef: providerRecord.displayOwnerRef,
      screenRef: record.screenRef ?? providerRecord.screenRef,
      targetAppRef: providerRecord.targetAppRef ?? command.refs.targetAppRef,
      targetWindowRef: record.targetWindowRef ?? providerRecord.targetWindowRef,
      displayGroupRef: providerRecord.displayGroupRef,
      inputLeaseRef: record.inputLeaseRef ?? providerRecord.inputLeaseRef,
      actionAdapterRef: record.actionAdapterRef ?? providerRecord.actionAdapterRef,
      adapterReadinessRef: record.adapterReadinessRef,
      platformDriverRef: providerRecord.platformDriverRef ?? command.refs.platformDriverRef,
      permissionRef: providerRecord.permissionRef ?? command.refs.permissionRef,
      evidenceLedgerRef: record.evidenceLedgerRef,
      hostEvidenceLedgerRef: permissionLedger.evidenceLedgerRef,
      permissionHandoffLedgerEntryRef: command.action === 'permission-handoff' ? permissionLedger.entry.eventRef : undefined,
      permissionRecheckLedgerEntryRef: command.action === 'permission-recheck' ? permissionLedger.entry.eventRef : undefined,
      minimalEvidenceReplayRefs,
      guiPresentRef: providerRecord.guiPresentRef ?? command.refs.guiPresentRef,
    },
    evidence: {
      providerExecuted: false,
      mutatingActionExecuted: false,
      nativeSessionCreated: false,
      liveFrameAttached: Boolean(record.liveSurfaceRef ?? providerRecord.liveSurfaceRef),
      currentFrameMaterialized: Boolean(currentFrameRef),
      guiPresented: Boolean(providerRecord.guiPresentRef ?? command.refs.guiPresentRef),
      isolationVerified: true,
      providerSessionGrantValidated: true,
      platformDriverReady: Boolean(providerRecord.platformDriverRef ?? command.refs.platformDriverRef),
      permissionRequired: Boolean(providerRecord.permissionRef ?? command.refs.permissionRef),
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: record.diagnosticOnly,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport,
      evidenceRefs: uniqueRefs([
        permissionLedger.evidenceLedgerRef,
        permissionLedger.entry.eventRef,
        record.currentRunPointerRef,
        record.adapterReadinessRef,
        providerRecord.providerSessionOwnerRef,
        providerRecord.reconnectRef,
        providerRecord.surfaceIdentityRef,
        providerRecord.surfaceIdentity.surfaceOwnerRef,
        providerRecord.surfaceIdentity.displayOwnerRef,
        providerRecord.providerLifecycleSessionRef,
        providerRecord.liveBindingAttachGrantRef,
        providerRecord.grantValidationRef,
        providerRecord.surfaceTransportRef,
        providerRecord.frameTransportContractRef,
        currentFrameRef,
        ...minimalEvidenceReplayRefs,
      ]),
    },
  });
}

export function selectVirtualAppScreenSessionExecutor(
  command: VirtualAppScreenRuntimeCommand,
  executors: VirtualAppScreenSessionManagerExecutor[],
): VirtualAppScreenSessionManagerExecutor | undefined {
  const profile = command.profile ?? profileFromTargetAppRef(command.refs.targetAppRef);
  const newestFirst = [...executors].reverse();
  if (profile) {
    const exact = newestFirst.find((executor) => executor.supportedProfiles.includes(profile));
    if (exact) return exact;
  }
  return newestFirst.find((executor) => executor.supportedProfiles.includes('*'));
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
    refs.surfaceOwnerRef ? undefined : 'surfaceOwnerRef',
    refs.displayOwnerRef ? undefined : 'displayOwnerRef',
    refs.liveBindingAttachGrantRef ? undefined : 'liveBindingAttachGrantRef',
    refs.grantValidationRef ? undefined : 'grantValidationRef',
    refs.frameStreamRef ? undefined : 'frameStreamRef',
    refs.currentFrameRef ? undefined : 'currentFrameRef',
    refs.frameTransportContractRef ? undefined : 'frameTransportContractRef',
    isVirtualDisplaySurfaceTransportDescriptorSafe(evidence.surfaceTransport) ? undefined : 'surfaceTransport',
    typeof evidence.surfaceTransport?.currentFrameSequence === 'number'
      && Number.isFinite(evidence.surfaceTransport.currentFrameSequence)
      && evidence.surfaceTransport.currentFrameSequence >= 0
      ? undefined
      : 'currentFrameSequence',
    refs.adapterReadinessRef ? undefined : 'adapterReadinessRef',
    refs.platformDriverRef ? undefined : 'platformDriverRef',
    refs.evidenceLedgerRef ? undefined : 'evidenceLedgerRef',
    refs.hostEvidenceLedgerRef ? undefined : 'hostEvidenceLedgerRef',
    evidence.platformDriverReady ? undefined : 'platformDriverReady',
    refs.currentRunPointerRef ? undefined : 'currentRunPointerRef',
    refs.minimalEvidenceReplayRefs?.length ? undefined : 'minimalEvidenceReplayRefs',
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
  const nonHostProductRefs = nonNativeHostProductLiveRefs(refs);
  if (nonHostProductRefs.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen session executor claimed attached without Host-owned refs under computer-use:native-host/: ${nonHostProductRefs.join(', ')}.`,
    );
  }
  const evidenceRefMismatches = attachedEvidenceRefMismatches(result);
  if (evidenceRefMismatches.length) {
    return blockedVirtualAppScreenSessionManagerResult(
      command,
      `VirtualAppScreen session executor claimed attached without replayable Host evidence refs: ${evidenceRefMismatches.join(', ')}.`,
    );
  }
  return failClosedResult(command, result);
}

function normalizeNativeHostEvidenceRefs(
  result: VirtualAppScreenSessionManagerAttachResult,
): VirtualAppScreenSessionManagerAttachResult {
  const hostEvidenceLedgerRef = result.refs.hostEvidenceLedgerRef
    ?? (isNativeHostProductRef(result.refs.evidenceLedgerRef) ? result.refs.evidenceLedgerRef : undefined);
  const replayRefs = [
    hostEvidenceLedgerRef,
    result.refs.evidenceLedgerRef,
    result.refs.currentRunPointerRef,
    result.refs.currentFrameRef,
    result.refs.liveBindingAttachGrantRef,
    result.refs.grantValidationRef,
    ...(result.refs.minimalEvidenceReplayRefs ?? []),
  ].filter(isNativeHostProductRef);
  if (!hostEvidenceLedgerRef && replayRefs.length === 0) return result;
  return {
    ...result,
    refs: {
      ...result.refs,
      hostEvidenceLedgerRef: hostEvidenceLedgerRef ?? result.refs.hostEvidenceLedgerRef,
    },
    evidence: {
      ...result.evidence,
      evidenceRefs: uniqueRefs([...result.evidence.evidenceRefs, ...replayRefs]),
    },
  };
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
      currentRunPointerRef: result.refs.currentRunPointerRef,
      adapterReadinessRef: result.refs.adapterReadinessRef,
      preflightRef: result.refs.preflightRef,
      preflightLedgerRef: result.refs.preflightLedgerRef ?? result.refs.hostEvidenceLedgerRef ?? result.refs.evidenceLedgerRef,
      preflightLedgerEntryRef: result.refs.preflightLedgerEntryRef,
      hostReadinessRef: result.refs.hostReadinessRef,
      nativeHostPreflight: result.refs.preflightRef || result.refs.preflightLedgerEntryRef || result.refs.hostReadinessRef
        ? {
          preflightRef: result.refs.preflightRef,
          preflightLedgerRef: result.refs.preflightLedgerRef ?? result.refs.hostEvidenceLedgerRef ?? result.refs.evidenceLedgerRef,
          preflightLedgerEntryRef: result.refs.preflightLedgerEntryRef,
          hostReadinessRef: result.refs.hostReadinessRef,
          adapterReadinessRef: result.refs.adapterReadinessRef.startsWith('computer-use:native-host/')
            ? result.refs.adapterReadinessRef
            : undefined,
          status: result.status === 'blocked' || result.status === 'adapter-unavailable' ? 'blocked' : result.status,
        }
        : undefined,
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
    currentRunPointerRef: result.refs.currentRunPointerRef,
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
    surfaceIdentityRef: result.refs.surfaceIdentityRef,
    surfaceIdentity: result.refs.surfaceIdentity,
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
    hostLifecycleReplayRefs: result.refs.hostLifecycleReplayRefs,
    minimalEvidenceReplayRefs: result.refs.minimalEvidenceReplayRefs,
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

function withDefaultNativeHostPreflight(
  result: VirtualAppScreenSessionManagerAttachResult,
  command: VirtualAppScreenRuntimeCommand,
): VirtualAppScreenSessionManagerAttachResult {
  const host = createDefaultProductNativeVirtualAppScreenHost();
  const preflight = host.recordPreflight({
    currentRunRef: result.refs.currentRunRef,
    evidenceRootRef: result.refs.evidenceLedgerRef ?? `.sciforge/vision-runs/${sanitizeId(result.refs.currentRunRef)}/native-host-preflight`,
    currentRunPointerRef: result.refs.currentRunPointerRef,
    guiPresentRef: result.refs.guiPresentRef,
    requestedPermissionRefs: [command.refs.permissionRef].filter((ref): ref is string => Boolean(ref)),
    providerReadinessRef: command.refs.readinessRef,
    platformDriverRef: command.refs.platformDriverRef,
    permissionHandoffRef: command.refs.permissionHandoffRef,
    recheckRef: command.refs.permissionRecheckRef,
    blockedRef: command.refs.blockedRef,
  });
  if (preflight.status === 'blocked') return result;
  return mergeNativeHostPreflight(result, preflight.value);
}

function mergeNativeHostPreflight(
  result: VirtualAppScreenSessionManagerAttachResult,
  preflight: NativeHostPreflightRecord,
): VirtualAppScreenSessionManagerAttachResult {
  return {
    ...result,
    refs: {
      ...result.refs,
      currentRunPointerRef: preflight.currentRunPointerRef,
      adapterReadinessRef: preflight.adapterReadinessRef,
      evidenceLedgerRef: preflight.preflightLedgerRef,
      hostEvidenceLedgerRef: preflight.preflightLedgerRef,
      preflightLedgerRef: preflight.preflightLedgerRef,
      blockedRef: preflight.blockedRef ?? result.refs.blockedRef,
      permissionHandoffRef: preflight.handoffRef ?? result.refs.permissionHandoffRef,
      permissionRecheckRef: preflight.recheckRef ?? result.refs.permissionRecheckRef,
      preflightRef: preflight.preflightRef,
      preflightLedgerEntryRef: preflight.preflightLedgerEntryRef,
      hostReadinessRef: preflight.hostReadinessRef,
    },
    evidence: {
      ...result.evidence,
      diagnosticOnly: preflight.diagnosticOnly,
      backgroundRenderable: preflight.capabilities.backgroundRenderable,
      evidenceRefs: uniqueRefs([
        ...result.evidence.evidenceRefs,
        preflight.preflightRef,
        preflight.preflightLedgerRef,
        preflight.preflightLedgerEntryRef,
        preflight.hostReadinessRef,
        preflight.adapterReadinessRef,
        preflight.blockedRef,
        preflight.handoffRef,
        preflight.recheckRef,
        ...preflight.permissionRefs,
        ...preflight.driverRefs,
        ...preflight.providerRefs,
      ]),
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

function nonNativeHostProductLiveRefs(refs: VirtualAppScreenSessionManagerRefs): string[] {
  const candidates: Array<readonly [string, string | undefined]> = [
    ['sessionRef', refs.sessionRef],
    ['currentRunPointerRef', refs.currentRunPointerRef],
    ['liveSurfaceRef', refs.liveSurfaceRef],
    ['surfaceTransportRef', refs.surfaceTransportRef],
    ['frameStreamRef', refs.frameStreamRef],
    ['currentFrameRef', refs.currentFrameRef],
    ['frameTransportContractRef', refs.frameTransportContractRef],
    ['liveBindingAttachGrantRef', refs.liveBindingAttachGrantRef],
    ['grantValidationRef', refs.grantValidationRef],
    ['surfaceOwnerRef', refs.surfaceOwnerRef],
    ['displayOwnerRef', refs.displayOwnerRef],
    ['evidenceLedgerRef', refs.evidenceLedgerRef],
    ['hostEvidenceLedgerRef', refs.hostEvidenceLedgerRef],
    ['frameTelemetryRef', refs.frameTelemetryRef],
    ['mediaChannelRef', refs.mediaChannelRef],
    ['dataChannelRef', refs.dataChannelRef],
  ];
  return candidates
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined && !isNativeHostProductRef(entry[1]))
    .map(([field]) => field)
    .concat(
      (refs.minimalEvidenceReplayRefs ?? []).some((ref) => !isNativeHostProductRef(ref))
        ? ['minimalEvidenceReplayRefs']
        : [],
    );
}

function attachedEvidenceRefMismatches(result: VirtualAppScreenSessionManagerAttachResult) {
  const evidenceRefs = new Set(result.evidence.evidenceRefs.map((ref) => ref.trim()).filter(Boolean));
  return [
    evidenceRefs.has(result.refs.evidenceLedgerRef ?? '') ? undefined : 'evidenceLedgerRef',
    evidenceRefs.has(result.refs.hostEvidenceLedgerRef ?? '') ? undefined : 'hostEvidenceLedgerRef',
    evidenceRefs.has(result.refs.currentRunPointerRef ?? '') ? undefined : 'currentRunPointerRef',
    evidenceRefs.has(result.refs.currentFrameRef ?? '') ? undefined : 'currentFrameRef',
    evidenceRefs.has(result.refs.liveBindingAttachGrantRef ?? '') ? undefined : 'liveBindingAttachGrantRef',
    evidenceRefs.has(result.refs.grantValidationRef ?? '') ? undefined : 'grantValidationRef',
    ...(result.refs.minimalEvidenceReplayRefs ?? []).map((ref, index) => (
      evidenceRefs.has(ref) ? undefined : `minimalEvidenceReplayRefs[${index}]`
    )),
  ].filter((item): item is string => Boolean(item));
}

function isNativeHostProductRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ref = value.trim();
  if (!ref.startsWith('computer-use:native-host/')) return false;
  const lower = ref.toLowerCase();
  if (
    lower.startsWith('data:')
    || lower.startsWith('javascript:')
    || lower.startsWith('file:')
    || lower.startsWith('blob:')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//')
    || lower.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(ref)
    || /(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(ref)
  ) return false;
  return !/[\r\n]/.test(ref);
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
      surfaceIdentityRef: record.surfaceIdentityRef,
      surfaceIdentity: record.surfaceIdentity,
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
        record.surfaceIdentityRef,
        record.surfaceIdentity.surfaceOwnerRef,
        record.surfaceIdentity.displayOwnerRef,
        record.providerLifecycleSessionRef,
        record.liveBindingAttachGrantRef,
        record.grantValidationRef,
      ]),
    },
  };
}

async function recordNativeHostPermissionLedgerCommand(
  command: VirtualAppScreenRuntimeCommand,
  type: 'permission.handoff' | 'permission.recheck',
): Promise<NativeHostResult<NativeHostPermissionLedgerRecord> | undefined> {
  const record = readVirtualAppScreenNativeHostSessionRecord({
    sessionRef: command.refs.sessionRef,
    screenRef: command.refs.screenRef,
  });
  if (!record) return undefined;
  const request: {
    permissionHandoffRef?: string;
    recheckRef?: string;
    permissionRef?: string;
    adapterReadinessRef?: string;
    providerReadinessRef?: string;
    platformDriverRef?: string;
    blockedRef?: string;
  } = {
    permissionHandoffRef: command.refs.permissionHandoffRef,
    recheckRef: command.refs.permissionRecheckRef,
    permissionRef: command.refs.permissionRef,
    adapterReadinessRef: command.refs.readinessRef,
    platformDriverRef: command.refs.platformDriverRef,
    blockedRef: command.refs.blockedRef,
  };
  if (type === 'permission.recheck' && record.host.refreshPermissionReadiness) {
    const refreshed = await record.host.refreshPermissionReadiness(record.sessionId, request);
    if (refreshed.status === 'blocked') return refreshed;
    request.adapterReadinessRef = refreshed.value.adapterReadinessRef;
    request.providerReadinessRef = refreshed.value.providerRefs[0] ?? request.providerReadinessRef;
    request.platformDriverRef = refreshed.value.driverRefs[0] ?? request.platformDriverRef;
  }
  const result = type === 'permission.handoff'
    ? record.host.recordPermissionHandoff(record.sessionId, request)
    : record.host.recordPermissionRecheck(record.sessionId, request);
  if (result.status === 'blocked') return result;
  const evidenceLedgerRef = record.host.getLedger(record.sessionId)?.ledgerRef ?? record.evidenceLedgerRef;
  let updatedRecord = record;
  let providerSessionRecord = readVirtualAppScreenProviderSessionRecord({
    screenRef: record.screenRef,
    sessionRef: record.sessionRef,
  });
  const adapterReadinessRef = result.value.refs.adapterReadinessRef;
  if (typeof adapterReadinessRef === 'string' && adapterReadinessRef.trim()) {
    updatedRecord = updateVirtualAppScreenNativeHostSessionReadiness({
      sessionRef: record.sessionRef,
      adapterReadinessRef,
      evidenceLedgerRef,
    }) ?? record;
    providerSessionRecord = updateVirtualAppScreenProviderSessionReadiness({
      screenRef: record.screenRef,
      sessionRef: record.sessionRef,
      adapterReadinessRef,
      evidenceLedgerRef,
    }) ?? providerSessionRecord;
  }
  return {
    status: 'ok',
    value: {
      entry: result.value,
      evidenceLedgerRef,
      record: updatedRecord,
      providerSessionRecord,
    },
  };
}

function withPermissionLedgerResult(
  result: VirtualAppScreenSessionManagerAttachResult,
  permissionLedger: NativeHostResult<NativeHostPermissionLedgerRecord> | undefined,
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
    surfaceIdentityRef?: string;
    surfaceOwnerRef?: string;
    displayOwnerRef?: string;
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
    surfaceIdentityRef: refs.surfaceIdentityRef,
    surfaceOwnerRef: refs.surfaceOwnerRef,
    displayOwnerRef: refs.displayOwnerRef,
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
