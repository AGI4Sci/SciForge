import {
  VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE,
  type VirtualScreenInputIntentCommand,
  type VirtualScreenInputIntentSource,
} from './input-intent-command.js';
import { sanitizeId } from './utils.js';
import {
  isVirtualDisplayReadinessControllable,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
} from './virtual-display-provider.js';

export const VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-input-runtime.v1' as const;

export type VirtualAppScreenInputRuntimeStatus =
  | 'executed'
  | 'blocked-no-provider'
  | 'blocked'
  | 'permission-missing'
  | 'adapter-unavailable';

export interface VirtualAppScreenInputRuntimeProjection {
  runId: string;
  status: VirtualAppScreenInputRuntimeStatus;
  message: string;
  executorId?: string;
  providerId?: string;
  evidence: VirtualAppScreenInputRuntimeEvidence;
  routeDecision: Record<string, unknown>;
  virtualScreenData: Record<string, unknown>;
}

export interface VirtualAppScreenInputRuntimeEvidence {
  providerExecuted: boolean;
  mutatingActionExecuted: boolean;
  inputIntentRecorded: boolean;
  executorEventRecorded: boolean;
  beforeAfterFrameMaterialized: boolean;
  verificationRecorded: boolean;
  evidenceLedgerRecorded: boolean;
  affectsPhysicalDisplay: false;
  requiresFocusSteal: false;
  sharedSystemInputUsed: false;
  systemPointerMoved: false;
  systemKeyboardEventsSent: false;
  evidenceRefs: string[];
}

export interface VirtualAppScreenInputRuntimeExecutor {
  readonly executorId: string;
  readonly providerId: string;
  readonly supportedSources?: VirtualScreenInputIntentSource[];
  execute(command: VirtualScreenInputIntentCommand): Promise<VirtualAppScreenInputRuntimeProjection> | VirtualAppScreenInputRuntimeProjection;
}

export interface VirtualAppScreenInputRuntimeProviderExecutorOptions {
  executorId: string;
  providerId: string;
  supportedSources?: VirtualScreenInputIntentSource[];
  provider: VirtualDisplayProviderL1Contract;
}

export interface VirtualAppScreenInputRuntimeOptions {
  executors?: VirtualAppScreenInputRuntimeExecutor[];
  dryRun?: boolean;
}

interface InputRuntimeRefs {
  inputIntentRef: string;
  executorEventRef: string;
  verificationRef: string;
  blockedRef: string;
  evidenceLedgerRef?: string;
  agentQueueRef?: string;
  currentFrameRefreshRef?: string;
  safeStopRef?: string;
}

const registeredVirtualAppScreenInputRuntimeExecutors = new Map<string, VirtualAppScreenInputRuntimeExecutor>();

export function createVirtualAppScreenInputRuntimeProviderExecutor(
  options: VirtualAppScreenInputRuntimeProviderExecutorOptions,
): VirtualAppScreenInputRuntimeExecutor {
  return {
    executorId: options.executorId,
    providerId: options.providerId,
    supportedSources: options.supportedSources,
    execute: (command) => executeInputRuntimeWithProvider(command, options),
  };
}

export function registerVirtualAppScreenInputRuntimeExecutor(
  executor: VirtualAppScreenInputRuntimeExecutor,
): () => void {
  if (!executor.executorId.trim()) {
    throw new Error('VirtualAppScreen input runtime executor requires a stable executorId.');
  }
  if (registeredVirtualAppScreenInputRuntimeExecutors.has(executor.executorId)) {
    throw new Error(`VirtualAppScreen input runtime executor "${executor.executorId}" is already registered.`);
  }
  registeredVirtualAppScreenInputRuntimeExecutors.set(executor.executorId, executor);
  return () => {
    if (registeredVirtualAppScreenInputRuntimeExecutors.get(executor.executorId) === executor) {
      registeredVirtualAppScreenInputRuntimeExecutors.delete(executor.executorId);
    }
  };
}

export function registerVirtualAppScreenInputRuntimeProviderExecutor(
  options: VirtualAppScreenInputRuntimeProviderExecutorOptions,
): () => void {
  return registerVirtualAppScreenInputRuntimeExecutor(createVirtualAppScreenInputRuntimeProviderExecutor(options));
}

export function listVirtualAppScreenInputRuntimeExecutors(): VirtualAppScreenInputRuntimeExecutor[] {
  return [...registeredVirtualAppScreenInputRuntimeExecutors.values()];
}

export function resetVirtualAppScreenInputRuntimeExecutorsForTests() {
  registeredVirtualAppScreenInputRuntimeExecutors.clear();
}

export async function runVirtualAppScreenInputRuntime(
  command: VirtualScreenInputIntentCommand,
  options: VirtualAppScreenInputRuntimeOptions = {},
): Promise<VirtualAppScreenInputRuntimeProjection> {
  if (options.dryRun === true) {
    return virtualAppScreenInputRuntimeProjection(
      command,
      'VirtualAppScreen InputIntent is dry-run; no provider executor was allowed to execute input or mutate the session lease.',
    );
  }
  const executor = selectVirtualAppScreenInputRuntimeExecutor(command, options.executors ?? listVirtualAppScreenInputRuntimeExecutors());
  if (!executor) return virtualAppScreenInputRuntimeProjection(command);
  const result = await executor.execute(command);
  return validateVirtualAppScreenInputRuntimeResult(command, result);
}

