import type { VirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import type { VirtualAppScreenSessionManagerAttachResult } from './virtual-app-screen-session-manager.js';
import { sanitizeId } from './utils.js';
import type { VirtualDisplayTransport } from './virtual-display-provider.js';

export const VIRTUAL_APP_SCREEN_PROVIDER_SESSION_RECORD_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-provider-session-record.v1' as const;

export interface VirtualAppScreenProviderSessionRecord {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_PROVIDER_SESSION_RECORD_SCHEMA;
  providerSessionOwnerRef: string;
  reconnectRef: string;
  surfaceIdentityRef: string;
  surfaceIdentity: VirtualAppScreenSurfaceIdentity;
  providerLifecycleSessionRef?: string;
  liveBindingAttachGrantRef: string;
  grantValidationRef: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  screenRef: string;
  providerId: string;
  executorId: string;
  currentRunRef: string;
  transport: VirtualDisplayTransport;
  sessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  surfaceTransportRef: string;
  frameTransportContractRef: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  displayGroupRef?: string;
  inputLeaseRef?: string;
  actionAdapterRef?: string;
  adapterReadinessRef: string;
  platformDriverRef?: string;
  permissionRef?: string;
  evidenceLedgerRef: string;
  guiPresentRef?: string;
  currentFrameSequence?: number;
  owner: 'VirtualDisplayProvider' | 'NativeVirtualAppScreenHost';
  singleInteractiveTruth: true;
  secondInteractiveSurfacePresent: false;
  currentSessionOnly: true;
}

export interface VirtualAppScreenSurfaceIdentity {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-surface-identity.v1';
  screenRef: string;
  sessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  surfaceTransportRef: string;
  providerSessionOwnerRef: string;
  providerSessionReconnectRef: string;
  liveBindingAttachGrantRef: string;
  grantValidationRef: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  providerId: string;
  executorId: string;
  owner: 'VirtualDisplayProvider' | 'NativeVirtualAppScreenHost';
  singleInteractiveTruth: true;
  secondInteractiveSurfacePresent: false;
  currentSessionOnly: true;
}

export type VirtualAppScreenProviderSessionReconnectReason =
  | 'resize'
  | 'tab-switch'
  | 'workspace-restore'
  | 'provider-reconnect';

export interface VirtualAppScreenProviderSessionReconnectInput {
  reason: VirtualAppScreenProviderSessionReconnectReason;
  screenRef?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  currentFrameSequence?: number;
  surfaceTransportRef?: string;
  providerSessionOwnerRef?: string;
  providerSessionReconnectRef?: string;
  surfaceIdentityRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  adapterReadinessRef?: string;
  evidenceLedgerRef?: string;
  guiPresentRef?: string;
}

export interface VirtualAppScreenProviderSessionReconnectResult {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-session-reconnect.v1';
  status: 'reconnected' | 'blocked';
  reason: VirtualAppScreenProviderSessionReconnectReason;
  record?: VirtualAppScreenProviderSessionRecord;
  previousRecord?: VirtualAppScreenProviderSessionRecord;
  blockedReason?: string;
  evidence: {
    sameSessionRef: boolean;
    sameLiveSurfaceRef: boolean;
    sameFrameStreamRef: boolean;
    sameProviderSessionOwnerRef: boolean;
    sameProviderSessionReconnectRef: boolean;
    sameSurfaceIdentityRef: boolean;
    sameSurfaceOwnerRef: boolean;
    sameDisplayOwnerRef: boolean;
    sameLiveBindingAttachGrantRef: boolean;
    sameGrantValidationRef: boolean;
    sameSurfaceTransportRef: boolean;
    currentFrameSequenceAdvanced: boolean;
    nativeSessionCreated: false;
    mutatingActionExecuted: false;
    createLaunchAttachSkipped: true;
    providerExecuted: false;
    evidenceRefs: string[];
  };
}

export interface VirtualAppScreenProviderSessionReadinessUpdateInput {
  screenRef?: string;
  sessionRef?: string;
  adapterReadinessRef: string;
  evidenceLedgerRef?: string;
}

const providerSessionRecordsByScreenRef = new Map<string, VirtualAppScreenProviderSessionRecord>();
const providerSessionRecordsBySessionRef = new Map<string, VirtualAppScreenProviderSessionRecord>();

export function recordVirtualAppScreenProviderSession(
  command: VirtualAppScreenRuntimeCommand,
  result: VirtualAppScreenSessionManagerAttachResult,
): VirtualAppScreenProviderSessionRecord | undefined {
  if (result.status !== 'attached') return undefined;
  const refs = result.refs;
  const surfaceTransport = result.evidence.surfaceTransport;
  if (
    !refs.sessionRef
    || !refs.liveSurfaceRef
    || !refs.frameStreamRef
    || !refs.currentFrameRef
    || !refs.surfaceTransportRef
    || !refs.frameTransportContractRef
    || !refs.evidenceLedgerRef
    || !surfaceTransport
    || !refs.screenRef && !command.refs.screenRef
  ) {
    return undefined;
  }
  const screenRef = refs.screenRef ?? command.refs.screenRef!;
  const scope = providerSessionScope(screenRef, refs.sessionRef);
  const liveBindingAttachGrantRef = refs.liveBindingAttachGrantRef
    ?? `computer-use:provider-session/${scope}/live-binding-attach-grant.json`;
  const grantValidationRef = refs.grantValidationRef
    ?? `computer-use:provider-session/${scope}/grant-validation.json`;
  const providerSessionOwnerRef = `computer-use:provider-session/${scope}/owner.json`;
  const reconnectRef = `computer-use:provider-session/${scope}/reconnect.json`;
  const surfaceIdentityRef = `computer-use:provider-session/${scope}/surface-identity.json`;
  const owner = refs.surfaceOwnerRef || refs.displayOwnerRef ? 'NativeVirtualAppScreenHost' as const : 'VirtualDisplayProvider' as const;
  const surfaceIdentity: VirtualAppScreenSurfaceIdentity = stripUndefined({
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-surface-identity.v1' as const,
    screenRef,
    sessionRef: refs.sessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    surfaceTransportRef: refs.surfaceTransportRef,
    providerSessionOwnerRef,
    providerSessionReconnectRef: reconnectRef,
    liveBindingAttachGrantRef,
    grantValidationRef,
    surfaceOwnerRef: refs.surfaceOwnerRef,
    displayOwnerRef: refs.displayOwnerRef,
    providerId: result.providerId,
    executorId: result.executorId,
    owner,
    singleInteractiveTruth: true as const,
    secondInteractiveSurfacePresent: false as const,
    currentSessionOnly: true as const,
  });
  const record: VirtualAppScreenProviderSessionRecord = stripUndefined({
    schemaVersion: VIRTUAL_APP_SCREEN_PROVIDER_SESSION_RECORD_SCHEMA,
    providerSessionOwnerRef,
    reconnectRef,
    surfaceIdentityRef,
    surfaceIdentity,
    providerLifecycleSessionRef: refs.providerLifecycleSessionRef,
    liveBindingAttachGrantRef,
    grantValidationRef,
    surfaceOwnerRef: refs.surfaceOwnerRef,
    displayOwnerRef: refs.displayOwnerRef,
    screenRef,
    providerId: result.providerId,
    executorId: result.executorId,
    currentRunRef: refs.currentRunRef,
    transport: surfaceTransport.transport,
    sessionRef: refs.sessionRef,
    liveSurfaceRef: refs.liveSurfaceRef,
    frameStreamRef: refs.frameStreamRef,
    currentFrameRef: refs.currentFrameRef,
    surfaceTransportRef: refs.surfaceTransportRef,
    frameTransportContractRef: refs.frameTransportContractRef,
    frameTelemetryRef: refs.frameTelemetryRef,
    mediaChannelRef: refs.mediaChannelRef,
    dataChannelRef: refs.dataChannelRef,
    targetAppRef: refs.targetAppRef ?? command.refs.targetAppRef,
    targetWindowRef: refs.targetWindowRef,
    displayGroupRef: refs.displayGroupRef,
    inputLeaseRef: refs.inputLeaseRef,
    actionAdapterRef: refs.actionAdapterRef,
    adapterReadinessRef: refs.adapterReadinessRef,
    platformDriverRef: refs.platformDriverRef,
    permissionRef: refs.permissionRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    guiPresentRef: refs.guiPresentRef,
    currentFrameSequence: result.evidence.surfaceTransport?.currentFrameSequence,
    owner,
    singleInteractiveTruth: true as const,
    secondInteractiveSurfacePresent: false as const,
    currentSessionOnly: true as const,
  });
  storeProviderSessionRecord(record);
  return record;
}

export function revalidateVirtualAppScreenProviderSession(
  input: VirtualAppScreenProviderSessionReconnectInput,
): VirtualAppScreenProviderSessionReconnectResult {
  const unsafe = unsafeReconnectRefs(input);
  if (unsafe.length) {
    return blockedReconnect(input, undefined, `VirtualAppScreen provider session reconnect ref ${unsafe[0]} is unsafe.`);
  }

  const recordByScreen = input.screenRef ? providerSessionRecordsByScreenRef.get(input.screenRef) : undefined;
  const recordBySession = input.sessionRef ? providerSessionRecordsBySessionRef.get(input.sessionRef) : undefined;
  const record = recordByScreen ?? recordBySession;
  if (!record) {
    return blockedReconnect(input, undefined, 'VirtualAppScreen provider session reconnect has no recorded runtime-owned provider session.');
  }
  if (recordByScreen && recordBySession && recordByScreen !== recordBySession) {
    return blockedReconnect(input, record, 'VirtualAppScreen provider session reconnect refs resolve to different recorded sessions.');
  }

  const requiredMissing = [
    input.screenRef ? undefined : 'screenRef',
    input.sessionRef ? undefined : 'sessionRef',
    input.liveSurfaceRef ? undefined : 'liveSurfaceRef',
    input.frameStreamRef ? undefined : 'frameStreamRef',
    input.surfaceTransportRef ? undefined : 'surfaceTransportRef',
    input.providerSessionOwnerRef ? undefined : 'providerSessionOwnerRef',
    input.providerSessionReconnectRef ? undefined : 'providerSessionReconnectRef',
    input.surfaceIdentityRef ? undefined : 'surfaceIdentityRef',
    input.surfaceOwnerRef || !record.surfaceIdentity.surfaceOwnerRef ? undefined : 'surfaceOwnerRef',
    input.displayOwnerRef || !record.surfaceIdentity.displayOwnerRef ? undefined : 'displayOwnerRef',
    input.liveBindingAttachGrantRef ? undefined : 'liveBindingAttachGrantRef',
    input.grantValidationRef ? undefined : 'grantValidationRef',
  ].filter((value): value is string => Boolean(value));
  if (requiredMissing.length) {
    return blockedReconnect(
      input,
      record,
      `VirtualAppScreen provider session reconnect requires original provider ownership refs: ${requiredMissing.join(', ')}.`,
    );
  }

  const evidence = reconnectEvidence(input, record);
  if (
    !evidence.sameSessionRef
    || !evidence.sameLiveSurfaceRef
    || !evidence.sameFrameStreamRef
    || !evidence.sameProviderSessionOwnerRef
    || !evidence.sameProviderSessionReconnectRef
    || !evidence.sameLiveBindingAttachGrantRef
    || !evidence.sameGrantValidationRef
    || !evidence.sameSurfaceTransportRef
  ) {
    return blockedReconnect(input, record, 'VirtualAppScreen provider session reconnect refs do not match the recorded runtime-owned session.');
  }
  const identityMismatches = reconnectSurfaceIdentityMismatches(input, record);
  if (identityMismatches.length) {
    return blockedReconnect(
      input,
      record,
      `VirtualAppScreen provider session reconnect surface identity drifted: ${identityMismatches.join(', ')}.`,
    );
  }

  const previousRecord = { ...record };
  const nextFrameRef = input.currentFrameRef ?? record.currentFrameRef;
  const nextFrameSequence = input.currentFrameSequence ?? record.currentFrameSequence;
  if (!safeProviderSessionRef(nextFrameRef)) {
    return blockedReconnect(input, record, 'VirtualAppScreen provider session reconnect currentFrameRef is unsafe.');
  }
  if (
    input.currentFrameSequence !== undefined
    && record.currentFrameSequence !== undefined
    && input.currentFrameSequence < record.currentFrameSequence
  ) {
    return blockedReconnect(input, record, 'VirtualAppScreen provider session reconnect cannot rewind the current frame sequence.');
  }

  const updated: VirtualAppScreenProviderSessionRecord = {
    ...record,
    currentFrameRef: nextFrameRef,
    currentFrameSequence: nextFrameSequence,
    adapterReadinessRef: input.adapterReadinessRef ?? record.adapterReadinessRef,
    evidenceLedgerRef: input.evidenceLedgerRef ?? record.evidenceLedgerRef,
    guiPresentRef: input.guiPresentRef ?? record.guiPresentRef,
  };
  storeProviderSessionRecord(updated);

  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-session-reconnect.v1',
    status: 'reconnected',
    reason: input.reason,
    record: updated,
    previousRecord,
    evidence: {
      ...evidence,
      currentFrameSequenceAdvanced: input.currentFrameSequence === undefined
        || previousRecord.currentFrameSequence === undefined
        || input.currentFrameSequence >= previousRecord.currentFrameSequence,
      nativeSessionCreated: false,
      mutatingActionExecuted: false,
      createLaunchAttachSkipped: true,
      providerExecuted: false,
      evidenceRefs: reconnectEvidenceRefs(input, updated),
    },
  };
}

