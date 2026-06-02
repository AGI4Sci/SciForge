import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA =
  'sciforge.virtual-display.provider-description.v1' as const;
export const VIRTUAL_DISPLAY_READINESS_SCHEMA =
  'sciforge.virtual-display.readiness.v1' as const;
export const VIRTUAL_DISPLAY_PLATFORM_READINESS_SCHEMA =
  'sciforge.virtual-display.platform-readiness.v1' as const;
export const VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA =
  'sciforge.virtual-display.frame-transport-contract.v1' as const;
export const VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA =
  'sciforge.virtual-display.surface-transport.v1' as const;
export const VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA =
  'sciforge.virtual-display.frame-telemetry.v1' as const;

export type VirtualDisplayPlatform = 'darwin' | 'linux' | 'win32';
export type VirtualDisplayTransport =
  | 'webrtc'
  | 'native-frame-stream';
export type VirtualDisplayInputAdapter =
  | 'app-command'
  | 'ax'
  | 'uia'
  | 'at-spi'
  | 'virtual-display-input';
export type VirtualDisplayProviderInstallState = 'installed' | 'installable' | 'unsupported';
export type VirtualDisplayProviderStatus = 'ready' | 'blocked' | 'permission-missing';
export type VirtualDisplayAttachState =
  | 'attached'
  | 'adapter-unavailable'
  | 'permission-missing'
  | 'observe-only'
  | 'blocked'
  | 'requires-handoff';
export type VirtualDisplayProviderMethod =
  | 'probe'
  | 'createSession'
  | 'launchApp'
  | 'attachSurface'
  | 'readFrame'
  | 'sendInputIntent'
  | 'pause'
  | 'resume'
  | 'handoff'
  | 'closeSession';
export type VirtualDisplayProviderReadinessStatus = 'ready' | 'blocked' | 'permission-missing';
export type VirtualDisplayPermissionState = 'granted' | 'missing' | 'not-required';
export type VirtualDisplayFrameMediaKind = 'webrtc-video-track' | 'native-frame-stream';
export type VirtualDisplayFrameDataChannelKind = 'webrtc-data-channel' | 'native-frame-control-channel';

export interface VirtualDisplayProviderCapabilities {
  createDisplay: boolean;
  launchApp: boolean;
  attachWindow: boolean;
  captureFrame: boolean;
  streamFrames: boolean;
  sendInputIntent: boolean;
  executeInputIntent?: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
}

export interface VirtualDisplayProviderDescription {
  schemaVersion: typeof VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA;
  providerId: string;
  platform: VirtualDisplayPlatform;
  backendKind: string;
  supportedApps?: string[];
  supportedTransports: VirtualDisplayTransport[];
  supportedInputAdapters: VirtualDisplayInputAdapter[];
  capabilities: VirtualDisplayProviderCapabilities;
  permissionRefs?: string[];
  blockedReason?: string;
}

export interface VirtualDisplayPermissionReadiness {
  requiredRefs: string[];
  grantedRefs: string[];
  missingRefs: string[];
  state: VirtualDisplayPermissionState;
}

export interface VirtualDisplayBackgroundRenderabilityReadiness {
  supported: boolean;
  proven: boolean;
}

export interface VirtualDisplayPhysicalDesktopImpactReadiness {
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  systemPointerMoved: boolean;
  systemKeyboardEventsSent: boolean;
  impact: 'none' | 'would-impact-physical-desktop';
}

export interface VirtualDisplayInputIsolationReadiness {
  supported: boolean;
  isolated: boolean;
  sharedSystemInputUsed: boolean;
  inputAdapterRefs: VirtualDisplayInputAdapter[];
}

export interface VirtualDisplayFrameTelemetrySample {
  sequence: number;
  observedAtMs?: number;
  captureToEncodeMs?: number;
  transportMs?: number;
  decodeToPresentMs?: number;
  endToEndMs?: number;
  frameBytes?: number;
  bufferedFrames?: number;
  maxBufferedFrames?: number;
  droppedSinceLastFrame?: number;
  skippedBackpressure?: number;
}

export interface VirtualDisplayFrameTelemetrySummary {
  schemaVersion: typeof VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA;
  sampleCount: number;
  firstSequence?: number;
  currentFrameSequence?: number;
  sequenceGapCount: number;
  p50EndToEndMs: number;
  p95EndToEndMs: number;
  maxEndToEndMs: number;
  latencyBoundMs: number;
  latencyBoundSatisfied: boolean;
  totalDroppedFrames: number;
  dropRate: number;
  backpressureEventCount: number;
  totalSkippedBackpressure: number;
  currentBufferedFrames: number;
  maxBufferedFrames: number;
  maxFrameBytes: number;
  currentFrameRef?: string;
  policy: {
    queueMode: 'drop-oldest-keep-current';
    boundedLatency: true;
    frameStreamIsTruthSource: false;
  };
}

export interface VirtualDisplayFrameTransportContract {
  schemaVersion: typeof VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA;
  transport: VirtualDisplayTransport;
  owner: 'VirtualDisplayProvider';
  providerId: string;
  screenRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  media: {
    kind: VirtualDisplayFrameMediaKind;
    mediaChannelRef: string;
    framePayloadMode: 'encoded-frame-ref' | 'native-frame-ref';
  };
  data: {
    kind: VirtualDisplayFrameDataChannelKind;
    dataChannelLabel: 'virtual-display-screen-control';
    dataChannelRef: string;
    carries: Array<'input-intent' | 'frame-ack' | 'telemetry' | 'reconnect'>;
  };
  telemetryRef: string;
  reconnect: {
    mode: 'resume-current-sequence';
    currentFrameSequence: number;
  };
  singleInteractiveTruth: true;
  diagnosticOnlyBackings: Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', true>;
  productFallbackBackings: Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', false>;
}

export interface VirtualDisplaySurfaceTransportDescriptor {
  schemaVersion: typeof VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA;
  owner: 'VirtualDisplayProvider';
  providerId: string;
  transport: VirtualDisplayTransport;
  surfaceTransportRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  frameTransportContractRef: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  currentFrameSequence?: number;
  diagnosticOnly: false;
  productFallback: false;
  singleInteractiveTruth: true;
}

export interface VirtualDisplayInputHotPathPolicy {
  schemaVersion: 'sciforge.virtual-display.input-hot-path.v1';
  priority: 'input-first';
  inputChannelRef: string;
  ackMode: 'bounded-action-ack';
  queueMode: 'separate-priority-lane';
  blockedByScreenshot: false;
  blockedByOcr: false;
  blockedByReplay: false;
  blockedByEvidenceCapture: false;
  frameCaptureDuringInput: 'skip-or-use-current-frame';
}

export interface VirtualDisplayPlatformReadinessRecord {
  schemaVersion: typeof VIRTUAL_DISPLAY_PLATFORM_READINESS_SCHEMA;
  platform: VirtualDisplayPlatform;
  providerId: string;
  providerKind: string;
  installState: VirtualDisplayProviderInstallState;
  permissions: VirtualDisplayPermissionReadiness;
  backgroundRenderability: VirtualDisplayBackgroundRenderabilityReadiness;
  physicalDesktopImpact: VirtualDisplayPhysicalDesktopImpactReadiness;
  inputIsolation: VirtualDisplayInputIsolationReadiness;
  status: VirtualDisplayProviderReadinessStatus;
  blockedReason?: string;
  diagnosticRefs: string[];
  installHintRefs: string[];
}

export interface VirtualDisplayReadiness {
  schemaVersion: typeof VIRTUAL_DISPLAY_READINESS_SCHEMA;
  providerId: string;
  platform: VirtualDisplayPlatform;
  providerKind: string;
  backendKind: string;
  installState: VirtualDisplayProviderInstallState;
  installationStatus: VirtualDisplayProviderInstallState;
  readinessStatus: VirtualDisplayProviderReadinessStatus;
  permissions: VirtualDisplayPermissionReadiness;
  backgroundRenderability: VirtualDisplayBackgroundRenderabilityReadiness;
  physicalDesktopImpact: VirtualDisplayPhysicalDesktopImpactReadiness;
  inputIsolation: VirtualDisplayInputIsolationReadiness;
  appIdentity?: Record<string, unknown>;
  windowIdentity?: Record<string, unknown>;
  displayIdentity?: Record<string, unknown>;
  captureSupported: boolean;
  liveSurfaceSupported: boolean;
  inputSupported: boolean;
  backgroundRenderable: boolean;
  affectsPhysicalDisplay: boolean;
  requiresFocusSteal: boolean;
  sharedSystemInputUsed: boolean;
  systemPointerMoved: boolean;
  systemKeyboardEventsSent: boolean;
  singleInteractiveTruth: boolean;
  frameTransportReadiness?: {
    contractSchemaVersion: typeof VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA;
    telemetrySchemaVersion: typeof VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA;
    supported: boolean;
    lowLatency: boolean;
    latencyBoundMs: number;
    p50EndToEndMs: number;
    p95EndToEndMs: number;
    currentFrameSequence: number;
    dropRate: number;
    backpressureEventCount: number;
    frameStreamIsTruthSource: false;
  };
  inputHotPath?: VirtualDisplayInputHotPathPolicy;
  permissionRefs: string[];
  diagnosticRefs: string[];
  installHintRefs: string[];
  selectedTransport?: VirtualDisplayTransport;
  blockedReason?: string;
}