export function selectVirtualAppScreenInputRuntimeExecutor(
  command: VirtualScreenInputIntentCommand,
  executors: VirtualAppScreenInputRuntimeExecutor[],
): VirtualAppScreenInputRuntimeExecutor | undefined {
  return executors.find((executor) => !executor.supportedSources?.length || executor.supportedSources.includes(command.source));
}

export function virtualAppScreenInputRuntimeProjection(
  command: VirtualScreenInputIntentCommand,
  blockedReason = virtualAppScreenInputRuntimeBlockedReason(command),
): VirtualAppScreenInputRuntimeProjection {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const message = blockedReason;
  return {
    runId,
    status: 'blocked-no-provider',
    message,
    evidence: blockedInputRuntimeEvidence(command, runtimeRefs),
    routeDecision: virtualAppScreenInputRuntimeRouteDecision(command, runId, runtimeRefs, message),
    virtualScreenData: virtualAppScreenInputRuntimeVirtualScreenData(command, runId, runtimeRefs, message),
  };
}

export function validateVirtualAppScreenInputRuntimeResult(
  command: VirtualScreenInputIntentCommand,
  result: VirtualAppScreenInputRuntimeProjection,
): VirtualAppScreenInputRuntimeProjection {
  if (result.status !== 'executed') return result;
  const route = result.routeDecision;
  const evidence = result.evidence;
  const missing = [
    evidence.providerExecuted ? undefined : 'providerExecuted',
    evidence.inputIntentRecorded ? undefined : 'inputIntentRefs',
    evidence.executorEventRecorded ? undefined : 'executorEventRefs',
    evidence.beforeAfterFrameMaterialized ? undefined : 'before/after/beforeAfterFrameRefs',
    evidence.verificationRecorded ? undefined : 'verificationRefs',
    evidence.evidenceLedgerRecorded ? undefined : 'evidenceLedgerRef',
    route.inputLeaseRef ? undefined : 'inputLeaseRef',
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && !route.leaseControlRef ? 'leaseControlRef' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && !route.agentQueueRef ? 'agentQueueRef' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE
      && (command.controlKind === 'takeover' || command.controlKind === 'pause-agent')
      && route.agentQueueStatus !== 'paused'
      ? 'agentQueueStatus=paused'
      : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && !route.controlPlanePolicy ? 'controlPlanePolicy' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && route.closesUserRealApp !== false ? 'closesUserRealApp=false' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && command.controlKind === 'resume-agent' && !route.currentFrameRefreshRef ? 'currentFrameRefreshRef' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && command.controlKind === 'resume-agent' && !route.currentFrameRef ? 'resume currentFrameRef' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && command.controlKind === 'stop-session' && !route.safeStopRef ? 'safeStopRef' : undefined,
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && command.controlKind === 'stop-session' && route.safeStopMode !== 'safe-close-or-pause-virtual-session-only' ? 'safeStopMode=safe-close-or-pause-virtual-session-only' : undefined,
    !route.adapterReadinessRef ? 'adapterReadinessRef' : undefined,
    evidence.affectsPhysicalDisplay === false ? undefined : 'affectsPhysicalDisplay=false',
    evidence.requiresFocusSteal === false ? undefined : 'requiresFocusSteal=false',
    evidence.sharedSystemInputUsed === false ? undefined : 'sharedSystemInputUsed=false',
    evidence.systemPointerMoved === false ? undefined : 'systemPointerMoved=false',
    evidence.systemKeyboardEventsSent === false ? undefined : 'systemKeyboardEventsSent=false',
  ].filter((entry): entry is string => Boolean(entry));
  if (!missing.length) return result;
  return virtualAppScreenInputRuntimeProjection(
    command,
    `VirtualAppScreen input runtime executor claimed execution without required current-session evidence: ${missing.join(', ')}.`,
  );
}

export function virtualAppScreenInputRuntimeRunId(command: VirtualScreenInputIntentCommand) {
  return sanitizeId([
    'virtual-app-screen-input-intent',
    command.source,
    command.intentKind,
    command.refs.sessionRef,
    command.refs.screenRef,
    command.refs.frameRef,
    command.refs.leaseControlRef,
  ].filter(Boolean).join('-'));
}

export function virtualAppScreenInputRuntimeBlockedReason(command: VirtualScreenInputIntentCommand) {
  const label = command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE
    ? `lease control "${command.controlKind}"`
    : `canvas input "${command.intentKind}"`;
  return `VirtualAppScreen ${label} was accepted by the product runtime, but no runtime-owned input provider is bound for this session. The request was recorded as refs-first evidence and blocked before OS input or lease mutation.`;
}

