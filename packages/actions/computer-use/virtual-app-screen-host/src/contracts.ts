export const NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION =
  'sciforge.computer-use.native-virtual-app-screen-host.v1' as const;

export const NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL = [
  'describe',
  'probe',
  'createSession',
  'launchOrAttachApp',
  'attachSurface',
  'presentSurface',
  'readFrame',
  'sendHumanInput',
  'executeAutomationIntent',
  'recordPermissionHandoff',
  'recordPermissionRecheck',
  'pauseAgent',
  'resumeAgent',
  'closeSession',
  'validateGrant',
] as const;

export type NativeVirtualAppScreenHostProtocolMethod =
  typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL[number];

export type NativeHostPlatform = 'darwin' | 'linux' | 'win32' | 'unknown';

export type NativeHostSurfaceTransport =
  | 'native-presented-surface'
  | 'webrtc'
  | 'native-frame-stream';

export type NativeHostInputAdapterKind =
  | 'app-command'
  | 'ax'
  | 'uia'
  | 'at-spi'
  | 'virtual-display-input';

export type NativeHostSessionStatus =
  | 'created'
  | 'app-attached'
  | 'surface-attached'
  | 'paused'
  | 'stopped'
  | 'closed'
  | 'blocked';

export type NativeHostReadinessStatus =
  | 'ready'
  | 'blocked'
  | 'requires-handoff'
  | 'installable'
  | 'unsupported';

export type NativeHostErrorCode =
  | 'permission-missing'
  | 'driver-missing'
  | 'provider-unavailable'
  | 'session-not-found'
  | 'session-stopped'
  | 'session-closed'
  | 'surface-not-attached'
  | 'invalid-grant'
  | 'missing-frame'
  | 'missing-evidence'
  | 'automation-barrier-not-ready'
  | 'shared-system-input-blocked'
  | 'unsupported-platform'
  | 'unsafe-input'
  | 'stale-current-run'
  | 'stale-frame'
  | 'fixture-live-source-blocked'
  | 'ui-owned-source-blocked';

export const NATIVE_HOST_ERROR_TAXONOMY = {
  permission: ['permission-missing'],
  provider: ['driver-missing', 'provider-unavailable', 'unsupported-platform'],
  session: ['session-not-found', 'session-stopped', 'session-closed', 'surface-not-attached', 'stale-current-run', 'stale-frame'],
  grant: ['invalid-grant'],
  evidence: ['missing-frame', 'missing-evidence'],
  input: ['shared-system-input-blocked', 'unsafe-input'],
  automation: ['automation-barrier-not-ready'],
  ownership: ['fixture-live-source-blocked', 'ui-owned-source-blocked'],
} as const satisfies Record<string, readonly NativeHostErrorCode[]>;

export interface NativeHostError {
  code: NativeHostErrorCode;
  message: string;
  ref?: string;
  blockedReasonRef?: string;
  handoffRef?: string;
  recheckRef?: string;
}

export interface NativeHostCapabilityFlags {
  createDisplay: boolean;
  launchApp: boolean;
  attachWindow: boolean;
  captureFrame: boolean;
  streamFrames: boolean;
  sendHumanInput: boolean;
  executeAutomationIntent: boolean;
  validateGrant: boolean;
  writeEvidenceLedger: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
}

export interface NativeVirtualAppScreenHostDescription {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  hostId: string;
  platform: NativeHostPlatform;
  backendKind: string;
  protocol: NativeVirtualAppScreenHostProtocolMethod[];
  supportedApps: string[];
  supportedTransports: NativeHostSurfaceTransport[];
  supportedInputAdapters: NativeHostInputAdapterKind[];
  capabilities: NativeHostCapabilityFlags;
  permissionRefs: string[];
  blockedReason?: string;
  diagnosticOnly: boolean;
  thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only';
}

export interface NativeHostReadinessRecord {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  status: NativeHostReadinessStatus;
  adapterKind: string;
  platform: NativeHostPlatform;
  checkedAt: string;
  adapterReadinessRef: string;
  permissionRefs: string[];
  driverRefs: string[];
  providerRefs: string[];
  capabilities: NativeHostCapabilityFlags;
  diagnosticOnly: boolean;
  blockedReason?: string;
  handoffRef?: string;
  recheckRef?: string;
}

export interface NativeHostEvidenceContext {
  currentRunRef: string;
  evidenceRootRef: string;
  currentRunPointerRef?: string;
  guiPresentRef?: string;
}

export interface NativeHostSessionProfile {
  profileId: string;
  displayName?: string;
  defaultSurfaceTransport?: NativeHostSurfaceTransport;
  metadata?: Record<string, unknown>;
}

