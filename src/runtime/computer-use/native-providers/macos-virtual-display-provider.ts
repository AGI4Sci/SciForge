import {
  probeVirtualDisplayProviders,
  type VirtualDisplayProviderInvokeIntent,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderStatus,
  type VirtualDisplayReadiness,
} from '../virtual-display-provider.js';
import { sanitizeId } from '../utils.js';

export const MACOS_VIRTUAL_DISPLAY_PROVIDER_ID =
  'virtual-display.macos.cgvirtualdisplay-screencapturekit' as const;

export type MacosVirtualDisplayProviderOperation =
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

export interface MacosVirtualDisplayOperationEvidence {
  providerExecuted: true;
  refs?: Record<string, string | string[] | undefined>;
  readiness?: VirtualDisplayReadiness;
  providerId?: string;
  blockedReason?: string;
  mutatingActionExecuted?: boolean;
  providerEvidenceWritten?: boolean;
}

export type MacosVirtualDisplayOperationHook =
  (options: VirtualDisplayProviderOperationOptions) =>
    | MacosVirtualDisplayOperationEvidence
    | Promise<MacosVirtualDisplayOperationEvidence>;

export interface MacosVirtualDisplayProviderHooks {
  probe?: MacosVirtualDisplayOperationHook;
  createSession?: MacosVirtualDisplayOperationHook;
  launchApp?: MacosVirtualDisplayOperationHook;
  attachSurface?: MacosVirtualDisplayOperationHook;
  readFrame?: MacosVirtualDisplayOperationHook;
  sendInputIntent?: MacosVirtualDisplayOperationHook;
  pause?: MacosVirtualDisplayOperationHook;
  resume?: MacosVirtualDisplayOperationHook;
  handoff?: MacosVirtualDisplayOperationHook;
  closeSession?: MacosVirtualDisplayOperationHook;
}

export interface MacosVirtualDisplayProviderOptions {
  providerId?: string;
  hooks?: MacosVirtualDisplayProviderHooks;
  probeOptions?: VirtualDisplayProviderOperationOptions['probeOptions'];
}

export function createMacosVirtualDisplayProvider(
  options: MacosVirtualDisplayProviderOptions = {},
): VirtualDisplayProviderL1Contract {
  const invoke = (intent: MacosVirtualDisplayProviderOperation, operationOptions: VirtualDisplayProviderOperationOptions) =>
    invokeMacosVirtualDisplayProvider(intent, operationOptions, options);
  return {
    probe: (operationOptions = { runId: 'macos-virtual-display-probe' }) => invoke('probe', operationOptions),
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

async function invokeMacosVirtualDisplayProvider(
  intent: MacosVirtualDisplayProviderOperation,
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: MacosVirtualDisplayProviderOptions,
): Promise<VirtualDisplayProviderInvokeResult> {
  const providerId = options.providerId ?? MACOS_VIRTUAL_DISPLAY_PROVIDER_ID;
  const readiness = macosReadiness(operationOptions, options);
  const baseRefs = macosOperationRefs(operationOptions, intent);
  const hook = options.hooks?.[intent];
  if (!hook) {
    return macosBlockedInvokeResult({
      intent,
      providerId,
      readiness,
      refs: baseRefs,
      blockedReason: `macOS VirtualDisplayProvider ${intent} side-effect hook is not registered.`,
    });
  }
  try {
    const evidence = await hook(operationOptions);
    if (evidence.providerExecuted !== true) {
      return macosBlockedInvokeResult({
        intent,
        providerId,
        readiness: evidence.readiness ?? readiness,
        refs: baseRefs,
        blockedReason: `macOS VirtualDisplayProvider ${intent} did not return providerExecuted=true evidence.`,
      });
    }
    const mergedReadiness = evidence.readiness ?? readiness;
    const blockedReason = evidence.blockedReason ?? mergedReadiness.blockedReason;
    if (blockedReason || mergedReadiness.readinessStatus !== 'ready') {
      return macosBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? providerId,
        readiness: mergedReadiness,
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: blockedReason ?? `macOS VirtualDisplayProvider ${intent} readiness is ${mergedReadiness.readinessStatus}.`,
        providerExecuted: true,
      });
    }
    const missingHookRefs = missingProviderOwnedReadyRefs(intent, evidence.refs);
    if (missingHookRefs.length) {
      return macosBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? providerId,
        readiness: {
          ...mergedReadiness,
          readinessStatus: 'blocked',
          blockedReason: `macOS VirtualDisplayProvider ${intent} hook did not return required provider-owned refs: ${missingHookRefs.join(', ')}.`,
        },
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: `macOS VirtualDisplayProvider ${intent} hook did not return required provider-owned refs: ${missingHookRefs.join(', ')}.`,
        providerExecuted: true,
      });
    }
    if (evidence.providerEvidenceWritten !== true) {
      return macosBlockedInvokeResult({
        intent,
        providerId: evidence.providerId ?? providerId,
        readiness: {
          ...mergedReadiness,
          readinessStatus: 'blocked',
          blockedReason: `macOS VirtualDisplayProvider ${intent} hook did not write provider-owned evidence records.`,
        },
        refs: { ...baseRefs, ...evidence.refs },
        blockedReason: `macOS VirtualDisplayProvider ${intent} hook did not write provider-owned evidence records.`,
        providerExecuted: true,
      });
    }
    return {
      schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
      intent: intent as VirtualDisplayProviderInvokeIntent,
      providerId: evidence.providerId ?? providerId,
      status: 'ready',
      refs: { ...baseRefs, ...evidence.refs },
      readiness: mergedReadiness,
      providerExecuted: true,
      mutatingActionExecuted: evidence.mutatingActionExecuted === true,
      rawPayloadWritten: false,
    };
  } catch (error) {
    return macosBlockedInvokeResult({
      intent,
      providerId,
      readiness,
      refs: baseRefs,
      blockedReason: `macOS VirtualDisplayProvider ${intent} failed: ${shortError(error)}.`,
    });
  }
}