function virtualAppScreenInputRuntimeRouteDecision(
  command: VirtualScreenInputIntentCommand,
  runId: string,
  runtimeRefs: InputRuntimeRefs,
  message: string,
) {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
    route: 'virtual-app-screen-input-intent',
    runId,
    source: command.source,
    inputIntentKind: command.intentKind,
    actionType: command.action?.type,
    controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
    sessionRef: command.refs.sessionRef,
    screenRef: command.refs.screenRef,
    targetAppRef: command.refs.targetAppRef,
    targetWindowRef: command.refs.targetWindowRef,
    frameRef: command.refs.frameRef,
    inputLeaseRef: command.refs.inputLeaseRef,
    userLeaseRef: command.refs.userLeaseRef,
    agentLeaseRef: command.refs.agentLeaseRef,
    activeLeaseOwnerRef: command.refs.activeLeaseOwnerRef,
    activeLeaseOwnerRole: command.refs.activeLeaseOwnerRole,
    leaseControlRef: command.refs.leaseControlRef,
    agentQueueRef: runtimeRefs.agentQueueRef,
    currentFrameRefreshRef: runtimeRefs.currentFrameRefreshRef,
    safeStopRef: runtimeRefs.safeStopRef,
    controlPlanePolicy: controlPlanePolicy(command),
    ...controlStateProjection(command),
    closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
    actionAdapterRef: command.refs.actionAdapterRef,
    adapterReadinessRef: command.refs.adapterReadinessRef,
    evidenceLedgerRef: runtimeRefs.evidenceLedgerRef,
    inputIntentRef: runtimeRefs.inputIntentRef,
    executorEventRef: runtimeRefs.executorEventRef,
    verificationRef: runtimeRefs.verificationRef,
    blockedRef: runtimeRefs.blockedRef,
    status: 'blocked-no-provider',
    blockedReason: message,
    terminalEquivalent: true,
    failClosed: true,
    providerExecuted: false,
    mutatingActionExecuted: false,
    currentSessionOnly: true,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    rawPayloadWritten: false,
  };
}

async function executeInputRuntimeWithProvider(
  command: VirtualScreenInputIntentCommand,
  options: VirtualAppScreenInputRuntimeProviderExecutorOptions,
): Promise<VirtualAppScreenInputRuntimeProjection> {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const operationOptions = inputRuntimeOperationOptions(command, runId);
  const probe = await options.provider.probe(operationOptions);
  const probeBlocked = blockedProviderInputRuntimeResult(command, options, 'probe', probe, probe.readiness);
  if (probeBlocked) return probeBlocked;

  const operationResults: VirtualDisplayProviderInvokeResult[] = [probe];
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) {
    const sendInputIntent = await options.provider.sendInputIntent(operationOptions);
    const sendBlocked = blockedProviderInputRuntimeResult(command, options, 'sendInputIntent', sendInputIntent, probe.readiness);
    if (sendBlocked) return sendBlocked;
    operationResults.push(sendInputIntent);
    return executedInputRuntimeResult(command, options, runId, operationResults);
  }

  const control = command.controlKind === 'stop-session'
    ? await options.provider.closeSession(operationOptions)
    : command.controlKind === 'resume-agent'
      ? await options.provider.resume(operationOptions)
      : await options.provider.pause(operationOptions);
  const controlBlocked = blockedProviderInputRuntimeResult(command, options, command.controlKind, control, probe.readiness);
  if (controlBlocked) return controlBlocked;
  operationResults.push(control);

  if (command.controlKind === 'resume-agent') {
    const readFrame = await options.provider.readFrame(operationOptions);
    const readFrameBlocked = blockedProviderInputRuntimeResult(command, options, 'readFrame', readFrame, probe.readiness);
    if (readFrameBlocked) return readFrameBlocked;
    operationResults.push(readFrame);
  }

  return executedInputRuntimeResult(command, options, runId, operationResults);
}

function blockedProviderInputRuntimeResult(
  command: VirtualScreenInputIntentCommand,
  options: Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'providerId'>,
  operation: string,
  result: VirtualDisplayProviderInvokeResult,
  readiness: VirtualDisplayReadiness | undefined,
): VirtualAppScreenInputRuntimeProjection | undefined {
  if (result.rawPayloadWritten !== false) {
    return providerBlockedProjection(command, options, result, `${operation} returned an inline/raw provider payload, so the product path failed closed.`);
  }
  if (result.status !== 'ready') {
    return providerBlockedProjection(command, options, result, `${operation} was not ready: ${result.blockedReason ?? statusReason(result.status)}.`);
  }
  if (result.providerExecuted !== true) {
    return providerBlockedProjection(command, options, result, `${operation} did not provide runtime-owned provider execution evidence.`);
  }
  if (!isVirtualDisplayReadinessControllable(result.readiness ?? readiness)) {
    return providerBlockedProjection(command, options, result, `${operation} did not prove isolated controllable VirtualDisplay readiness.`);
  }
  return undefined;
}

function providerBlockedProjection(
  command: VirtualScreenInputIntentCommand,
  options: Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'providerId'>,
  result: VirtualDisplayProviderInvokeResult,
  reason: string,
): VirtualAppScreenInputRuntimeProjection {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const refs = executedRefs([result]);
  return {
    runId,
    status: statusFromProviderResult(result),
    message: reason,
    executorId: options.executorId,
    providerId: result.providerId ?? options.providerId,
    evidence: {
      ...blockedInputRuntimeEvidence(command, runtimeRefs),
      evidenceRefs: uniqueRefs([
        ...blockedInputRuntimeEvidence(command, runtimeRefs).evidenceRefs,
        stringRef(result, 'adapterReadinessRef'),
        stringRef(result, 'blockedRef'),
      ]),
    },
    routeDecision: {
      ...virtualAppScreenInputRuntimeRouteDecision(command, runId, runtimeRefs, reason),
      executorId: options.executorId,
      providerId: result.providerId ?? options.providerId,
      status: statusFromProviderResult(result),
      adapterReadinessRef: refs.adapterReadinessRef,
      blockedRef: stringRef(result, 'blockedRef') ?? runtimeRefs.blockedRef,
      providerExecuted: false,
      mutatingActionExecuted: false,
      providerStatus: result.status,
      providerBlockedReason: result.blockedReason,
    },
    virtualScreenData: {
      ...virtualAppScreenInputRuntimeVirtualScreenData(command, runId, runtimeRefs, reason),
      status: statusFromProviderResult(result) === 'permission-missing' ? 'requires-handoff' : 'blocked',
      attachState: statusFromProviderResult(result) === 'permission-missing' ? 'requires-handoff' : 'blocked',
      adapterReadinessRef: refs.adapterReadinessRef,
      blockedRef: stringRef(result, 'blockedRef') ?? runtimeRefs.blockedRef,
      runSummary: {
        status: statusFromProviderResult(result),
        runId,
        inputIntentAccepted: true,
        source: command.source,
        inputIntentKind: command.intentKind,
        providerExecuted: false,
        mutatingActionExecuted: false,
        completionEligible: false,
        blockedReason: reason,
      },
    },
  };
}

