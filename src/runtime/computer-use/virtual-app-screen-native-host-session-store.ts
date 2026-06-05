import type {
  NativeHostFrame,
  NativeHostLiveSurface,
  NativeHostSession,
  NativeVirtualAppScreenHost,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

export const VIRTUAL_APP_SCREEN_NATIVE_HOST_SESSION_RECORD_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-native-host-session-record.v1' as const;

export interface VirtualAppScreenNativeHostSessionRecord {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_NATIVE_HOST_SESSION_RECORD_SCHEMA;
  owner: 'NativeVirtualAppScreenHost';
  host: NativeVirtualAppScreenHost;
  sessionId: string;
  sessionRef: string;
  screenRef?: string;
  targetWindowRef?: string;
  liveSurfaceRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  currentFrameSequence?: number;
  currentFrameReadAt?: string;
  currentRunRef: string;
  currentRunPointerRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
  permissionRefs: string[];
  driverRefs: string[];
  providerRefs: string[];
  inputLeaseRef?: string;
  actionAdapterRef?: string;
  diagnosticOnly: boolean;
  singleInteractiveTruth: true;
  secondInteractiveSurfacePresent: false;
  currentSessionOnly: true;
}

export interface RecordVirtualAppScreenNativeHostSessionInput {
  host: NativeVirtualAppScreenHost;
  session: NativeHostSession;
  surface?: NativeHostLiveSurface;
  frame?: NativeHostFrame;
  refs?: {
    inputLeaseRef?: string;
    actionAdapterRef?: string;
    adapterReadinessRef?: string;
    evidenceLedgerRef?: string;
    currentRunPointerRef?: string;
    grantValidationRef?: string;
  };
}

const nativeHostRecordsBySessionRef = new Map<string, VirtualAppScreenNativeHostSessionRecord>();
const nativeHostRecordsByScreenRef = new Map<string, VirtualAppScreenNativeHostSessionRecord>();

export function recordVirtualAppScreenNativeHostSession(
  input: RecordVirtualAppScreenNativeHostSessionInput,
): VirtualAppScreenNativeHostSessionRecord {
  const record: VirtualAppScreenNativeHostSessionRecord = stripUndefined({
    schemaVersion: VIRTUAL_APP_SCREEN_NATIVE_HOST_SESSION_RECORD_SCHEMA,
    owner: 'NativeVirtualAppScreenHost' as const,
    host: input.host,
    sessionId: input.session.sessionId,
    sessionRef: input.session.sessionRef,
    screenRef: input.surface?.screenRef,
    targetWindowRef: input.surface?.targetWindowRef,
    liveSurfaceRef: input.surface?.liveSurfaceRef,
    liveBindingAttachGrantRef: input.surface?.liveBindingAttachGrantRef,
    grantValidationRef: input.refs?.grantValidationRef,
    frameStreamRef: input.surface?.frameStreamRef,
    currentFrameRef: input.frame?.frameRef ?? input.surface?.currentFrameRef,
    currentFrameSequence: input.frame?.frameSequence ?? input.surface?.currentFrameSequence,
    currentFrameReadAt: input.frame?.readAt,
    currentRunRef: input.session.evidenceContext.currentRunRef,
    currentRunPointerRef: input.refs?.currentRunPointerRef ?? input.session.currentRunPointerRef,
    adapterReadinessRef: input.refs?.adapterReadinessRef ?? input.session.readiness.adapterReadinessRef,
    evidenceLedgerRef: input.refs?.evidenceLedgerRef ?? input.session.ledgerRef,
    permissionRefs: [...input.session.readiness.permissionRefs],
    driverRefs: [...input.session.readiness.driverRefs],
    providerRefs: [...input.session.readiness.providerRefs],
    inputLeaseRef: input.refs?.inputLeaseRef,
    actionAdapterRef: input.refs?.actionAdapterRef,
    diagnosticOnly: input.session.readiness.diagnosticOnly,
    singleInteractiveTruth: true as const,
    secondInteractiveSurfacePresent: false as const,
    currentSessionOnly: true as const,
  });
  nativeHostRecordsBySessionRef.set(record.sessionRef, record);
  if (record.screenRef) nativeHostRecordsByScreenRef.set(record.screenRef, record);
  return record;
}

export function readVirtualAppScreenNativeHostSessionRecord(options: {
  sessionRef?: string;
  screenRef?: string;
}): VirtualAppScreenNativeHostSessionRecord | undefined {
  const bySession = options.sessionRef ? nativeHostRecordsBySessionRef.get(options.sessionRef) : undefined;
  const byScreen = options.screenRef ? nativeHostRecordsByScreenRef.get(options.screenRef) : undefined;
  if (bySession && byScreen && bySession !== byScreen) return undefined;
  return bySession ?? byScreen;
}

export function updateVirtualAppScreenNativeHostSessionFrame(options: {
  sessionRef: string;
  frame: NativeHostFrame;
}): VirtualAppScreenNativeHostSessionRecord | undefined {
  const record = nativeHostRecordsBySessionRef.get(options.sessionRef);
  if (!record) return undefined;
  const updated: VirtualAppScreenNativeHostSessionRecord = {
    ...record,
    currentFrameRef: options.frame.frameRef,
    currentFrameSequence: options.frame.frameSequence,
    currentFrameReadAt: options.frame.readAt,
  };
  nativeHostRecordsBySessionRef.set(updated.sessionRef, updated);
  if (updated.screenRef) nativeHostRecordsByScreenRef.set(updated.screenRef, updated);
  return updated;
}

export function updateVirtualAppScreenNativeHostSessionReadiness(options: {
  sessionRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef?: string;
}): VirtualAppScreenNativeHostSessionRecord | undefined {
  const record = nativeHostRecordsBySessionRef.get(options.sessionRef);
  if (!record) return undefined;
  const updated: VirtualAppScreenNativeHostSessionRecord = stripUndefined({
    ...record,
    adapterReadinessRef: options.adapterReadinessRef,
    evidenceLedgerRef: options.evidenceLedgerRef ?? record.evidenceLedgerRef,
  });
  nativeHostRecordsBySessionRef.set(updated.sessionRef, updated);
  if (updated.screenRef) nativeHostRecordsByScreenRef.set(updated.screenRef, updated);
  return updated;
}

export function resetVirtualAppScreenNativeHostSessionStoreForTests(): void {
  nativeHostRecordsBySessionRef.clear();
  nativeHostRecordsByScreenRef.clear();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
