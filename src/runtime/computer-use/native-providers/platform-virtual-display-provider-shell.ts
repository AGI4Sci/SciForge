import {
  probeVirtualDisplayProviders,
  type VirtualDisplayPlatform,
  type VirtualDisplayProviderInvokeIntent,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderStatus,
  type VirtualDisplayReadiness,
} from '../virtual-display-provider.js';
import { sanitizeId } from '../utils.js';

export type PlatformVirtualDisplayProviderOperation =
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

export interface PlatformVirtualDisplayOperationEvidence {
  providerExecuted: true;
  refs?: Record<string, string | string[] | undefined>;
  readiness?: VirtualDisplayReadiness;
  providerId?: string;
  blockedReason?: string;
  mutatingActionExecuted?: boolean;
  providerEvidenceWritten?: boolean;
}

export type PlatformVirtualDisplayOperationHook =
  (options: VirtualDisplayProviderOperationOptions) =>
    | PlatformVirtualDisplayOperationEvidence
    | Promise<PlatformVirtualDisplayOperationEvidence>;

export type PlatformVirtualDisplayProviderHooks = Partial<Record<
  PlatformVirtualDisplayProviderOperation,
  PlatformVirtualDisplayOperationHook
>>;

export interface PlatformVirtualDisplayProviderShellOptions {
  providerId: string;
  platform: VirtualDisplayPlatform;
  providerLabel: string;
  hooks?: PlatformVirtualDisplayProviderHooks;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
}

export function createPlatformVirtualDisplayProviderShell(
  options: PlatformVirtualDisplayProviderShellOptions,
): VirtualDisplayProviderL1Contract {
  const invoke = (intent: PlatformVirtualDisplayProviderOperation, operationOptions: VirtualDisplayProviderOperationOptions) =>
    invokePlatformVirtualDisplayProvider(intent, operationOptions, options);
  return {
    probe: (operationOptions = { runId: `${options.platform}-virtual-display-probe` }) => invoke('probe', operationOptions),
    createSession: (operationOptions) => invoke('createSession', operationOptions),
    launchApp: (operationOptions) => invoke('launchApp', operationOptions),
    attachSurface: (operationOptions) => invoke('attachSurface', operationOptions),
    readFrame: (operationOptions) => invoke('readFrame', operationOptions),
    sendInputIntent: (operationOptions) => invoke('sendInputIntent', operationOptions),
    pause: (operationOptions) => invoke('pause', operationOptions),
    resume: (operationOptions) => invoke('resume', operationOptions),
    handoff: (operationOptions) => invoke('handoff', operationOptions),
    closeSession: (operationOptions) => invoke('closeSession', operationOptions),
  };
}