function executedInputRuntimeResult(
  command: VirtualScreenInputIntentCommand,
  options: Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'executorId' | 'providerId'>,
  runId: string,
  results: VirtualDisplayProviderInvokeResult[],
): VirtualAppScreenInputRuntimeProjection {
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const refs = executedRefs(results);
  const inconsistentProviderEvidence = validateExecutedProviderRefs(command, results, refs);
  if (inconsistentProviderEvidence) {
    return virtualAppScreenInputRuntimeProjection(
      command,
      `VirtualAppScreen input runtime provider evidence was not bound to the current session: ${inconsistentProviderEvidence}.`,
    );
  }
  const inputIntentRefs = refs.inputIntentRefs;
  const executorEventRefs = refs.executorEventRefs;
  const beforeAfterFrameRefs = refs.beforeAfterFrameRefs;
  const verificationRefs = refs.verificationRefs;
  const currentFrameRef = refs.currentFrameRef ?? refs.afterFrameRef;
  const providerControlEvidenceRefs = controlEvidenceRefsFromProvider(command, refs);
  const message = command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE
    ? `VirtualAppScreen lease control "${command.controlKind}" executed through a runtime-owned provider executor.`
    : `VirtualAppScreen input "${command.intentKind}" executed through a runtime-owned provider executor.`;
  const evidence: VirtualAppScreenInputRuntimeEvidence = {
    providerExecuted: true,
    mutatingActionExecuted: results.some((result) => result.mutatingActionExecuted),
    inputIntentRecorded: inputIntentRefs.length > 0,
    executorEventRecorded: executorEventRefs.length > 0,
    beforeAfterFrameMaterialized: Boolean(refs.beforeFrameRef && refs.afterFrameRef && beforeAfterFrameRefs.length),
    verificationRecorded: verificationRefs.length > 0,
    evidenceLedgerRecorded: Boolean(refs.evidenceLedgerRef),
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    evidenceRefs: uniqueRefs([
      refs.adapterReadinessRef,
      refs.beforeFrameRef,
      refs.afterFrameRef,
      ...beforeAfterFrameRefs,
      ...inputIntentRefs,
      ...executorEventRefs,
      ...verificationRefs,
      refs.evidenceLedgerRef,
      providerControlEvidenceRefs.agentQueueRef,
      providerControlEvidenceRefs.currentFrameRefreshRef,
      providerControlEvidenceRefs.safeStopRef,
    ]),
  };
  const routeDecision = {
    ...virtualAppScreenInputRuntimeRouteDecision(command, runId, runtimeRefs, message),
    executorId: options.executorId,
    providerId: providerId(options, results),
    status: 'executed',
    sessionRef: refs.sessionRef,
    providerExecuted: true,
    mutatingActionExecuted: evidence.mutatingActionExecuted,
    inputIntentRefs,
    executorEventRefs,
    beforeFrameRef: refs.beforeFrameRef,
    afterFrameRef: refs.afterFrameRef,
    beforeAfterFrameRefs,
    verificationRefs,
    frameRef: currentFrameRef,
    currentFrameRef,
    adapterReadinessRef: refs.adapterReadinessRef,
    actionAdapterRef: refs.actionAdapterRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    inputLeaseRef: refs.inputLeaseRef,
    rawPayloadWritten: false,
    providerOperations: results.map((result) => result.intent),
    agentQueueRef: providerControlEvidenceRefs.agentQueueRef,
    currentFrameRefreshRef: providerControlEvidenceRefs.currentFrameRefreshRef,
    safeStopRef: providerControlEvidenceRefs.safeStopRef,
    controlPlanePolicy: controlPlanePolicy(command),
    ...controlStateProjection(command),
    closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
  };
  return {
    runId,
    status: 'executed',
    message,
    executorId: options.executorId,
    providerId: providerId(options, results),
    evidence,
    routeDecision,
    virtualScreenData: {
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      inputRuntimeSchemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
      title: 'Computer Use Virtual Screen',
      status: 'ready',
      attachState: 'observe-only',
      surfaceMode: 'replay',
      currentRunRef: refs.currentRunRef ?? `.sciforge/vision-runs/${runId}/current-run.json`,
      screenRef: command.refs.screenRef,
      visibleScreenRefs: [command.refs.screenRef].filter((ref): ref is string => Boolean(ref)),
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: command.refs.targetWindowRef,
      sessionRef: refs.sessionRef,
      frameRef: currentFrameRef,
      currentFrameRef,
      beforeFrameRef: refs.beforeFrameRef,
      afterFrameRef: refs.afterFrameRef,
      beforeAfterFrameRefs,
      inputLeaseRef: refs.inputLeaseRef,
      userLeaseRef: command.refs.userLeaseRef,
      agentLeaseRef: command.refs.agentLeaseRef,
      activeLeaseOwnerRef: command.refs.activeLeaseOwnerRef,
      activeLeaseOwnerRole: command.refs.activeLeaseOwnerRole,
      leaseStatus: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : 'input-executed',
      agentQueueRef: providerControlEvidenceRefs.agentQueueRef,
      currentFrameRefreshRef: providerControlEvidenceRefs.currentFrameRefreshRef,
      safeStopRef: providerControlEvidenceRefs.safeStopRef,
      controlPlanePolicy: controlPlanePolicy(command),
      ...controlStateProjection(command),
      closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
      actionAdapterRef: refs.actionAdapterRef,
      adapterReadinessRef: refs.adapterReadinessRef,
      evidenceLedgerRef: refs.evidenceLedgerRef,
      inputIntentRefs,
      executorEventRefs,
      verificationRefs,
      ...controlRefProjection(command),
      inputIntent: {
        schemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
        source: command.source,
        kind: command.intentKind,
        actionType: command.action?.type,
        controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
        actor: 'user',
        status: 'executed',
        providerExecuted: true,
        mutatingActionExecuted: evidence.mutatingActionExecuted,
        refs: {
          sessionRef: refs.sessionRef,
          screenRef: command.refs.screenRef,
          frameRef: currentFrameRef,
          inputLeaseRef: refs.inputLeaseRef,
          leaseControlRef: command.refs.leaseControlRef,
          agentQueueRef: providerControlEvidenceRefs.agentQueueRef,
          currentFrameRefreshRef: providerControlEvidenceRefs.currentFrameRefreshRef,
          safeStopRef: providerControlEvidenceRefs.safeStopRef,
          actionAdapterRef: refs.actionAdapterRef,
          adapterReadinessRef: refs.adapterReadinessRef,
          evidenceLedgerRef: refs.evidenceLedgerRef,
          inputIntentRefs,
          executorEventRefs,
          beforeFrameRef: refs.beforeFrameRef,
          afterFrameRef: refs.afterFrameRef,
          beforeAfterFrameRefs,
          verificationRefs,
        },
      },
      events: [
        ...inputIntentRefs.map((ref) => ({ ref, type: 'input-intent-recorded', status: 'executed', actor: 'user' })),
        ...executorEventRefs.map((ref) => ({ ref, type: 'provider-executor-event', status: 'executed' })),
      ],
      isolationFlags: {
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        currentSessionOnly: true,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        providerExecuted: true,
        mutatingActionExecuted: evidence.mutatingActionExecuted,
        backgroundRenderable: true,
        diagnosticOnly: false,
        failClosedByDefault: true,
      },
      runSummary: {
        status: 'executed',
        runId,
        inputIntentAccepted: true,
        source: command.source,
        inputIntentKind: command.intentKind,
        actionType: command.action?.type,
        controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
        actor: 'user',
        frameCount: currentFrameRef ? 1 : 0,
        screenCount: command.refs.screenRef ? 1 : 0,
        realNativeSidecarExecuted: true,
        providerExecuted: true,
        mutatingActionExecuted: evidence.mutatingActionExecuted,
        completionEligible: false,
        evidenceLedgerRef: refs.evidenceLedgerRef,
        agentQueueRef: providerControlEvidenceRefs.agentQueueRef,
        currentFrameRefreshRef: providerControlEvidenceRefs.currentFrameRefreshRef,
        safeStopRef: providerControlEvidenceRefs.safeStopRef,
        controlPlanePolicy: controlPlanePolicy(command),
        ...controlStateProjection(command),
        closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
      },
    },
  };
}