export interface VirtualDisplayProviderProbe {
  description: VirtualDisplayProviderDescription;
  readiness: VirtualDisplayReadiness;
  platformReadiness: VirtualDisplayPlatformReadinessRecord;
  installState: VirtualDisplayProviderInstallState;
  missingRequirements: string[];
  installHints: string[];
  priority: number;
}

export interface VirtualDisplayProviderProbeBundle {
  schemaVersion: 'sciforge.virtual-display.provider-probe-bundle.v1';
  targetAppKind: string;
  hostPlatform: string;
  selectedProviderId?: string;
  probes: VirtualDisplayProviderProbe[];
  selectedReadiness?: VirtualDisplayReadiness;
  status: VirtualDisplayProviderStatus;
  blockedReason?: string;
}

export type VirtualDisplayProviderInvokeIntent =
  | VirtualDisplayProviderMethod
  | 'executeInputIntent';

export interface VirtualDisplayProviderInvokeResult {
  schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1';
  intent: VirtualDisplayProviderInvokeIntent;
  providerId?: string;
  status: VirtualDisplayProviderStatus;
  refs: Record<string, string | string[] | undefined>;
  surfaceTransport?: VirtualDisplaySurfaceTransportDescriptor;
  readiness?: VirtualDisplayReadiness;
  blockedReason?: string;
  providerExecuted: boolean;
  mutatingActionExecuted: boolean;
  rawPayloadWritten: false;
}