export function updateVirtualAppScreenProviderSessionReadiness(
  input: VirtualAppScreenProviderSessionReadinessUpdateInput,
): VirtualAppScreenProviderSessionRecord | undefined {
  const unsafe = unsafeReconnectRefs({
    reason: 'provider-reconnect',
    screenRef: input.screenRef,
    sessionRef: input.sessionRef,
    adapterReadinessRef: input.adapterReadinessRef,
    evidenceLedgerRef: input.evidenceLedgerRef,
  });
  if (unsafe.length) return undefined;
  const recordByScreen = input.screenRef ? providerSessionRecordsByScreenRef.get(input.screenRef) : undefined;
  const recordBySession = input.sessionRef ? providerSessionRecordsBySessionRef.get(input.sessionRef) : undefined;
  if (recordByScreen && recordBySession && recordByScreen !== recordBySession) return undefined;
  const record = recordByScreen ?? recordBySession;
  if (!record) return undefined;
  const updated: VirtualAppScreenProviderSessionRecord = stripUndefined({
    ...record,
    adapterReadinessRef: input.adapterReadinessRef,
    evidenceLedgerRef: input.evidenceLedgerRef ?? record.evidenceLedgerRef,
  });
  storeProviderSessionRecord(updated);
  return updated;
}

export function readVirtualAppScreenProviderSessionRecord(options: {
  screenRef?: string;
  sessionRef?: string;
}): VirtualAppScreenProviderSessionRecord | undefined {
  if (options.screenRef) return providerSessionRecordsByScreenRef.get(options.screenRef);
  if (options.sessionRef) return providerSessionRecordsBySessionRef.get(options.sessionRef);
  return undefined;
}