function virtualAppScreenInputRuntimeVirtualScreenData(
  command: VirtualScreenInputIntentCommand,
  runId: string,
  runtimeRefs: InputRuntimeRefs,
  message: string,
) {
  const controlRefs = controlRefProjection(command);
  return {
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    inputRuntimeSchemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
    title: 'Computer Use Virtual Screen',
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: command.refs.frameRef ? 'replay' : 'empty',
    currentRunRef: `.sciforge/vision-runs/${runId}/current-run.json`,
    screenRef: command.refs.screenRef,
    visibleScreenRefs: [command.refs.screenRef].filter((ref): ref is string => Boolean(ref)),
    targetAppRef: command.refs.targetAppRef,
    targetWindowRef: command.refs.targetWindowRef,
    sessionRef: command.refs.sessionRef,
    frameRef: command.refs.frameRef,
    currentFrameRef: command.refs.frameRef,
    inputLeaseRef: command.refs.inputLeaseRef,
    userLeaseRef: command.refs.userLeaseRef,
    agentLeaseRef: command.refs.agentLeaseRef,
    activeLeaseOwnerRef: command.refs.activeLeaseOwnerRef,
    activeLeaseOwnerRole: command.refs.activeLeaseOwnerRole,
    leaseStatus: 'blocked-no-provider',
    agentQueueRef: runtimeRefs.agentQueueRef,
    currentFrameRefreshRef: runtimeRefs.currentFrameRefreshRef,
    safeStopRef: runtimeRefs.safeStopRef,
    controlPlanePolicy: controlPlanePolicy(command),
    ...controlStateProjection(command),
    closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
    actionAdapterRef: command.refs.actionAdapterRef,
    adapterReadinessRef: command.refs.adapterReadinessRef,
    evidenceLedgerRef: runtimeRefs.evidenceLedgerRef,
    inputIntentRefs: [runtimeRefs.inputIntentRef],
    executorEventRefs: [runtimeRefs.executorEventRef],
    verificationRefs: [runtimeRefs.verificationRef],
    blockedRef: runtimeRefs.blockedRef,
    blockedReason: message,
    ...controlRefs,
    inputIntent: {
      schemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
      source: command.source,
      kind: command.intentKind,
      actionType: command.action?.type,
      controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
      actor: 'user',
      status: 'blocked-no-provider',
      providerExecuted: false,
      mutatingActionExecuted: false,
      refs: {
        sessionRef: command.refs.sessionRef,
        screenRef: command.refs.screenRef,
        frameRef: command.refs.frameRef,
        inputLeaseRef: command.refs.inputLeaseRef,
        leaseControlRef: command.refs.leaseControlRef,
        agentQueueRef: runtimeRefs.agentQueueRef,
        currentFrameRefreshRef: runtimeRefs.currentFrameRefreshRef,
        safeStopRef: runtimeRefs.safeStopRef,
        actionAdapterRef: command.refs.actionAdapterRef,
        adapterReadinessRef: command.refs.adapterReadinessRef,
        evidenceLedgerRef: runtimeRefs.evidenceLedgerRef,
        inputIntentRef: runtimeRefs.inputIntentRef,
        executorEventRef: runtimeRefs.executorEventRef,
        verificationRef: runtimeRefs.verificationRef,
        blockedRef: runtimeRefs.blockedRef,
      },
    },
    events: [
      {
        ref: runtimeRefs.inputIntentRef,
        type: 'input-intent-requested',
        status: 'blocked-no-provider',
        actor: 'user',
      },
      {
        ref: runtimeRefs.executorEventRef,
        type: 'input-provider-blocked',
        status: 'blocked-no-provider',
      },
    ],
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      currentSessionOnly: true,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      providerExecuted: false,
      mutatingActionExecuted: false,
      backgroundRenderable: false,
      diagnosticOnly: true,
      failClosedByDefault: true,
    },
    runSummary: {
      status: 'blocked-no-provider',
      runId,
      inputIntentAccepted: true,
      source: command.source,
      inputIntentKind: command.intentKind,
      actionType: command.action?.type,
      controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
      actor: 'user',
      frameCount: command.refs.frameRef ? 1 : 0,
      screenCount: command.refs.screenRef ? 1 : 0,
      realNativeSidecarExecuted: false,
      providerExecuted: false,
      mutatingActionExecuted: false,
      completionEligible: false,
      blockedReason: message,
      agentQueueRef: runtimeRefs.agentQueueRef,
      currentFrameRefreshRef: runtimeRefs.currentFrameRefreshRef,
      safeStopRef: runtimeRefs.safeStopRef,
      controlPlanePolicy: controlPlanePolicy(command),
      closesUserRealApp: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? false : undefined,
    },
  };
}