export interface NativeHostPermissionRequest {
  allowBackgroundRendering: boolean;
  allowSharedSystemInput: false;
  requestedPermissionRefs?: string[];
  providerReadinessRef?: string;
  leaseRef?: string;
}

export interface NativeHostAppProfile {
  appId: string;
  appRef: string;
  title?: string;
  launchCommandRef?: string;
  workspaceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface NativeHostSurfaceTarget {
  surfaceId?: string;
  screenRef: string;
  targetWindowRef: string;
  transport: NativeHostSurfaceTransport;
  boundsRef?: string;
}

export interface NativeHostLiveSurface {
  surfaceId: string;
  screenRef: string;
  targetAppRef: string;
  targetWindowRef: string;
  sessionRef: string;
  liveSurfaceRef: string;
  liveBindingAttachGrantRef: string;
  surfaceOwnerRef: string;
  displayOwnerRef: string;
  surfaceTransport: NativeHostSurfaceTransport;
  surfaceTransportRef: string;
  frameStreamRef: string;
  frameTransportContractRef?: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  currentFrameRef?: string;
  currentFrameHash?: string;
  currentFrameSequence: number;
}

export interface NativeHostSession {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  sessionId: string;
  sessionRef: string;
  hostId: string;
  status: NativeHostSessionStatus;
  createdAt: string;
  updatedAt: string;
  profile: NativeHostSessionProfile;
  permissions: NativeHostPermissionRequest;
  evidenceContext: Required<NativeHostEvidenceContext>;
  readiness: NativeHostReadinessRecord;
  app?: NativeHostAppProfile;
  surface?: NativeHostLiveSurface;
  ledgerRef: string;
  currentRunPointerRef: string;
}

export interface NativeHostFrame {
  frameRef: string;
  frameHash: string;
  frameSequence: number;
  liveSurfaceRef: string;
  frameStreamRef: string;
  readAt: string;
}

export type NativeHostHumanInputKind =
  | 'click'
  | 'double-click'
  | 'pointer-down'
  | 'pointer-up'
  | 'pointer-move'
  | 'drag'
  | 'scroll'
  | 'key-down'
  | 'key-up'
  | 'type-text';

export interface NativeHostHumanInputEvent {
  kind: NativeHostHumanInputKind;
  screenRef: string;
  targetWindowRef?: string;
  xRatio?: number;
  yRatio?: number;
  endXRatio?: number;
  endYRatio?: number;
  deltaX?: number;
  deltaY?: number;
  textRef?: string;
  key?: string;
  keySequence?: string[];
  inputIntentRef?: string;
}

export interface NativeHostHumanInputAccepted {
  inputAcceptedRef: string;
  inputSequence: number;
  acceptedAt: string;
  fireAndRelease: true;
  evidenceWillCatchUp: true;
}

export interface NativeHostAutomationIntent {
  intentRef: string;
  kind: string;
  targetWindowRef: string;
  beforeFrameRef: string;
  verifierRef?: string;
  metadata?: Record<string, unknown>;
}

export interface NativeHostAutomationBarrier {
  barrierRef: string;
  currentRunRef: string;
  requiredReadinessRef: string;
  beforeFrameRef?: string;
  leaseRef?: string;
  expiresAt?: string;
  resumeAfterPermissionRecheckRef?: string;
}

export interface NativeHostAutomationResult {
  automationBarrierRef: string;
  beforeFrameRef: string;
  afterFrameRef: string;
  verifierRef: string;
  evidenceLedgerRef: string;
  completedAt: string;
}

export interface NativeHostPermissionLedgerRequest {
  permissionHandoffRef?: string;
  recheckRef?: string;
  permissionRef?: string;
  adapterReadinessRef?: string;
  platformDriverRef?: string;
  blockedRef?: string;
}

export type NativeHostLedgerEventType =
  | 'session.created'
  | 'app.launched'
  | 'surface.attached'
  | 'frame.read'
  | 'human-input.accepted'
  | 'automation.barrier-completed'
  | 'permission.handoff'
  | 'permission.recheck'
  | 'agent.paused'
  | 'agent.resumed'
  | 'session.stopped'
  | 'session.closed'
  | 'grant.validated';

export interface NativeHostLedgerRefs {
  sessionRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  liveSurfaceRef?: string;
  liveBindingAttachGrantRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  frameRef?: string;
  inputIntentRef?: string;
  inputAcceptedRef?: string;
  automationIntentRef?: string;
  automationBarrierRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  verifierRef?: string;
  permissionHandoffRef?: string;
  recheckRef?: string;
  permissionRef?: string;
  adapterReadinessRef?: string;
  platformDriverRef?: string;
  blockedRef?: string;
  agentPauseRef?: string;
  agentResumeRef?: string;
  stoppedRef?: string;
  closedRef?: string;
}

export interface NativeHostLedgerEntry {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  type: NativeHostLedgerEventType;
  sequence: number;
  eventRef: string;
  sessionId: string;
  currentRunRef: string;
  recordedAt: string;
  refs: NativeHostLedgerRefs;
  previousSha256?: string;
  sha256: string;
  source: 'native-virtual-app-screen-host';
  diagnosticOnly: boolean;
}

export interface NativeHostEvidenceLedger {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  ledgerRef: string;
  sessionId: string;
  sessionRef: string;
  currentRunRef: string;
  currentRunPointerRef: string;
  entries: NativeHostLedgerEntry[];
  headSha256?: string;
}

export interface NativeHostLiveBindingGrant {
  schemaVersion: typeof NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION;
  grantRef: string;
  sessionId: string;
  surfaceId: string;
  currentRunRef: string;
  liveSurfaceRef: string;
  surfaceTransportRef: string;
  frameStreamRef: string;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  validatedAt?: string;
  validationLedgerEntryRef?: string;
}

export interface NativeHostGrantValidation {
  ok: boolean;
  grantRef?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  currentRunRef?: string;
  validationLedgerEntryRef?: string;
  issues: string[];
}

export interface NativeHostValidationResult {
  ok: boolean;
  issues: string[];
}

export type NativeHostResult<T> =
  | {
      status: 'ok';
      value: T;
    }
  | {
      status: 'blocked';
      error: NativeHostError;
      readiness?: NativeHostReadinessRecord;
    };

export type NativeHostMaybePromise<T> = T | Promise<T>;

export interface NativeVirtualAppScreenPlatformAdapter {
  describe(): NativeVirtualAppScreenHostDescription;
  probe(): NativeHostReadinessRecord;
  launchOrAttachApp?(session: NativeHostSession, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostAppProfile>;
  attachSurface?(session: NativeHostSession, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface>;
  readFrame?(session: NativeHostSession, cursor?: string): NativeHostResult<NativeHostFrame>;
  sendHumanInput?(
    session: NativeHostSession,
    inputEvent: NativeHostHumanInputEvent,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostHumanInputAccepted>>;
  executeAutomationIntent?(
    session: NativeHostSession,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostAutomationResult>>;
  pauseAgent?(session: NativeHostSession, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  resumeAgent?(session: NativeHostSession, barrier: NativeHostAutomationBarrier): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  stop?(session: NativeHostSession, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  closeSession?(session: NativeHostSession): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
}

export interface NativeVirtualAppScreenHost {
  describe(): NativeVirtualAppScreenHostDescription;
  probe(): NativeHostReadinessRecord;
  createSession(
    profile: NativeHostSessionProfile,
    permissions: NativeHostPermissionRequest,
    evidenceContext: NativeHostEvidenceContext,
  ): NativeHostResult<NativeHostSession>;
  launchOrAttachApp(sessionId: string, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostSession>;
  launchApp(sessionId: string, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostSession>;
  attachSurface(sessionId: string, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface>;
  presentSurface(sessionId: string, grantRef: string): NativeHostResult<NativeHostGrantValidation>;
  readFrame(sessionId: string, cursor?: string): NativeHostResult<NativeHostFrame>;
  sendHumanInput(sessionId: string, inputEvent: NativeHostHumanInputEvent): NativeHostMaybePromise<NativeHostResult<NativeHostHumanInputAccepted>>;
  executeAutomationIntent(
    sessionId: string,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostAutomationResult>>;
  recordPermissionHandoff(sessionId: string, request?: NativeHostPermissionLedgerRequest): NativeHostResult<NativeHostLedgerEntry>;
  recordPermissionRecheck(sessionId: string, request?: NativeHostPermissionLedgerRequest): NativeHostResult<NativeHostLedgerEntry>;
  pauseAgent(sessionId: string, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  resumeAgent(sessionId: string, barrier: NativeHostAutomationBarrier): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  stop(sessionId: string, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  closeSession(sessionId: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>>;
  validateGrant(grantRef: string): NativeHostGrantValidation;
  getLedger(sessionId: string): NativeHostEvidenceLedger | undefined;
  validateLedger(sessionId: string, options?: {
    requireFrame?: boolean;
    requireHumanInput?: boolean;
    requireAutomationBarrier?: boolean;
    requireGrantValidation?: boolean;
    requirePermissionHandoff?: boolean;
    requirePermissionRecheck?: boolean;
  }): NativeHostValidationResult;
}