export function resetVirtualAppScreenProviderSessionStoreForTests(): void {
  providerSessionRecordsByScreenRef.clear();
  providerSessionRecordsBySessionRef.clear();
}

function providerSessionScope(screenRef: string, sessionRef: string) {
  return sanitizeId(`${screenRef}-${sessionRef}`);
}

function storeProviderSessionRecord(record: VirtualAppScreenProviderSessionRecord): void {
  providerSessionRecordsByScreenRef.set(record.screenRef, record);
  providerSessionRecordsBySessionRef.set(record.sessionRef, record);
  if (record.providerLifecycleSessionRef) {
    providerSessionRecordsBySessionRef.set(record.providerLifecycleSessionRef, record);
  }
}

function blockedReconnect(
  input: VirtualAppScreenProviderSessionReconnectInput,
  record: VirtualAppScreenProviderSessionRecord | undefined,
  blockedReason: string,
): VirtualAppScreenProviderSessionReconnectResult {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-session-reconnect.v1',
    status: 'blocked',
    reason: input.reason,
    record,
    blockedReason,
    evidence: {
      ...reconnectEvidence(input, record),
      currentFrameSequenceAdvanced: false,
      nativeSessionCreated: false,
      mutatingActionExecuted: false,
      createLaunchAttachSkipped: true,
      providerExecuted: false,
      evidenceRefs: reconnectEvidenceRefs(input, record),
    },
  };
}