function macosBlockedInvokeResult(input: {
  intent: MacosVirtualDisplayProviderOperation;
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
  intent: MacosVirtualDisplayProviderOperation,
  refs: Record<string, string | string[] | undefined> | undefined,
) {
  const required: Record<MacosVirtualDisplayProviderOperation, string[]> = {
    probe: ['adapterReadinessRef'],
    createSession: ['currentRunRef', 'sessionRef', 'sessionLeaseRef', 'evidenceLedgerRef'],
    launchApp: ['sessionRef', 'targetAppRef', 'targetWindowRef', 'evidenceLedgerRef'],
    attachSurface: ['sessionRef', 'liveSurfaceRef', 'frameStreamRef', 'surfaceTransportRef', 'frameTransportContractRef', 'frameTelemetryRef', 'mediaChannelRef', 'dataChannelRef', 'evidenceLedgerRef'],
    readFrame: ['sessionRef', 'liveSurfaceRef', 'frameStreamRef', 'currentFrameRef', 'surfaceTransportRef', 'frameTransportContractRef', 'frameTelemetryRef', 'mediaChannelRef', 'dataChannelRef', 'currentFrameSequence', 'evidenceLedgerRef'],
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

function macosReadiness(
  operationOptions: VirtualDisplayProviderOperationOptions,
  options: MacosVirtualDisplayProviderOptions,
) {
  const bundle = operationOptions.probeBundle ?? probeVirtualDisplayProviders({
    ...(options.probeOptions ?? {}),
    ...(operationOptions.probeOptions ?? {}),
    platform: 'darwin',
    targetAppKind: operationOptions.targetAppKind ?? operationOptions.probeOptions?.targetAppKind ?? 'generic',
  });
  return bundle.selectedReadiness ?? probeVirtualDisplayProviders({
    platform: 'darwin',
    targetAppKind: operationOptions.targetAppKind ?? 'generic',
  }).selectedReadiness!;
}

function macosOperationRefs(
  operationOptions: VirtualDisplayProviderOperationOptions,
  intent: MacosVirtualDisplayProviderOperation,
): Record<string, string | string[] | undefined> {
  const runId = sanitizeId(operationOptions.runId || 'macos-virtual-display');
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
    frameStreamRef: intent === 'attachSurface' || intent === 'readFrame' ? `${providerRoot}/frame-stream.json` : undefined,
    currentFrameRef: intent === 'readFrame' ? `${providerRoot}/frames/current.png` : undefined,
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
  if (typeof currentRunRef !== 'string') return '.sciforge/vision-runs/macos-virtual-display/virtual-display-provider';
  return currentRunRef.replace(/\/current-run\.json$/u, '/virtual-display-provider');
}

function shortError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}