function inputRuntimeRefs(
  command: VirtualScreenInputIntentCommand,
  runId: string,
): InputRuntimeRefs {
  const kind = sanitizeId(command.intentKind);
  const controlKind = command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined;
  const controlBaseRef = controlKind
    ? `computer-use:session/${runId}/control-plane/${kind}`
    : undefined;
  return {
    inputIntentRef: `computer-use:session/${runId}/input-intents/${kind}.json`,
    executorEventRef: `computer-use:session/${runId}/executor-events/${kind}-blocked-no-provider.json`,
    verificationRef: `computer-use:session/${runId}/verification/${kind}-fail-closed.json`,
    blockedRef: `computer-use:session/${runId}/blocked/${kind}-no-provider.json`,
    evidenceLedgerRef: command.refs.evidenceLedgerRef ?? `computer-use:session/${runId}/evidence-ledger.json`,
    agentQueueRef: controlBaseRef ? `${controlBaseRef}/agent-queue.json` : undefined,
    currentFrameRefreshRef: controlBaseRef && controlKind === 'resume-agent'
      ? `${controlBaseRef}/current-frame-refresh.json`
      : undefined,
    safeStopRef: controlBaseRef && controlKind === 'stop-session'
      ? `${controlBaseRef}/safe-stop.json`
      : undefined,
  };
}

function controlRefProjection(command: VirtualScreenInputIntentCommand) {
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) return {};
  const ref = command.refs.leaseControlRef;
  return {
    takeoverRef: command.controlKind === 'takeover' ? ref : undefined,
    pauseRef: command.controlKind === 'pause-agent' ? ref : undefined,
    resumeRef: command.controlKind === 'resume-agent' ? ref : undefined,
    stopRef: command.controlKind === 'stop-session' ? ref : undefined,
  };
}

