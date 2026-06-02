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
  liveBindingAttachGrantRef: string;
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
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
  guiPresentRef?: string;
  currentFrameSequence?: number;
  owner: 'VirtualDisplayProvider';
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
  liveBindingAttachGrantRef?: string;
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
    sameLiveBindingAttachGrantRef: boolean;
    sameSurfaceTransportRef: boolean;
    currentFrameSequenceAdvanced: boolean;
    nativeSessionCreated: false;
    mutatingActionExecuted: false;
    createLaunchAttachSkipped: true;
    providerExecuted: false;
    evidenceRefs: string[];
  };
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
  const record: VirtualAppScreenProviderSessionRecord = stripUndefined({
    schemaVersion: VIRTUAL_APP_SCREEN_PROVIDER_SESSION_RECORD_SCHEMA,
    providerSessionOwnerRef: `computer-use:provider-session/${scope}/owner.json`,
    reconnectRef: `computer-use:provider-session/${scope}/reconnect.json`,
    liveBindingAttachGrantRef: `computer-use:provider-session/${scope}/live-binding-attach-grant.json`,
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
    adapterReadinessRef: refs.adapterReadinessRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    guiPresentRef: refs.guiPresentRef,
    currentFrameSequence: result.evidence.surfaceTransport?.currentFrameSequence,
    owner: 'VirtualDisplayProvider' as const,
    singleInteractiveTruth: true as const,
    secondInteractiveSurfacePresent: false as const,
    currentSessionOnly: true as const,
  });
  providerSessionRecordsByScreenRef.set(screenRef, record);
  providerSessionRecordsBySessionRef.set(refs.sessionRef, record);
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
    input.liveBindingAttachGrantRef ? undefined : 'liveBindingAttachGrantRef',
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
    || !evidence.sameSurfaceTransportRef
  ) {
    return blockedReconnect(input, record, 'VirtualAppScreen provider session reconnect refs do not match the recorded runtime-owned session.');
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
  providerSessionRecordsByScreenRef.set(updated.screenRef, updated);
  providerSessionRecordsBySessionRef.set(updated.sessionRef, updated);

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
    sameLiveBindingAttachGrantRef: Boolean(record && input.liveBindingAttachGrantRef === record.liveBindingAttachGrantRef),
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
    input.liveBindingAttachGrantRef,
    input.surfaceTransportRef,
    input.currentFrameRef,
    record?.providerSessionOwnerRef,
    record?.reconnectRef,
    record?.liveBindingAttachGrantRef,
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
    liveBindingAttachGrantRef: input.liveBindingAttachGrantRef,
    adapterReadinessRef: input.adapterReadinessRef,
    evidenceLedgerRef: input.evidenceLedgerRef,
    guiPresentRef: input.guiPresentRef,
  };
  return Object.entries(refs)
    .filter(([, ref]) => ref !== undefined && !safeProviderSessionRef(ref))
    .map(([key]) => key);
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