function reconnectEvidence(
  input: VirtualAppScreenProviderSessionReconnectInput,
  record: VirtualAppScreenProviderSessionRecord | undefined,
) {
  return {
    sameSessionRef: Boolean(record && input.sessionRef === record.sessionRef),
    sameLiveSurfaceRef: Boolean(record && input.liveSurfaceRef === record.liveSurfaceRef),
    sameFrameStreamRef: Boolean(record && input.frameStreamRef === record.frameStreamRef),
    sameProviderSessionOwnerRef: Boolean(record && input.providerSessionOwnerRef === record.providerSessionOwnerRef),
    sameProviderSessionReconnectRef: Boolean(record && input.providerSessionReconnectRef === record.reconnectRef),
    sameSurfaceIdentityRef: Boolean(record && input.surfaceIdentityRef === record.surfaceIdentityRef),
    sameSurfaceOwnerRef: Boolean(record && (!record.surfaceIdentity.surfaceOwnerRef || input.surfaceOwnerRef === record.surfaceIdentity.surfaceOwnerRef)),
    sameDisplayOwnerRef: Boolean(record && (!record.surfaceIdentity.displayOwnerRef || input.displayOwnerRef === record.surfaceIdentity.displayOwnerRef)),
    sameLiveBindingAttachGrantRef: Boolean(record && input.liveBindingAttachGrantRef === record.liveBindingAttachGrantRef),
    sameGrantValidationRef: Boolean(record && input.grantValidationRef === record.grantValidationRef),
    sameSurfaceTransportRef: Boolean(record && input.surfaceTransportRef === record.surfaceTransportRef),
  };
}