function blockedInputRuntimeEvidence(
  command: VirtualScreenInputIntentCommand,
  runtimeRefs: InputRuntimeRefs,
): VirtualAppScreenInputRuntimeEvidence {
  return {
    providerExecuted: false,
    mutatingActionExecuted: false,
    inputIntentRecorded: true,
    executorEventRecorded: true,
    beforeAfterFrameMaterialized: false,
    verificationRecorded: true,
    evidenceLedgerRecorded: Boolean(runtimeRefs.evidenceLedgerRef),
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    evidenceRefs: uniqueRefs([
      command.refs.sessionRef,
      command.refs.frameRef,
      command.refs.inputLeaseRef,
      command.refs.leaseControlRef,
      command.refs.adapterReadinessRef,
      runtimeRefs.agentQueueRef,
      runtimeRefs.currentFrameRefreshRef,
      runtimeRefs.safeStopRef,
      runtimeRefs.inputIntentRef,
      runtimeRefs.executorEventRef,
      runtimeRefs.verificationRef,
      runtimeRefs.blockedRef,
      runtimeRefs.evidenceLedgerRef,
    ]),
  };
}

function controlPlanePolicy(command: VirtualScreenInputIntentCommand) {
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) return undefined;
  return {
    schemaVersion: `${VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA}.control-plane-policy`,
    controlKind: command.controlKind,
    agentQueueStatus: controlAgentQueueStatus(command),
    queueEvidenceRequired: true,
    resumeRequiresCurrentFrame: command.controlKind === 'resume-agent',
    safeStopRequired: command.controlKind === 'stop-session',
    safeStopMode: command.controlKind === 'stop-session' ? 'safe-close-or-pause-virtual-session-only' : undefined,
    closesUserRealApp: false,
    closesPhysicalDesktopWindow: false,
    physicalDesktopInputAllowed: false,
    sharedInputAllowed: false,
    currentSessionOnly: true,
  };
}

function controlStateProjection(command: VirtualScreenInputIntentCommand) {
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) return {};
  return {
    agentQueueStatus: controlAgentQueueStatus(command),
    resumeRequiresCurrentFrame: command.controlKind === 'resume-agent' ? true : undefined,
    currentFrameReadRequired: command.controlKind === 'resume-agent' ? true : undefined,
    safeStopMode: command.controlKind === 'stop-session' ? 'safe-close-or-pause-virtual-session-only' : undefined,
  };
}

function controlAgentQueueStatus(command: VirtualScreenInputIntentCommand) {
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) return undefined;
  if (command.controlKind === 'takeover' || command.controlKind === 'pause-agent') return 'paused';
  if (command.controlKind === 'resume-agent') return 'resume-after-current-frame';
  return 'paused-for-safe-stop';
}

function executedRefs(results: VirtualDisplayProviderInvokeResult[]) {
  const providerActionResults = results.filter((result) => result.intent !== 'probe');
  return {
    currentRunRef: firstStringRef(providerActionResults, 'currentRunRef'),
    sessionRef: firstStringRef(providerActionResults, 'sessionRef'),
    currentFrameRef: firstStringRef([...providerActionResults].reverse(), 'currentFrameRef'),
    inputLeaseRef: firstStringRef(providerActionResults, 'inputLeaseRef'),
    actionAdapterRef: firstStringRef(providerActionResults, 'actionAdapterRef'),
    adapterReadinessRef: firstStringRef(providerActionResults, 'adapterReadinessRef') ?? firstStringRef(results, 'adapterReadinessRef'),
    evidenceLedgerRef: firstStringRef([...providerActionResults].reverse(), 'evidenceLedgerRef'),
    beforeFrameRef: firstStringRef([...providerActionResults].reverse(), 'beforeFrameRef'),
    afterFrameRef: firstStringRef([...providerActionResults].reverse(), 'afterFrameRef'),
    inputIntentRefs: firstStringListRef(providerActionResults, 'inputIntentRefs'),
    executorEventRefs: firstStringListRef(providerActionResults, 'executorEventRefs'),
    beforeAfterFrameRefs: firstStringListRef(providerActionResults, 'beforeAfterFrameRefs'),
    verificationRefs: firstStringListRef(providerActionResults, 'verificationRefs'),
    agentQueueRef: firstStringRef([...providerActionResults].reverse(), 'agentQueueRef'),
    currentFrameRefreshRef: firstStringRef([...providerActionResults].reverse(), 'currentFrameRefreshRef'),
    safeStopRef: firstStringRef([...providerActionResults].reverse(), 'safeStopRef'),
  };
}