export interface VirtualDisplayProviderL1Contract {
  probe(options?: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  createSession(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  launchApp(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  attachSurface(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  readFrame(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  sendInputIntent(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  pause(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  resume(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  handoff(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
  closeSession(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult | Promise<VirtualDisplayProviderInvokeResult>;
}

export interface VirtualDisplayProviderL1SyncContract {
  probe(options?: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  createSession(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  launchApp(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  attachSurface(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  readFrame(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  sendInputIntent(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  pause(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  resume(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  handoff(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
  closeSession(options: VirtualDisplayProviderOperationOptions): VirtualDisplayProviderInvokeResult;
}

export interface VirtualDisplayProviderInputIntent {
  source: string;
  kind: string;
  action?: unknown;
  controlKind?: string;
  refs: {
    sessionRef?: string;
    screenRef?: string;
    targetAppRef?: string;
    targetWindowRef?: string;
    frameRef?: string;
    inputLeaseRef?: string;
    leaseControlRef?: string;
    actionAdapterRef?: string;
    adapterReadinessRef?: string;
    evidenceLedgerRef?: string;
    automationBarrierRef?: string;
    verifierRef?: string;
    [key: string]: unknown;
  };
  frame?: {
    width?: number;
    height?: number;
  };
  ratios?: Record<string, number>;
}

export interface VirtualDisplayProviderOperationOptions {
  runId: string;
  targetAppKind?: string;
  targetAppName?: string;
  probeOptions?: VirtualDisplayProviderProbeOptions;
  probeBundle?: VirtualDisplayProviderProbeBundle;
  blockedReason?: string;
  inputIntent?: VirtualDisplayProviderInputIntent;
}

export type VirtualDisplayProviderProjectionMap = Record<VirtualDisplayProviderMethod, readonly string[]>;

export const VIRTUAL_DISPLAY_PROVIDER_L1_PROJECTIONS: VirtualDisplayProviderProjectionMap = {
  probe: ['currentRunRef', 'providerProbeRef', 'adapterReadinessRef', 'blockedRef'],
  createSession: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'displayGroupRef', 'screenRef', 'targetAppRef', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef'],
  launchApp: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'targetAppRef', 'targetWindowRef', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef'],
  attachSurface: [
    'currentRunRef',
    'sessionRef',
    'sessionLeaseRef',
    'liveSurfaceRef',
    'surfaceTransportRef',
    'frameStreamRef',
    'currentFrameRef',
    'frameTransportContractRef',
    'frameTelemetryRef',
    'mediaChannelRef',
    'dataChannelRef',
    'lifecycleEventRef',
    'lifecycleLedgerRef',
    'evidenceLedgerRef',
    'beforeFrameRef',
    'afterFrameRef',
  ],
  readFrame: [
    'currentRunRef',
    'sessionRef',
    'sessionLeaseRef',
    'liveSurfaceRef',
    'surfaceTransportRef',
    'frameStreamRef',
    'currentFrameRef',
    'frameTransportContractRef',
    'frameTelemetryRef',
    'currentFrameSequence',
    'evidenceLedgerRef',
    'beforeFrameRef',
    'afterFrameRef',
  ],
  sendInputIntent: [
    'currentRunRef',
    'sessionRef',
    'sessionLeaseRef',
    'inputIntentRefs',
    'inputLeaseRef',
    'actionAdapterRef',
    'inputHotPathRef',
    'executorEventRefs',
    'evidenceLedgerRef',
    'lifecycleLedgerRef',
    'beforeFrameRef',
    'afterFrameRef',
    'beforeAfterFrameRefs',
    'verificationRefs',
  ],
  pause: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'agentQueueRef', 'inputIntentRefs', 'executorEventRefs', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs'],
  resume: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'agentQueueRef', 'currentFrameRefreshRef', 'inputIntentRefs', 'executorEventRefs', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs'],
  handoff: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'handoffRef', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef'],
  closeSession: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'agentQueueRef', 'safeStopRef', 'inputIntentRefs', 'executorEventRefs', 'lifecycleEventRef', 'lifecycleLedgerRef', 'evidenceLedgerRef', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs'],
} as const;

export interface VirtualDisplayScreenPayload {
  title: string;
  status: 'ready' | 'blocked' | 'permission-missing' | 'observe-only';
  attachState: VirtualDisplayAttachState;
  currentRunRef: string;
  displayGroupRef?: string;
  screenRef: string;
  liveSurfaceRef?: string;
  surfaceTransport?: VirtualDisplayTransport;
  surfaceTransportRef?: string;
  surfaceTransportDescriptor?: VirtualDisplaySurfaceTransportDescriptor;
  targetAppRef: string;
  targetWindowRef?: string;
  sessionRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  frameTransportContractRef?: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  currentFrameSequence?: number;
  frameTransport?: VirtualDisplayFrameTransportContract;
  frameTelemetry?: VirtualDisplayFrameTelemetrySummary;
  inputHotPath?: VirtualDisplayInputHotPathPolicy;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  beforeAfterFrameRefs?: string[];
  inputIntentRefs?: string[];
  executorEventRefs?: string[];
  inputLeaseRef?: string;
  sessionLeaseRef?: string;
  actionAdapterRef?: string;
  adapterReadinessRef: string;
  replayRef?: string;
  evidenceLedgerRef?: string;
  lifecycleLedgerRef?: string;
  artifactRefs?: string[];
  verificationRefs?: string[];
  guiPresentRefs?: string[];
  blockedRef?: string;
  blockedReason?: string;
  screen?: { width?: number; height?: number; label?: string };
  isolationFlags: {
    affectsPhysicalDisplay: boolean;
    requiresFocusSteal: boolean;
    sharedSystemInputUsed: boolean;
    systemPointerMoved: boolean;
    systemKeyboardEventsSent: boolean;
    backgroundRenderable: boolean;
    diagnosticOnly: boolean;
  };
  diagnosticOnlyTransports: Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', true>;
  productFallbackTransports: Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', false>;
}

interface ProviderDefinition extends VirtualDisplayProviderDescription {
  hostPlatforms: Array<NodeJS.Platform | 'any'>;
  priority: number;
  requiredCommands?: string[];
  anyCommandGroups?: string[][];
  requiredNodePackages?: string[];
  manualRequirementKeys?: string[];
  installHints: string[];
  installHintRefs: string[];
  permissionRefs: string[];
  transportPreference: VirtualDisplayTransport[];
}

export interface VirtualDisplayProviderProbeOptions {
  platform?: NodeJS.Platform | string;
  targetAppKind?: string;
  commandAvailability?: Record<string, boolean>;
  nodePackageAvailability?: Record<string, boolean>;
  manualRequirementAvailability?: Record<string, boolean>;
  permissionGrants?: Record<string, boolean>;
  frameTelemetrySamples?: VirtualDisplayFrameTelemetrySample[];
  latencyBoundMs?: number;
}

export type VirtualDisplayPlatformProbeOptions = Partial<Record<VirtualDisplayPlatform, VirtualDisplayProviderProbeOptions>>;

const requireFromHere = createRequire(import.meta.url);

export function describeVirtualDisplayProviders(
  platform: NodeJS.Platform | string = process.platform,
): VirtualDisplayProviderDescription[] {
  return providerDefinitions(platform).map(({ hostPlatforms: _hostPlatforms, priority: _priority, requiredCommands: _requiredCommands, anyCommandGroups: _anyCommandGroups, requiredNodePackages: _requiredNodePackages, manualRequirementKeys: _manualRequirementKeys, installHints: _installHints, installHintRefs: _installHintRefs, transportPreference: _transportPreference, ...description }) => description);
}

export function probeVirtualDisplayProviders(
  options: VirtualDisplayProviderProbeOptions = {},
): VirtualDisplayProviderProbeBundle {
  const platform = options.platform ?? process.platform;
  const targetAppKind = normalizeTargetAppKind(options.targetAppKind ?? 'vscode');
  const probes = providerDefinitions(platform)
    .filter((definition) => supportsTargetApp(definition, targetAppKind))
    .map((definition) => probeProvider(definition, { ...options, platform, targetAppKind }))
    .sort((left, right) => left.priority - right.priority || left.description.providerId.localeCompare(right.description.providerId));
  const selected = selectVirtualDisplayProviderProbe(probes);
  const selectedReadiness = selected?.readiness;
  const blockedReason = selectedReadiness && !isVirtualDisplayReadinessControllable(selectedReadiness)
    ? selectedReadiness.blockedReason
    : probes.length
      ? undefined
      : `No VirtualDisplayProvider profile supports target app kind "${targetAppKind}" on ${String(platform)}.`;
  return {
    schemaVersion: 'sciforge.virtual-display.provider-probe-bundle.v1',
    targetAppKind,
    hostPlatform: String(platform),
    selectedProviderId: selected?.description.providerId,
    probes,
    selectedReadiness,
    status: statusForReadiness(selectedReadiness, blockedReason),
    blockedReason,
  };
}

export function buildVirtualDisplayPlatformReadinessRecords(
  optionsByPlatform: VirtualDisplayPlatformProbeOptions = {},
  targetAppKind = 'vscode',
): VirtualDisplayPlatformReadinessRecord[] {
  return (['darwin', 'linux', 'win32'] as const).map((platform) => {
    const bundle = probeVirtualDisplayProviders({
      ...(optionsByPlatform[platform] ?? {}),
      platform,
      targetAppKind,
    });
    return bundle.probes[0]?.platformReadiness ?? noProviderPlatformReadinessRecord(platform, targetAppKind);
  });
}

export function readVirtualDisplayProvider(
  providerId: string,
  options: VirtualDisplayProviderProbeOptions = {},
): VirtualDisplayProviderDescription | undefined {
  return describeVirtualDisplayProviders(options.platform ?? process.platform)
    .find((provider) => provider.providerId === providerId);
}

export function queryVirtualDisplayProviders(
  filters: VirtualDisplayProviderProbeOptions & {
    backendKind?: string;
    supportedTransport?: VirtualDisplayTransport;
    supportedInputAdapter?: VirtualDisplayInputAdapter;
  } = {},
): VirtualDisplayProviderDescription[] {
  return describeVirtualDisplayProviders(filters.platform ?? process.platform)
    .filter((provider) => !filters.targetAppKind || supportsTargetApp(provider, normalizeTargetAppKind(filters.targetAppKind)))
    .filter((provider) => !filters.backendKind || provider.backendKind === filters.backendKind)
    .filter((provider) => !filters.supportedTransport || provider.supportedTransports.includes(filters.supportedTransport))
    .filter((provider) => !filters.supportedInputAdapter || provider.supportedInputAdapters.includes(filters.supportedInputAdapter));
}

export function createVirtualDisplayProviderContract(
  defaults: Partial<VirtualDisplayProviderOperationOptions> = {},
): VirtualDisplayProviderL1SyncContract {
  const call = (intent: VirtualDisplayProviderInvokeIntent, options: VirtualDisplayProviderOperationOptions = { runId: defaults.runId ?? 'virtual-display-provider' }) =>
    invokeVirtualDisplayProvider({ ...defaults, ...options, intent });
  return {
    probe: (options = { runId: defaults.runId ?? 'virtual-display-provider' }) => call('probe', options),
    createSession: (options) => call('createSession', options),
    launchApp: (options) => call('launchApp', options),
    attachSurface: (options) => call('attachSurface', options),
    readFrame: (options) => call('readFrame', options),
    sendInputIntent: (options) => call('sendInputIntent', options),
    pause: (options) => call('pause', options),
    resume: (options) => call('resume', options),
    handoff: (options) => call('handoff', options),
    closeSession: (options) => call('closeSession', options),
  };
}

export function invokeVirtualDisplayProvider(options: VirtualDisplayProviderOperationOptions & {
  intent: VirtualDisplayProviderInvokeIntent;
}): VirtualDisplayProviderInvokeResult {
  const probeBundle = options.probeBundle ?? probeVirtualDisplayProviders({
    ...(options.probeOptions ?? {}),
    targetAppKind: options.targetAppKind ?? options.probeOptions?.targetAppKind ?? 'vscode',
  });
  const readiness = probeBundle.selectedReadiness;
  const providerReady = isVirtualDisplayReadinessControllable(readiness);
  const payload = buildVirtualDisplayScreenPayload({
    runId: options.runId,
    targetAppKind: options.targetAppKind ?? probeBundle.targetAppKind,
    targetAppName: options.targetAppName,
    probeBundle,
    frameTelemetrySamples: options.probeOptions?.frameTelemetrySamples,
    latencyBoundMs: options.probeOptions?.latencyBoundMs,
  });
  if (options.intent === 'probe') {
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: options.intent,
      providerId: probeBundle.selectedProviderId,
      status: providerReady ? 'ready' : statusForBlockedReason(readiness?.blockedReason ?? probeBundle.blockedReason),
      refs: {
        currentRunRef: payload.currentRunRef,
        adapterReadinessRef: payload.adapterReadinessRef,
        providerProbeRef: `.sciforge/vision-runs/${sanitizeRefSegment(options.runId)}/virtual-display-provider/probe-bundle.json`,
        blockedRef: providerReady ? undefined : payload.blockedRef,
      },
      readiness,
      blockedReason: providerReady ? undefined : readiness?.blockedReason ?? probeBundle.blockedReason,
      providerExecuted: false,
      mutatingActionExecuted: false,
      rawPayloadWritten: false,
    };
  }
  if (!providerReady) {
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: options.intent,
      providerId: probeBundle.selectedProviderId,
      status: statusForBlockedReason(options.blockedReason ?? readiness?.blockedReason ?? probeBundle.blockedReason),
      refs: {
        currentRunRef: payload.currentRunRef,
        adapterReadinessRef: payload.adapterReadinessRef,
        blockedRef: payload.blockedRef,
      },
      readiness,
      blockedReason: options.blockedReason ?? readiness?.blockedReason ?? probeBundle.blockedReason ?? 'VirtualDisplayProvider is not ready.',
      providerExecuted: false,
      mutatingActionExecuted: false,
      rawPayloadWritten: false,
    };
  }
  return readyInvokeResult(options.intent, payload, readiness);
}

export function selectVirtualDisplayProviderProbe(
  probes: VirtualDisplayProviderProbe[],
): VirtualDisplayProviderProbe | undefined {
  return probes.find((probe) => isVirtualDisplayReadinessControllable(probe.readiness))
    ?? probes.find((probe) => probe.installState === 'installed')
    ?? probes.find((probe) => probe.installState === 'installable')
    ?? probes[0];
}

export function isVirtualDisplayReadinessControllable(readiness: VirtualDisplayReadiness | undefined): boolean {
  return Boolean(
    readiness
    && readiness.readinessStatus === 'ready'
    && readiness.captureSupported
    && readiness.liveSurfaceSupported
    && readiness.inputSupported
    && readiness.backgroundRenderable
    && readiness.affectsPhysicalDisplay === false
    && readiness.requiresFocusSteal === false
    && readiness.sharedSystemInputUsed === false
    && readiness.systemPointerMoved === false
    && readiness.systemKeyboardEventsSent === false
    && readiness.singleInteractiveTruth
    && !readiness.blockedReason,
  );
}

export function virtualDisplayReadinessToAdapterReadiness(readiness: VirtualDisplayReadiness) {
  return {
    adapterKind: readiness.backendKind,
    targetScope: 'virtual-app-screen',
    supportedActions: readiness.inputSupported
      ? ['click', 'type_text', 'drag', 'scroll', 'hotkey', 'menu_command']
      : [],
    captureSupported: readiness.captureSupported,
    backgroundRenderable: readiness.backgroundRenderable,
    affectsPhysicalDisplay: readiness.affectsPhysicalDisplay,
    requiresFocusSteal: readiness.requiresFocusSteal,
    sharedSystemInputUsed: readiness.sharedSystemInputUsed,
    permissions: readiness.permissions,
    backgroundRenderability: readiness.backgroundRenderability,
    physicalDesktopImpact: readiness.physicalDesktopImpact,
    inputIsolation: readiness.inputIsolation,
    frameTransportReadiness: readiness.frameTransportReadiness,
    inputHotPath: readiness.inputHotPath,
    blockedReason: readiness.blockedReason ?? null,
    schemaRefs: [
      'sciforge.computer-use.action-adapter-readiness.v1',
      VIRTUAL_DISPLAY_READINESS_SCHEMA,
      VIRTUAL_DISPLAY_PLATFORM_READINESS_SCHEMA,
    ],
  };
}

export function buildVirtualDisplayScreenPayload(options: {
  runId: string;
  targetAppKind?: string;
  targetAppName?: string;
  probeBundle: VirtualDisplayProviderProbeBundle;
  frameTelemetrySamples?: VirtualDisplayFrameTelemetrySample[];
  latencyBoundMs?: number;
}): VirtualDisplayScreenPayload {
  const runId = sanitizeRefSegment(options.runId);
  const targetAppKind = normalizeTargetAppKind(options.targetAppKind ?? options.probeBundle.targetAppKind);
  const targetAppName = options.targetAppName ?? (targetAppKind === 'vscode' ? 'VSCode' : targetAppKind);
  const readiness = options.probeBundle.selectedReadiness;
  const ready = isVirtualDisplayReadinessControllable(readiness);
  const status = ready ? 'ready' : readiness?.readinessStatus === 'permission-missing' ? 'permission-missing' : 'blocked';
  const baseRef = `.sciforge/vision-runs/${runId}/virtual-display-provider`;
  const currentRunRef = `.sciforge/vision-runs/${runId}/current-run.json`;
  const targetAppRef = `app:${runId}/${sanitizeRefSegment(targetAppKind)}`;
  const targetWindowRef = ready ? `window:${runId}/${sanitizeRefSegment(targetAppKind)}/main` : undefined;
  const sessionRef = ready ? `computer-use:session/${runId}/virtual-display-session.json` : undefined;
  const screenRef = `virtual-app-screen:${runId}/screen`;
  const liveSurfaceRef = ready ? `${baseRef}/live-surface.json` : undefined;
  const surfaceTransportRef = ready ? `${baseRef}/surface-transport.json` : undefined;
  const frameStreamRef = ready ? `${baseRef}/frame-stream.json` : undefined;
  const currentFrameRef = ready ? `${baseRef}/frames/after.json` : undefined;
  const frameTransportContractRef = ready ? `${baseRef}/frame-transport-contract.json` : undefined;
  const frameTelemetryRef = ready ? `${baseRef}/frame-telemetry.json` : undefined;
  const inputHotPathRef = ready ? `${baseRef}/input-hot-path.json` : undefined;
  const frameTelemetry = ready
    ? summarizeVirtualDisplayFrameTelemetry(
      options.frameTelemetrySamples ?? defaultFrameTelemetrySamples(),
      { currentFrameRef, latencyBoundMs: options.latencyBoundMs },
    )
    : undefined;
  const frameTransport = ready && readiness && liveSurfaceRef && frameStreamRef && currentFrameRef
    ? buildVirtualDisplayFrameTransportContract({
      providerId: readiness.providerId,
      transport: readiness.selectedTransport ?? 'webrtc',
      screenRef,
      liveSurfaceRef,
      frameStreamRef,
      currentFrameRef,
      baseRef,
      currentFrameSequence: frameTelemetry?.currentFrameSequence ?? 0,
    })
    : undefined;
  const surfaceTransportDescriptor = ready
    && readiness
    && liveSurfaceRef
    && surfaceTransportRef
    && frameStreamRef
    && currentFrameRef
    && frameTransportContractRef
    ? buildVirtualDisplaySurfaceTransportDescriptor({
      providerId: readiness.providerId,
      transport: readiness.selectedTransport ?? 'webrtc',
      surfaceTransportRef,
      liveSurfaceRef,
      frameStreamRef,
      currentFrameRef,
      frameTransportContractRef,
      frameTelemetryRef,
      mediaChannelRef: frameTransport?.media.mediaChannelRef,
      dataChannelRef: frameTransport?.data.dataChannelRef,
      currentFrameSequence: frameTelemetry?.currentFrameSequence,
    })
    : undefined;
  const inputHotPath = ready && inputHotPathRef
    ? buildVirtualDisplayInputHotPathPolicy(inputHotPathRef)
    : undefined;
  const blockedReason = readiness?.blockedReason
    ?? options.probeBundle.blockedReason
    ?? 'VirtualDisplayProvider is not ready for isolated background control.';
  return {
    title: `${targetAppName} VirtualAppScreen`,
    status,
    attachState: ready ? 'attached' : attachStateForReadiness(readiness),
    currentRunRef,
    displayGroupRef: ready ? `virtual-display-group:${runId}` : undefined,
    screenRef,
    liveSurfaceRef,
    surfaceTransport: ready ? readiness?.selectedTransport ?? 'webrtc' : undefined,
    surfaceTransportRef,
    surfaceTransportDescriptor,
    targetAppRef,
    targetWindowRef,
    sessionRef,
    frameStreamRef,
    currentFrameRef,
    frameTransportContractRef,
    frameTelemetryRef,
    mediaChannelRef: frameTransport?.media.mediaChannelRef,
    dataChannelRef: frameTransport?.data.dataChannelRef,
    currentFrameSequence: frameTelemetry?.currentFrameSequence,
    frameTransport,
    frameTelemetry,
    inputHotPath,
    beforeFrameRef: ready ? `${baseRef}/frames/before.json` : undefined,
    afterFrameRef: ready ? `${baseRef}/frames/after.json` : undefined,
    beforeAfterFrameRefs: ready ? [`${baseRef}/before-after/input.json`] : [],
    inputIntentRefs: ready ? [`${baseRef}/input-intents/click-and-type.json`] : [],
    executorEventRefs: ready ? [`${baseRef}/executor-events/click-and-type.json`] : [],
    inputLeaseRef: ready ? `${baseRef}/input-lease.json` : undefined,
    sessionLeaseRef: ready ? `${baseRef}/session-lease.json` : undefined,
    actionAdapterRef: ready ? `${baseRef}/action-adapter.json` : undefined,
    adapterReadinessRef: `${baseRef}/adapter-readiness.json`,
    replayRef: ready ? `${baseRef}/replay.json` : undefined,
    evidenceLedgerRef: ready ? `${baseRef}/evidence-ledger.json` : undefined,
    lifecycleLedgerRef: ready ? `${baseRef}/lifecycle-ledger.json` : undefined,
    artifactRefs: ready ? [`artifact:${runId}/vscode-virtual-screen-note.md`] : [],
    verificationRefs: ready ? [`${baseRef}/verification/vscode-input.json`] : [],
    guiPresentRefs: ready ? [`gui:present/${runId}/screen-pane`] : [],
    blockedRef: ready ? undefined : `${baseRef}/blocked.json`,
    blockedReason: ready ? undefined : blockedReason,
    screen: { width: 1440, height: 900, label: `${targetAppName} virtual app surface` },
    isolationFlags: {
      affectsPhysicalDisplay: readiness?.affectsPhysicalDisplay ?? false,
      requiresFocusSteal: readiness?.requiresFocusSteal ?? false,
      sharedSystemInputUsed: readiness?.sharedSystemInputUsed ?? false,
      systemPointerMoved: readiness?.systemPointerMoved ?? false,
      systemKeyboardEventsSent: readiness?.systemKeyboardEventsSent ?? false,
      backgroundRenderable: ready,
      diagnosticOnly: !ready,
    },
    diagnosticOnlyTransports: diagnosticOnlyTransports(),
    productFallbackTransports: productFallbackTransports(),
  };
}

export function buildVirtualDisplayFrameTransportContract(input: {
  providerId: string;
  transport: VirtualDisplayTransport;
  screenRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  baseRef: string;
  currentFrameSequence: number;
}): VirtualDisplayFrameTransportContract {
  const mediaKind: VirtualDisplayFrameMediaKind = input.transport === 'webrtc'
    ? 'webrtc-video-track'
    : 'native-frame-stream';
  const dataKind: VirtualDisplayFrameDataChannelKind = input.transport === 'webrtc'
    ? 'webrtc-data-channel'
    : 'native-frame-control-channel';
  return {
    schemaVersion: VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA,
    transport: input.transport,
    owner: 'VirtualDisplayProvider',
    providerId: input.providerId,
    screenRef: input.screenRef,
    liveSurfaceRef: input.liveSurfaceRef,
    frameStreamRef: input.frameStreamRef,
    currentFrameRef: input.currentFrameRef,
    media: {
      kind: mediaKind,
      mediaChannelRef: `${input.baseRef}/${mediaKind}/live`,
      framePayloadMode: input.transport === 'webrtc' ? 'encoded-frame-ref' : 'native-frame-ref',
    },
    data: {
      kind: dataKind,
      dataChannelLabel: 'virtual-display-screen-control',
      dataChannelRef: `${input.baseRef}/${dataKind}/control`,
      carries: ['input-intent', 'frame-ack', 'telemetry', 'reconnect'],
    },
    telemetryRef: `${input.baseRef}/frame-telemetry.json`,
    reconnect: {
      mode: 'resume-current-sequence',
      currentFrameSequence: Math.max(0, Math.round(input.currentFrameSequence)),
    },
    singleInteractiveTruth: true,
    diagnosticOnlyBackings: diagnosticOnlyTransports(),
    productFallbackBackings: productFallbackTransports(),
  };
}

export function buildVirtualDisplaySurfaceTransportDescriptor(input: {
  providerId: string;
  transport: VirtualDisplayTransport;
  surfaceTransportRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  frameTransportContractRef: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  currentFrameSequence?: number;
}): VirtualDisplaySurfaceTransportDescriptor {
  return {
    schemaVersion: VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA,
    owner: 'VirtualDisplayProvider',
    providerId: input.providerId,
    transport: input.transport,
    surfaceTransportRef: input.surfaceTransportRef,
    liveSurfaceRef: input.liveSurfaceRef,
    frameStreamRef: input.frameStreamRef,
    currentFrameRef: input.currentFrameRef,
    frameTransportContractRef: input.frameTransportContractRef,
    frameTelemetryRef: input.frameTelemetryRef,
    mediaChannelRef: input.mediaChannelRef,
    dataChannelRef: input.dataChannelRef,
    currentFrameSequence: input.currentFrameSequence === undefined ? undefined : Math.max(0, Math.round(input.currentFrameSequence)),
    diagnosticOnly: false,
    productFallback: false,
    singleInteractiveTruth: true,
  };
}

const virtualDisplaySurfaceTransportDescriptorFields = new Set([
  'schemaVersion',
  'owner',
  'providerId',
  'transport',
  'surfaceTransportRef',
  'liveSurfaceRef',
  'frameStreamRef',
  'currentFrameRef',
  'frameTransportContractRef',
  'frameTelemetryRef',
  'mediaChannelRef',
  'dataChannelRef',
  'currentFrameSequence',
  'diagnosticOnly',
  'productFallback',
  'singleInteractiveTruth',
]);

export function isVirtualDisplayTransport(value: unknown): value is VirtualDisplayTransport {
  return value === 'webrtc' || value === 'native-frame-stream';
}

export function isVirtualDisplaySurfaceTransportDescriptorSafe(
  value: unknown,
): value is VirtualDisplaySurfaceTransportDescriptor {
  if (!isRecordLike(value)) return false;
  if (!Object.keys(value).every((key) => virtualDisplaySurfaceTransportDescriptorFields.has(key))) return false;
  const descriptor = value as Partial<VirtualDisplaySurfaceTransportDescriptor>;
  if (descriptor.schemaVersion !== VIRTUAL_DISPLAY_SURFACE_TRANSPORT_DESCRIPTOR_SCHEMA) return false;
  if (descriptor.owner !== 'VirtualDisplayProvider') return false;
  if (!safeDescriptorRef(descriptor.providerId)) return false;
  if (!isVirtualDisplayTransport(descriptor.transport)) return false;
  if (descriptor.diagnosticOnly !== false) return false;
  if (descriptor.productFallback !== false) return false;
  if (descriptor.singleInteractiveTruth !== true) return false;
  const requiredRefs = [
    descriptor.surfaceTransportRef,
    descriptor.liveSurfaceRef,
    descriptor.frameStreamRef,
    descriptor.currentFrameRef,
    descriptor.frameTransportContractRef,
  ];
  if (!requiredRefs.every(safeDescriptorRef)) return false;
  const optionalRefs = [
    descriptor.frameTelemetryRef,
    descriptor.mediaChannelRef,
    descriptor.dataChannelRef,
  ];
  if (!optionalRefs.every((ref) => ref === undefined || safeDescriptorRef(ref))) return false;
  return descriptor.currentFrameSequence === undefined
    || (Number.isFinite(descriptor.currentFrameSequence) && descriptor.currentFrameSequence >= 0);
}

export function virtualDisplaySurfaceTransportDescriptorFromRefs(input: {
  providerId?: string;
  readiness?: VirtualDisplayReadiness;
  refs: Record<string, string | string[] | undefined>;
  fallbackRefs?: Array<Record<string, string | string[] | undefined>>;
}): VirtualDisplaySurfaceTransportDescriptor | undefined {
  const refMaps = [input.refs, ...(input.fallbackRefs ?? [])];
  const transportCandidate = firstStringRef(refMaps, 'surfaceTransport') ?? input.readiness?.selectedTransport;
  if (!isVirtualDisplayTransport(transportCandidate)) return undefined;
  const providerId = input.providerId ?? input.readiness?.providerId;
  if (!safeDescriptorRef(providerId)) return undefined;
  const currentRunRef = firstStringRef(refMaps, 'currentRunRef');
  const providerBaseRef = virtualDisplayProviderBaseRefFromCurrentRunRef(currentRunRef);
  const surfaceTransportRef = firstStringRef(refMaps, 'surfaceTransportRef') ?? (providerBaseRef ? `${providerBaseRef}/surface-transport.json` : undefined);
  const liveSurfaceRef = firstStringRef(refMaps, 'liveSurfaceRef');
  const frameStreamRef = firstStringRef(refMaps, 'frameStreamRef');
  const currentFrameRef = firstStringRef(refMaps, 'currentFrameRef');
  const frameTransportContractRef = firstStringRef(refMaps, 'frameTransportContractRef') ?? (providerBaseRef ? `${providerBaseRef}/frame-transport-contract.json` : undefined);
  const frameTelemetryRef = firstStringRef(refMaps, 'frameTelemetryRef') ?? (providerBaseRef ? `${providerBaseRef}/frame-telemetry.json` : undefined);
  const mediaChannelRef = firstStringRef(refMaps, 'mediaChannelRef') ?? (providerBaseRef ? `${providerBaseRef}/${transportCandidate === 'webrtc' ? 'webrtc-video-track' : 'native-frame-stream'}/live` : undefined);
  const dataChannelRef = firstStringRef(refMaps, 'dataChannelRef') ?? (providerBaseRef ? `${providerBaseRef}/${transportCandidate === 'webrtc' ? 'webrtc-data-channel' : 'native-frame-control-channel'}/control` : undefined);
  if (!surfaceTransportRef || !liveSurfaceRef || !frameStreamRef || !currentFrameRef || !frameTransportContractRef) {
    return undefined;
  }
  const descriptor = buildVirtualDisplaySurfaceTransportDescriptor({
    providerId,
    transport: transportCandidate,
    surfaceTransportRef,
    liveSurfaceRef,
    frameStreamRef,
    currentFrameRef,
    frameTransportContractRef,
    frameTelemetryRef,
    mediaChannelRef,
    dataChannelRef,
    currentFrameSequence: nonNegativeFromString(firstStringRef(refMaps, 'currentFrameSequence')),
  });
  return isVirtualDisplaySurfaceTransportDescriptorSafe(descriptor) ? descriptor : undefined;
}

export function summarizeVirtualDisplayFrameTelemetry(
  samples: VirtualDisplayFrameTelemetrySample[],
  options: { currentFrameRef?: string; latencyBoundMs?: number } = {},
): VirtualDisplayFrameTelemetrySummary {
  const latencyBoundMs = nonNegativeOrDefault(options.latencyBoundMs, 100);
  const normalized = samples
    .filter((sample) => Number.isFinite(sample.sequence))
    .map((sample) => ({
      sequence: Math.max(0, Math.round(sample.sequence)),
      observedAtMs: nonNegative(sample.observedAtMs),
      captureToEncodeMs: nonNegative(sample.captureToEncodeMs),
      transportMs: nonNegative(sample.transportMs),
      decodeToPresentMs: nonNegative(sample.decodeToPresentMs),
      endToEndMs: nonNegative(sample.endToEndMs),
      frameBytes: nonNegative(sample.frameBytes),
      bufferedFrames: nonNegative(sample.bufferedFrames),
      maxBufferedFrames: nonNegative(sample.maxBufferedFrames),
      droppedSinceLastFrame: nonNegative(sample.droppedSinceLastFrame),
      skippedBackpressure: nonNegative(sample.skippedBackpressure),
    }))
    .sort((left, right) => left.sequence - right.sequence);
  const endToEndValues = normalized.map((sample) => sample.endToEndMs);
  const totalDroppedFrames = sum(normalized.map((sample) => sample.droppedSinceLastFrame));
  const sampleCount = normalized.length;
  const p95EndToEndMs = percentile(endToEndValues, 0.95);
  return {
    schemaVersion: VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA,
    sampleCount,
    firstSequence: normalized[0]?.sequence,
    currentFrameSequence: normalized.at(-1)?.sequence,
    sequenceGapCount: sequenceGapCount(normalized.map((sample) => sample.sequence)),
    p50EndToEndMs: percentile(endToEndValues, 0.50),
    p95EndToEndMs,
    maxEndToEndMs: max(endToEndValues),
    latencyBoundMs,
    latencyBoundSatisfied: p95EndToEndMs <= latencyBoundMs,
    totalDroppedFrames,
    dropRate: sampleCount + totalDroppedFrames > 0 ? roundRatio(totalDroppedFrames / (sampleCount + totalDroppedFrames)) : 0,
    backpressureEventCount: normalized.filter((sample) => sample.skippedBackpressure > 0 || (sample.maxBufferedFrames > 0 && sample.bufferedFrames >= sample.maxBufferedFrames)).length,
    totalSkippedBackpressure: sum(normalized.map((sample) => sample.skippedBackpressure)),
    currentBufferedFrames: normalized.at(-1)?.bufferedFrames ?? 0,
    maxBufferedFrames: max(normalized.map((sample) => sample.maxBufferedFrames)),
    maxFrameBytes: max(normalized.map((sample) => sample.frameBytes)),
    currentFrameRef: options.currentFrameRef,
    policy: {
      queueMode: 'drop-oldest-keep-current',
      boundedLatency: true,
      frameStreamIsTruthSource: false,
    },
  };
}

function probeProvider(
  definition: ProviderDefinition,
  options: VirtualDisplayProviderProbeOptions & { platform: NodeJS.Platform | string; targetAppKind: string },
): VirtualDisplayProviderProbe {
  const missingRequirements = missingInstallRequirements(definition, options);
  const hostSupported = definition.hostPlatforms.includes('any') || definition.hostPlatforms.includes(options.platform as NodeJS.Platform);
  const installState: VirtualDisplayProviderInstallState = !hostSupported
    ? 'unsupported'
    : missingRequirements.length
      ? 'installable'
      : 'installed';
  const missingPermissions = installState === 'installed'
    ? definition.permissionRefs.filter((ref) => options.permissionGrants?.[ref] !== true)
    : [];
  const blockedReason = blockedReasonForProbe(definition, installState, missingRequirements, missingPermissions);
  const usable = installState === 'installed' && missingPermissions.length === 0;
  const readinessStatus = readinessStatusForProbe(installState, missingPermissions, usable, blockedReason);
  const permissionReadiness = permissionReadinessFor(definition.permissionRefs, missingPermissions);
  const physicalDesktopImpact = physicalDesktopImpactFor(definition.capabilities);
  const inputIsolation = inputIsolationFor(definition, usable);
  const backgroundRenderability = {
    supported: definition.capabilities.backgroundRenderable,
    proven: usable && definition.capabilities.backgroundRenderable,
  };
  const diagnosticRefs = [`virtual-display-provider:${definition.providerId}/probe`];
  const frameTelemetry = summarizeVirtualDisplayFrameTelemetry(
    options.frameTelemetrySamples ?? defaultFrameTelemetrySamples(),
    { latencyBoundMs: options.latencyBoundMs },
  );
  const readiness: VirtualDisplayReadiness = {
    schemaVersion: VIRTUAL_DISPLAY_READINESS_SCHEMA,
    providerId: definition.providerId,
    platform: definition.platform,
    providerKind: definition.backendKind,
    backendKind: definition.backendKind,
    installState,
    installationStatus: installState,
    readinessStatus,
    permissions: permissionReadiness,
    backgroundRenderability,
    physicalDesktopImpact,
    inputIsolation,
    appIdentity: {
      targetAppKind: options.targetAppKind,
      supportedByProvider: true,
    },
    captureSupported: usable && definition.capabilities.captureFrame,
    liveSurfaceSupported: usable && definition.capabilities.streamFrames,
    inputSupported: usable && supportsInputIntent(definition.capabilities),
    backgroundRenderable: usable && definition.capabilities.backgroundRenderable,
    affectsPhysicalDisplay: definition.capabilities.affectsPhysicalDisplay,
    requiresFocusSteal: definition.capabilities.requiresFocusSteal,
    sharedSystemInputUsed: definition.capabilities.sharedSystemInputUsed,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    singleInteractiveTruth: usable,
    frameTransportReadiness: usable
      ? {
        contractSchemaVersion: VIRTUAL_DISPLAY_FRAME_TRANSPORT_CONTRACT_SCHEMA,
        telemetrySchemaVersion: VIRTUAL_DISPLAY_FRAME_TELEMETRY_SCHEMA,
        supported: true,
        lowLatency: frameTelemetry.latencyBoundSatisfied,
        latencyBoundMs: frameTelemetry.latencyBoundMs,
        p50EndToEndMs: frameTelemetry.p50EndToEndMs,
        p95EndToEndMs: frameTelemetry.p95EndToEndMs,
        currentFrameSequence: frameTelemetry.currentFrameSequence ?? 0,
        dropRate: frameTelemetry.dropRate,
        backpressureEventCount: frameTelemetry.backpressureEventCount,
        frameStreamIsTruthSource: false,
      }
      : undefined,
    inputHotPath: usable
      ? buildVirtualDisplayInputHotPathPolicy(`virtual-display-provider:${definition.providerId}/input-hot-path`)
      : undefined,
    permissionRefs: definition.permissionRefs,
    diagnosticRefs,
    installHintRefs: definition.installHintRefs,
    selectedTransport: usable ? definition.transportPreference[0] : undefined,
    blockedReason,
  };
  const platformReadiness: VirtualDisplayPlatformReadinessRecord = {
    schemaVersion: VIRTUAL_DISPLAY_PLATFORM_READINESS_SCHEMA,
    platform: definition.platform,
    providerId: definition.providerId,
    providerKind: definition.backendKind,
    installState,
    permissions: permissionReadiness,
    backgroundRenderability,
    physicalDesktopImpact,
    inputIsolation,
    status: readinessStatus,
    blockedReason,
    diagnosticRefs,
    installHintRefs: definition.installHintRefs,
  };
  return {
    description: {
      schemaVersion: definition.schemaVersion,
      providerId: definition.providerId,
      platform: definition.platform,
      backendKind: definition.backendKind,
      supportedApps: definition.supportedApps,
      supportedTransports: definition.supportedTransports,
      supportedInputAdapters: definition.supportedInputAdapters,
      capabilities: definition.capabilities,
      permissionRefs: definition.permissionRefs,
      blockedReason: definition.blockedReason,
    },
    readiness,
    platformReadiness,
    installState,
    missingRequirements,
    installHints: definition.installHints,
    priority: definition.priority,
  };
}

function missingInstallRequirements(
  definition: ProviderDefinition,
  options: VirtualDisplayProviderProbeOptions,
): string[] {
  const missing: string[] = [];
  for (const command of definition.requiredCommands ?? []) {
    if (!hasCommand(command, options)) missing.push(`command:${command}`);
  }
  for (const group of definition.anyCommandGroups ?? []) {
    if (!group.some((command) => hasCommand(command, options))) {
      missing.push(`one-of-command:${group.join('|')}`);
    }
  }
  for (const packageName of definition.requiredNodePackages ?? []) {
    if (!hasNodePackage(packageName, options)) missing.push(`node-package:${packageName}`);
  }
  for (const key of definition.manualRequirementKeys ?? []) {
    if (options.manualRequirementAvailability?.[key] !== true) missing.push(`manual:${key}`);
  }
  return missing;
}

function hasCommand(command: string, options: VirtualDisplayProviderProbeOptions) {
  const injected = options.commandAvailability?.[command];
  if (injected !== undefined) return injected;
  return defaultCommandExists(command);
}

function hasNodePackage(packageName: string, options: VirtualDisplayProviderProbeOptions) {
  const injected = options.nodePackageAvailability?.[packageName];
  if (injected !== undefined) return injected;
  try {
    requireFromHere.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function defaultCommandExists(command: string) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function blockedReasonForProbe(
  definition: ProviderDefinition,
  installState: VirtualDisplayProviderInstallState,
  missingRequirements: string[],
  missingPermissions: string[],
) {
  if (installState === 'unsupported') {
    return `${definition.providerId} is not supported on this host platform.`;
  }
  if (installState === 'installable') {
    return [
      `${definition.providerId} is installable but not installed.`,
      `Missing requirements: ${missingRequirements.join(', ')}.`,
      'SciForge will not install drivers, system extensions, or privileged services without explicit user handoff.',
    ].join(' ');
  }
  if (missingPermissions.length) {
    return [
      `${definition.providerId} is installed but permission or driver readiness is not proven.`,
      `Missing permission refs: ${missingPermissions.join(', ')}.`,
      'The run is blocked instead of using shared system input or the physical desktop.',
    ].join(' ');
  }
  return undefined;
}

function noProviderPlatformReadinessRecord(
  platform: VirtualDisplayPlatform,
  targetAppKind: string,
): VirtualDisplayPlatformReadinessRecord {
  const blockedReason = `No local native VirtualDisplayProvider is registered for ${targetAppKind} on ${platform}.`;
  return {
    schemaVersion: VIRTUAL_DISPLAY_PLATFORM_READINESS_SCHEMA,
    platform,
    providerId: `virtual-display.${platform}.none`,
    providerKind: 'none',
    installState: 'unsupported',
    permissions: {
      requiredRefs: [],
      grantedRefs: [],
      missingRefs: [],
      state: 'not-required',
    },
    backgroundRenderability: {
      supported: false,
      proven: false,
    },
    physicalDesktopImpact: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      impact: 'none',
    },
    inputIsolation: {
      supported: false,
      isolated: false,
      sharedSystemInputUsed: false,
      inputAdapterRefs: [],
    },
    status: 'blocked',
    blockedReason,
    diagnosticRefs: [`virtual-display-provider:${platform}/no-provider`],
    installHintRefs: [],
  };
}

function permissionReadinessFor(
  requiredRefs: string[],
  missingRefs: string[],
): VirtualDisplayPermissionReadiness {
  return {
    requiredRefs,
    grantedRefs: requiredRefs.filter((ref) => !missingRefs.includes(ref)),
    missingRefs,
    state: requiredRefs.length === 0 ? 'not-required' : missingRefs.length ? 'missing' : 'granted',
  };
}

function physicalDesktopImpactFor(
  capabilities: VirtualDisplayProviderCapabilities,
): VirtualDisplayPhysicalDesktopImpactReadiness {
  const wouldImpactPhysicalDesktop = capabilities.affectsPhysicalDisplay
    || capabilities.requiresFocusSteal
    || capabilities.sharedSystemInputUsed;
  return {
    affectsPhysicalDisplay: capabilities.affectsPhysicalDisplay,
    requiresFocusSteal: capabilities.requiresFocusSteal,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    impact: wouldImpactPhysicalDesktop ? 'would-impact-physical-desktop' : 'none',
  };
}

function inputIsolationFor(
  definition: ProviderDefinition,
  usable: boolean,
): VirtualDisplayInputIsolationReadiness {
  return {
    supported: usable && supportsInputIntent(definition.capabilities),
    isolated: usable && !definition.capabilities.sharedSystemInputUsed,
    sharedSystemInputUsed: definition.capabilities.sharedSystemInputUsed,
    inputAdapterRefs: definition.supportedInputAdapters,
  };
}

function supportsInputIntent(capabilities: VirtualDisplayProviderCapabilities) {
  return capabilities.sendInputIntent || capabilities.executeInputIntent === true;
}

function readinessStatusForProbe(
  installState: VirtualDisplayProviderInstallState,
  missingPermissions: string[],
  usable: boolean,
  blockedReason: string | undefined,
): VirtualDisplayProviderReadinessStatus {
  if (usable && !blockedReason) return 'ready';
  if (installState === 'installed' && missingPermissions.length) return 'permission-missing';
  return 'blocked';
}

function statusForReadiness(
  readiness: VirtualDisplayReadiness | undefined,
  blockedReason: string | undefined,
): VirtualDisplayProviderStatus {
  if (readiness && isVirtualDisplayReadinessControllable(readiness)) return 'ready';
  return statusForBlockedReason(readiness?.blockedReason ?? blockedReason);
}

function attachStateForReadiness(readiness: VirtualDisplayReadiness | undefined): VirtualDisplayAttachState {
  if (!readiness) return 'adapter-unavailable';
  if (readiness.installationStatus !== 'installed') return 'adapter-unavailable';
  if (readiness.readinessStatus === 'permission-missing') return 'permission-missing';
  if (readiness.captureSupported && readiness.liveSurfaceSupported && !readiness.inputSupported) return 'observe-only';
  return 'blocked';
}

function supportsTargetApp(definition: Pick<VirtualDisplayProviderDescription, 'supportedApps'>, targetAppKind: string) {
  if (!definition.supportedApps?.length) return true;
  return definition.supportedApps.includes('generic') || definition.supportedApps.includes(targetAppKind);
}

function readyInvokeResult(
  intent: VirtualDisplayProviderInvokeIntent,
  payload: VirtualDisplayScreenPayload,
  readiness: VirtualDisplayReadiness | undefined,
): VirtualDisplayProviderInvokeResult {
  const commonRefs = {
    currentRunRef: payload.currentRunRef,
    adapterReadinessRef: payload.adapterReadinessRef,
    sessionRef: payload.sessionRef,
    sessionLeaseRef: payload.sessionLeaseRef,
    displayGroupRef: payload.displayGroupRef,
    screenRef: payload.screenRef,
    targetAppRef: payload.targetAppRef,
    targetWindowRef: payload.targetWindowRef,
    actionAdapterRef: payload.actionAdapterRef,
    evidenceLedgerRef: payload.evidenceLedgerRef,
  };
  const evidenceRefs = {
    beforeFrameRef: payload.beforeFrameRef,
    afterFrameRef: payload.afterFrameRef,
  };
  const lifecycleRefs = (eventName: string) => ({
    lifecycleEventRef: `${payload.lifecycleLedgerRef}#${eventName}`,
    lifecycleLedgerRef: payload.lifecycleLedgerRef,
  });
  const refsByIntent: Record<VirtualDisplayProviderInvokeIntent, Record<string, string | string[] | undefined>> = {
    probe: commonRefs,
    createSession: {
      ...commonRefs,
      ...lifecycleRefs('create-session'),
      ...evidenceRefs,
    },
    launchApp: {
      ...commonRefs,
      ...lifecycleRefs('launch-app'),
      ...evidenceRefs,
    },
    attachSurface: {
      ...commonRefs,
      liveSurfaceRef: payload.liveSurfaceRef,
      surfaceTransportRef: payload.surfaceTransportRef,
      frameStreamRef: payload.frameStreamRef,
      currentFrameRef: payload.currentFrameRef,
      frameTransportContractRef: payload.frameTransportContractRef,
      frameTelemetryRef: payload.frameTelemetryRef,
      mediaChannelRef: payload.mediaChannelRef,
      dataChannelRef: payload.dataChannelRef,
      ...lifecycleRefs('attach-surface'),
      ...evidenceRefs,
    },
    readFrame: {
      ...commonRefs,
      liveSurfaceRef: payload.liveSurfaceRef,
      surfaceTransportRef: payload.surfaceTransportRef,
      frameStreamRef: payload.frameStreamRef,
      currentFrameRef: payload.currentFrameRef,
      frameTransportContractRef: payload.frameTransportContractRef,
      frameTelemetryRef: payload.frameTelemetryRef,
      currentFrameSequence: payload.currentFrameSequence === undefined ? undefined : String(payload.currentFrameSequence),
      ...evidenceRefs,
    },
    sendInputIntent: {
      ...commonRefs,
      inputIntentRefs: payload.inputIntentRefs ?? [],
      inputLeaseRef: payload.inputLeaseRef,
      actionAdapterRef: payload.actionAdapterRef,
      inputHotPathRef: payload.inputHotPath?.inputChannelRef,
      executorEventRefs: payload.executorEventRefs ?? [],
      lifecycleLedgerRef: payload.lifecycleLedgerRef,
      ...evidenceRefs,
      beforeAfterFrameRefs: payload.beforeAfterFrameRefs ?? [],
      verificationRefs: payload.verificationRefs ?? [],
    },
    executeInputIntent: {
      ...commonRefs,
      inputIntentRefs: payload.inputIntentRefs ?? [],
      inputLeaseRef: payload.inputLeaseRef,
      actionAdapterRef: payload.actionAdapterRef,
      inputHotPathRef: payload.inputHotPath?.inputChannelRef,
      executorEventRefs: payload.executorEventRefs ?? [],
      lifecycleLedgerRef: payload.lifecycleLedgerRef,
      ...evidenceRefs,
      beforeAfterFrameRefs: payload.beforeAfterFrameRefs ?? [],
      verificationRefs: payload.verificationRefs ?? [],
    },
    pause: {
      ...commonRefs,
      ...lifecycleRefs('pause'),
      ...evidenceRefs,
    },
    resume: {
      ...commonRefs,
      ...lifecycleRefs('resume'),
      ...evidenceRefs,
    },
    closeSession: {
      ...commonRefs,
      ...lifecycleRefs('close-session'),
      ...evidenceRefs,
    },
    handoff: {
      ...commonRefs,
      handoffRef: `${payload.lifecycleLedgerRef}#handoff`,
      ...lifecycleRefs('handoff'),
      ...evidenceRefs,
    },
  };
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent,
    providerId: readiness?.providerId,
    status: 'ready',
    refs: refsByIntent[intent],
    surfaceTransport: intent === 'attachSurface' || intent === 'readFrame'
      ? payload.surfaceTransportDescriptor
      : undefined,
    readiness,
    providerExecuted: false,
    mutatingActionExecuted: intent === 'sendInputIntent' || intent === 'executeInputIntent',
    rawPayloadWritten: false,
  };
}

function statusForBlockedReason(reason: string | undefined): VirtualDisplayProviderStatus {
  return /permission|screen recording|accessibility|authorization|authorized/i.test(reason ?? '')
    ? 'permission-missing'
    : 'blocked';
}

function buildVirtualDisplayInputHotPathPolicy(inputChannelRef: string): VirtualDisplayInputHotPathPolicy {
  return {
    schemaVersion: 'sciforge.virtual-display.input-hot-path.v1',
    priority: 'input-first',
    inputChannelRef,
    ackMode: 'bounded-action-ack',
    queueMode: 'separate-priority-lane',
    blockedByScreenshot: false,
    blockedByOcr: false,
    blockedByReplay: false,
    blockedByEvidenceCapture: false,
    frameCaptureDuringInput: 'skip-or-use-current-frame',
  };
}

function diagnosticOnlyTransports(): Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', true> {
  return {
    vnc: true,
    novnc: true,
    rdp: true,
    mjpeg: true,
  };
}

function productFallbackTransports(): Record<'vnc' | 'novnc' | 'rdp' | 'mjpeg', false> {
  return {
    vnc: false,
    novnc: false,
    rdp: false,
    mjpeg: false,
  };
}

function defaultFrameTelemetrySamples(): VirtualDisplayFrameTelemetrySample[] {
  return [
    {
      sequence: 1,
      observedAtMs: 1,
      captureToEncodeMs: 10,
      transportMs: 12,
      decodeToPresentMs: 8,
      endToEndMs: 30,
      frameBytes: 64_000,
      bufferedFrames: 0,
      maxBufferedFrames: 2,
    },
    {
      sequence: 2,
      observedAtMs: 2,
      captureToEncodeMs: 12,
      transportMs: 14,
      decodeToPresentMs: 9,
      endToEndMs: 35,
      frameBytes: 67_000,
      bufferedFrames: 2,
      maxBufferedFrames: 2,
      droppedSinceLastFrame: 1,
      skippedBackpressure: 1,
    },
    {
      sequence: 3,
      observedAtMs: 3,
      captureToEncodeMs: 11,
      transportMs: 16,
      decodeToPresentMs: 10,
      endToEndMs: 37,
      frameBytes: 68_000,
      bufferedFrames: 0,
      maxBufferedFrames: 2,
    },
  ];
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function nonNegativeOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function sequenceGapCount(sequences: number[]): number {
  let gaps = 0;
  for (let index = 1; index < sequences.length; index += 1) {
    if (sequences[index] !== sequences[index - 1] + 1) gaps += 1;
  }
  return gaps;
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function firstStringRef(refMaps: Array<Record<string, string | string[] | undefined>>, key: string) {
  for (const refs of refMaps) {
    const value = refs[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function virtualDisplayProviderBaseRefFromCurrentRunRef(currentRunRef: string | undefined) {
  if (!currentRunRef?.endsWith('/current-run.json')) return undefined;
  return currentRunRef.replace(/\/current-run\.json$/u, '/virtual-display-provider');
}

function nonNegativeFromString(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeDescriptorRef(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.trim().toLowerCase();
  return !(
    normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('//')
    || /[\r\n]/u.test(value)
  );
}

function normalizeTargetAppKind(value: string) {
  const normalized = sanitizeRefSegment(value).replace(/^vs-code$/, 'vscode');
  if (normalized === 'code' || normalized === 'visual-studio-code') return 'vscode';
  return normalized || 'generic';
}

function sanitizeRefSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function providerDefinitions(platform: NodeJS.Platform | string): ProviderDefinition[] {
  if (platform === 'darwin') return [macosCgVirtualDisplayProvider()];
  if (platform === 'linux') return [linuxXpraProvider()];
  if (platform === 'win32') return [windowsIddProvider()];
  return [];
}

function macosCgVirtualDisplayProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.macos.cgvirtualdisplay-screencapturekit',
    platform: 'darwin',
    backendKind: 'cgvirtualdisplay-screencapturekit',
    hostPlatforms: ['darwin'],
    priority: 10,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['app-command', 'ax', 'virtual-display-input'],
    requiredNodePackages: ['node-mac-virtual-display'],
    installHints: ['npm install node-mac-virtual-display; grant macOS Screen Recording and Accessibility explicitly.'],
    installHintRefs: ['install-hint:macos/node-mac-virtual-display'],
    permissionRefs: ['permission:macos/screen-recording', 'permission:macos/accessibility'],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function linuxXpraProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.linux.xpra',
    platform: 'linux',
    backendKind: 'xpra-app-session',
    hostPlatforms: ['linux'],
    priority: 20,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'jupyter', 'pdf-viewer', 'csv-viewer', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['at-spi', 'virtual-display-input', 'app-command'],
    requiredCommands: ['xpra'],
    installHints: ['Install Xpra with the system package manager, then rerun provider probe.'],
    installHintRefs: ['install-hint:linux/xpra'],
    permissionRefs: [],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function windowsIddProvider(): ProviderDefinition {
  return {
    schemaVersion: VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
    providerId: 'virtual-display.windows.idd',
    platform: 'win32',
    backendKind: 'windows-indirect-display-driver',
    hostPlatforms: ['win32'],
    priority: 30,
    supportedApps: ['vscode', 'editor', 'browser', 'terminal', 'generic'],
    supportedTransports: ['webrtc', 'native-frame-stream'],
    supportedInputAdapters: ['uia', 'app-command', 'virtual-display-input'],
    manualRequirementKeys: ['windows-idd-virtual-display-driver'],
    installHints: ['Install and authorize a Windows IDD virtual display driver through explicit user handoff.'],
    installHintRefs: ['install-hint:windows/idd-virtual-display-driver'],
    permissionRefs: ['permission:windows/idd-driver-authorized'],
    transportPreference: ['webrtc', 'native-frame-stream'],
    capabilities: safeVirtualDisplayCapabilities({ createDisplay: true }),
  };
}

function safeVirtualDisplayCapabilities(
  overrides: Partial<VirtualDisplayProviderCapabilities> = {},
): VirtualDisplayProviderCapabilities {
  return {
    createDisplay: true,
    launchApp: true,
    attachWindow: true,
    captureFrame: true,
    streamFrames: true,
    sendInputIntent: true,
    executeInputIntent: true,
    backgroundRenderable: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    ...overrides,
  };
}