async function invokePlatformVirtualDisplayProvider(
  intent: PlatformVirtualDisplayProviderOperation,
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: PlatformVirtualDisplayProviderShellOptions,
): Promise<VirtualDisplayProviderInvokeResult> {
  const readiness = platformReadiness(operationOptions, options);
  const baseRefs = platformOperationRefs(operationOptions, intent);
  const hook = options.hooks?.[intent];
  if (!hook) {
    return platformBlockedInvokeResult({
      intent,
      providerId: options.providerId,
      readiness,
      refs: baseRefs,
      blockedReason: `${options.providerLabel} ${intent} side-effect hook is not registered.`,
    });
  }
  try {
    const evidence = await hook(operationOptions);
    if (evidence.providerExecuted !== true) {
      return platformBlockedInvokeResult({
        intent,
        providerId: options.providerId,
        readiness: evidence.readiness ?? readiness,
        refs: baseRefs,
        blockedReason: `${options.providerLabel} ${intent} did not return providerExecuted=true evidence.`,
      });
    }
    const mergedReadiness = evidence.readiness ?? readiness;
    const blockedReason = evidence.blockedReason ?? mergedReadiness.blockedReason;
    if (blockedReason || mergedReadiness.readinessStatus !== 'ready') {
      return platformBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? options.providerId,
        readiness: mergedReadiness,
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: blockedReason ?? `${options.providerLabel} ${intent} readiness is ${mergedReadiness.readinessStatus}.`,
        providerExecuted: true,
      });
    }
    const missingHookRefs = missingProviderOwnedReadyRefs(intent, evidence.refs);
    if (missingHookRefs.length) {
      return platformBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? options.providerId,
        readiness: {
          ...mergedReadiness,
          readinessStatus: 'blocked',
          blockedReason: `${options.providerLabel} ${intent} hook did not return required provider-owned refs: ${missingHookRefs.join(', ')}.`,
        },
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: `${options.providerLabel} ${intent} hook did not return required provider-owned refs: ${missingHookRefs.join(', ')}.`,
        providerExecuted: true,
      });
    }
    if (evidence.providerEvidenceWritten !== true) {
      return platformBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? options.providerId,
        readiness: {
          ...mergedReadiness,
          readinessStatus: 'blocked',
          blockedReason: `${options.providerLabel} ${intent} hook did not write provider-owned evidence records.`,
        },
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: `${options.providerLabel} ${intent} hook did not write provider-owned evidence records.`,
        providerExecuted: true,
      });
    }
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: intent as VirtualDisplayProviderInvokeIntent,
      providerId: evidence.providerId ?? options.providerId,
      status: 'ready',
      refs: { ...baseRefs, ...evidence.refs },
      readiness: mergedReadiness,
      providerExecuted: true,
      mutatingActionExecuted: evidence.mutatingActionExecuted === true,
      rawPayloadWritten: false,
    };
  } catch (error) {
    return platformBlockedInvokeResult({
      intent,
      providerId: options.providerId,
      readiness,
      refs: baseRefs,
      blockedReason: `${options.providerLabel} ${intent} failed: ${shortError(error)}.`,
    });
  }
}

function platformBlockedInvokeResult(input: {
  intent: PlatformVirtualDisplayProviderOperation;
  providerId: string;
  readiness: VirtualDisplayReadiness;
  refs: Record<string, string | string[] | undefined>;
  blockedReason: string;
  providerExecuted?: boolean;
}): VirtualDisplayProviderInvokeResult {
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent: input.intent as VirtualDisplayProviderInvokeIntent,
    providerId: input.providerId,
    status: statusForReadiness(input.readiness),
    refs: {
      ...input.refs,
      blockedRef: input.refs.blockedRef ?? `${baseRef(input.refs.currentRunRef)}/blocked/${input.intent}.json`,
    },
    readiness: input.readiness,
    blockedReason: input.blockedReason,
    providerExecuted: input.providerExecuted === true,
    mutatingActionExecuted: false,
    rawPayloadWritten: false,
  };
}

function missingProviderOwnedReadyRefs(
  intent: PlatformVirtualDisplayProviderOperation,
  refs: Record<string, string | string[] | undefined> | undefined,
) {
  const required: Record<PlatformVirtualDisplayProviderOperation, string[]> = {
    probe: ['adapterReadinessRef'],
    createSession: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'evidenceLedgerRef'],
    launchApp: ['sessionRef', 'targetAppRef', 'targetWindowRef', 'evidenceLedgerRef'],
    attachSurface: ['sessionRef', 'liveSurfaceRef', 'surfaceTransportRef', 'frameStreamRef', 'frameTransportContractRef', 'frameTelemetryRef', 'mediaChannelRef', 'dataChannelRef', 'evidenceLedgerRef'],
    readFrame: ['sessionRef', 'liveSurfaceRef', 'surfaceTransportRef', 'frameStreamRef', 'currentFrameRef', 'frameTransportContractRef', 'frameTelemetryRef', 'mediaChannelRef', 'dataChannelRef', 'currentFrameSequence', 'evidenceLedgerRef'],
    sendInputIntent: ['inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs', 'evidenceLedgerRef'],
    pause: ['agentQueueRef', 'inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs', 'evidenceLedgerRef'],
    resume: ['agentQueueRef', 'currentFrameRefreshRef', 'inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs', 'evidenceLedgerRef'],
    handoff: ['permissionHandoffRef'],
    closeSession: ['agentQueueRef', 'safeStopRef', 'inputIntentRefs', 'executorEventRefs', 'beforeFrameRef', 'afterFrameRef', 'beforeAfterFrameRefs', 'verificationRefs', 'evidenceLedgerRef'],
  };
  return required[intent].filter((key) => !hasProviderOwnedRef(refs?.[key]));
}