function validateExecutedProviderRefs(
  command: VirtualScreenInputIntentCommand,
  results: VirtualDisplayProviderInvokeResult[],
  refs: ReturnType<typeof executedRefs>,
) {
  const providerActionResults = results.filter((result) => result.intent !== 'probe');
  if (!providerActionResults.length) return 'no mutating provider operation returned evidence';
  const sessionRef = command.refs.sessionRef;
  if (!sessionRef) return 'command.sessionRef was missing';
  if (!refs.sessionRef) return 'provider sessionRef was missing';
  if (refs.sessionRef !== sessionRef) return 'provider sessionRef did not match command.sessionRef';
  if (command.refs.inputLeaseRef && !refs.inputLeaseRef) return 'provider inputLeaseRef was missing';
  if (command.refs.inputLeaseRef && refs.inputLeaseRef !== command.refs.inputLeaseRef) {
    return 'provider inputLeaseRef did not match command.inputLeaseRef';
  }
  if (command.refs.actionAdapterRef && !refs.actionAdapterRef) return 'provider actionAdapterRef was missing';
  if (command.refs.actionAdapterRef && refs.actionAdapterRef !== command.refs.actionAdapterRef) {
    return 'provider actionAdapterRef did not match command.actionAdapterRef';
  }
  if (!refs.adapterReadinessRef) return 'provider adapterReadinessRef was missing';
  if (!refs.evidenceLedgerRef) return 'provider evidenceLedgerRef was missing';
  if (!refs.inputIntentRefs.length) return 'provider inputIntentRefs were missing';
  if (!refs.executorEventRefs.length) return 'provider executorEventRefs were missing';
  if (!refs.beforeFrameRef || !refs.afterFrameRef || !refs.beforeAfterFrameRefs.length) {
    return 'provider before/after/beforeAfterFrameRefs were missing';
  }
  if (!refs.verificationRefs.length) return 'provider verificationRefs were missing';
  const expectedCurrentRunRef = refs.currentRunRef;
  if (!expectedCurrentRunRef) return 'provider currentRunRef was missing';
  for (const result of providerActionResults) {
    const operation = result.intent;
    const runMismatch = requireProviderResultRef(result, operation, 'currentRunRef', expectedCurrentRunRef, 'first provider operation currentRunRef');
    if (runMismatch) return runMismatch;
    const sessionMismatch = requireProviderResultRef(result, operation, 'sessionRef', sessionRef, 'command.sessionRef');
    if (sessionMismatch) return sessionMismatch;
    if (command.refs.inputLeaseRef) {
      const leaseMismatch = requireProviderResultRef(result, operation, 'inputLeaseRef', command.refs.inputLeaseRef, 'command.inputLeaseRef');
      if (leaseMismatch) return leaseMismatch;
    }
    if (command.refs.actionAdapterRef) {
      const adapterMismatch = requireProviderResultRef(result, operation, 'actionAdapterRef', command.refs.actionAdapterRef, 'command.actionAdapterRef');
      if (adapterMismatch) return adapterMismatch;
    }
  }
  if (command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE && command.controlKind === 'resume-agent') {
    const readFrame = providerActionResults.find((result) => result.intent === 'readFrame');
    if (!readFrame) return 'resume-agent did not return readFrame evidence';
    if (!stringRef(readFrame, 'currentFrameRef')) return 'resume-agent readFrame.currentFrameRef was missing';
    if (!refs.currentFrameRefreshRef) return 'resume-agent currentFrameRefreshRef was missing';
  }
  return undefined;
}

function requireProviderResultRef(
  result: VirtualDisplayProviderInvokeResult,
  operation: string,
  key: string,
  expected: string,
  expectedLabel: string,
) {
  const value = stringRef(result, key);
  if (!value) return `${operation}.${key} was missing`;
  if (value !== expected) return `${operation}.${key} did not match ${expectedLabel}`;
  return undefined;
}

function controlEvidenceRefsFromProvider(
  command: VirtualScreenInputIntentCommand,
  refs: ReturnType<typeof executedRefs>,
): Pick<InputRuntimeRefs, 'agentQueueRef' | 'currentFrameRefreshRef' | 'safeStopRef'> {
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) return {};
  return {
    agentQueueRef: refs.agentQueueRef,
    currentFrameRefreshRef: command.controlKind === 'resume-agent' ? refs.currentFrameRefreshRef : undefined,
    safeStopRef: command.controlKind === 'stop-session' ? refs.safeStopRef : undefined,
  };
}

function inputRuntimeOperationOptions(
  command: VirtualScreenInputIntentCommand,
  runId: string,
) {
  return {
    runId,
    targetAppKind: targetAppKindFromRef(command.refs.targetAppRef),
    targetAppName: command.refs.targetAppRef,
    inputIntent: {
      source: command.source,
      kind: command.intentKind,
      action: command.action,
      controlKind: command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? command.controlKind : undefined,
      refs: command.refs,
      frame: command.frame,
      ratios: command.ratios,
    },
  } as VirtualDisplayProviderOperationOptions & { inputIntent: Record<string, unknown> };
}

function firstStringRef(results: VirtualDisplayProviderInvokeResult[], key: string) {
  return results.map((result) => stringRef(result, key)).find((ref): ref is string => Boolean(ref));
}

function firstStringListRef(results: VirtualDisplayProviderInvokeResult[], key: string) {
  return uniqueRefs(results.flatMap((result) => stringListRef(result, key)));
}

function stringRef(result: VirtualDisplayProviderInvokeResult, key: string) {
  const value = result.refs[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringListRef(result: VirtualDisplayProviderInvokeResult, key: string) {
  const value = result.refs[key];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return typeof value === 'string' && value.trim() ? [value] : [];
}

function providerId(
  options: Pick<VirtualAppScreenInputRuntimeProviderExecutorOptions, 'providerId'>,
  results: VirtualDisplayProviderInvokeResult[],
) {
  return [...results].reverse().find((result) => result.providerId)?.providerId ?? options.providerId;
}

function statusFromProviderResult(result: VirtualDisplayProviderInvokeResult): VirtualAppScreenInputRuntimeStatus {
  if (result.status === 'permission-missing') return 'permission-missing';
  if (!result.providerId) return 'adapter-unavailable';
  return 'blocked';
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

function uniqueRefs(refs: Array<string | undefined>) {
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref?.trim())))];
}