function reconnectEvidenceRefs(
  input: VirtualAppScreenProviderSessionReconnectInput,
  record: VirtualAppScreenProviderSessionRecord | undefined,
) {
  return uniqueRefs([
    input.adapterReadinessRef,
    input.evidenceLedgerRef,
    input.guiPresentRef,
    input.providerSessionOwnerRef,
    input.providerSessionReconnectRef,
    input.surfaceIdentityRef,
    input.surfaceOwnerRef,
    input.displayOwnerRef,
    input.liveBindingAttachGrantRef,
    input.grantValidationRef,
    record?.grantValidationRef,
    input.surfaceTransportRef,
    input.currentFrameRef,
    record?.providerSessionOwnerRef,
    record?.reconnectRef,
    record?.surfaceIdentityRef,
    record?.surfaceIdentity.surfaceOwnerRef,
    record?.surfaceIdentity.displayOwnerRef,
    record?.providerLifecycleSessionRef,
    record?.liveBindingAttachGrantRef,
    record?.grantValidationRef,
    record?.surfaceTransportRef,
    record?.currentFrameRef,
  ]);
}

function unsafeReconnectRefs(input: VirtualAppScreenProviderSessionReconnectInput) {
  const refs: Record<string, string | undefined> = {
    screenRef: input.screenRef,
    sessionRef: input.sessionRef,
    liveSurfaceRef: input.liveSurfaceRef,
    frameStreamRef: input.frameStreamRef,
    currentFrameRef: input.currentFrameRef,
    surfaceTransportRef: input.surfaceTransportRef,
    providerSessionOwnerRef: input.providerSessionOwnerRef,
    providerSessionReconnectRef: input.providerSessionReconnectRef,
    surfaceIdentityRef: input.surfaceIdentityRef,
    surfaceOwnerRef: input.surfaceOwnerRef,
    displayOwnerRef: input.displayOwnerRef,
    liveBindingAttachGrantRef: input.liveBindingAttachGrantRef,
    grantValidationRef: input.grantValidationRef,
    adapterReadinessRef: input.adapterReadinessRef,
    evidenceLedgerRef: input.evidenceLedgerRef,
    guiPresentRef: input.guiPresentRef,
  };
  return Object.entries(refs)
    .filter(([, ref]) => ref !== undefined && !safeProviderSessionRef(ref))
    .map(([key]) => key);
}

function reconnectSurfaceIdentityMismatches(
  input: VirtualAppScreenProviderSessionReconnectInput,
  record: VirtualAppScreenProviderSessionRecord,
) {
  const expected = record.surfaceIdentity;
  return [
    input.screenRef !== expected.screenRef ? 'screenRef' : undefined,
    input.sessionRef !== expected.sessionRef ? 'sessionRef' : undefined,
    input.liveSurfaceRef !== expected.liveSurfaceRef ? 'liveSurfaceRef' : undefined,
    input.frameStreamRef !== expected.frameStreamRef ? 'frameStreamRef' : undefined,
    input.surfaceTransportRef !== expected.surfaceTransportRef ? 'surfaceTransportRef' : undefined,
    input.providerSessionOwnerRef !== expected.providerSessionOwnerRef ? 'providerSessionOwnerRef' : undefined,
    input.providerSessionReconnectRef !== expected.providerSessionReconnectRef ? 'providerSessionReconnectRef' : undefined,
    input.liveBindingAttachGrantRef !== expected.liveBindingAttachGrantRef ? 'liveBindingAttachGrantRef' : undefined,
    input.grantValidationRef !== expected.grantValidationRef ? 'grantValidationRef' : undefined,
    expected.surfaceOwnerRef && input.surfaceOwnerRef !== expected.surfaceOwnerRef ? 'surfaceOwnerRef' : undefined,
    expected.displayOwnerRef && input.displayOwnerRef !== expected.displayOwnerRef ? 'displayOwnerRef' : undefined,
  ].filter((item): item is string => Boolean(item));
}

function safeProviderSessionRef(value: string | undefined) {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('data:')
    || lower.startsWith('javascript:')
    || lower.startsWith('file:')
    || lower.startsWith('blob:')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//')
    || lower.startsWith('/')
    || lower.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(normalized)
  ) return false;
  return !/[\r\n]/.test(normalized);
}

function uniqueRefs(refs: Array<string | undefined>) {
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref?.trim())))];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