function hasProviderOwnedRef(value: string | string[] | undefined) {
  if (typeof value === 'string') return Boolean(value.trim());
  return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && Boolean(entry.trim()));
}

function platformReadiness(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: PlatformVirtualDisplayProviderShellOptions,
) {
  const bundle = operationOptions.probeBundle ?? probeVirtualDisplayProviders({
    ...(options.probeOptions ?? {}),
    ...(operationOptions.probeOptions ?? {}),
    platform: options.platform,
    targetAppKind: operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? options.probeOptions?.targetAppKind ?? 'generic',
  });
  return bundle.selectedReadiness ?? probeVirtualDisplayProviders({
    platform: options.platform,
    targetAppKind: operationOptions.targetAppKind ?? 'generic',
  }).selectedReadiness!;
}

function platformOperationRefs(
  operationOptions: VirtualDisplayProviderOperationOptions,
  intent: PlatformVirtualDisplayProviderOperation,
): Record<string, string | string[] | undefined> {
  const runId = sanitizeId(operationOptions.runId || 'platform-virtual-display');
  const root = `.sciforge/vision-runs/${runId}`;
  const providerRoot = `${root}/virtual-display-provider`;
  const targetKind = sanitizeId(operationOptions.targetAppKind ?? 'generic');
  return {
    currentRunRef: `${root}/current-run.json`,
    adapterReadinessRef: `${providerRoot}/adapter-readiness.json`,
    sessionRef: `${providerRoot}/session.json`,
    sessionLeaseRef: `${providerRoot}/session-lease.json`,
    displayGroupRef: `virtual-display-group:${runId}`,
    screenRef: `virtual-app-screen:${runId}/screen`,
    targetAppRef: `app:${runId}/${targetKind}`,
    targetWindowRef: intent === 'probe' || intent === 'createSession' ? undefined : `window:${runId}/${targetKind}/main`,
    liveSurfaceRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/live-surface.json` : undefined,
    surfaceTransportRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/surface-transport.json` : undefined,
    frameStreamRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/frame-stream.json` : undefined,
    currentFrameRef: intent === 'readFrame' ? `${providerRoot}/frames/current.png` : undefined,
    frameTransportContractRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/frame-transport-contract.json` : undefined,
    frameTelemetryRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/frame-telemetry.json` : undefined,
    mediaChannelRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/webrtc-video-track/live` : undefined,
    dataChannelRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/webrtc-data-channel/control` : undefined,
    currentFrameSequence: intent === 'readFrame' ? '1' : undefined,
    lifecycleEventRef: `${providerRoot}/lifecycle-ledger.json#${intent}`,
    lifecycleLedgerRef: `${providerRoot}/lifecycle-ledger.json`,
    evidenceLedgerRef: `${providerRoot}/evidence-ledger.json`,
    blockedRef: `${providerRoot}/blocked/${intent}.json`,
  };
}

function statusForReadiness(readiness: VirtualDisplayReadiness): VirtualDisplayProviderStatus {
  return readiness.readinessStatus === 'permission-missing' ? 'permission-missing' : 'blocked';
}

function baseRef(currentRunRef: string | string[] | undefined) {
  if (typeof currentRunRef !== 'string') return '.sciforge/vision-runs/platform-virtual-display/virtual-display-provider';
  return currentRunRef.replace(/\/current-run\.json$/u, '/virtual-display-provider');
}

function shortError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}
