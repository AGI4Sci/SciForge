import {
  VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE,
  VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE,
  type VirtualScreenInputIntentCommand,
  type VirtualScreenInputIntentSource,
} from './input-intent-command.js';
import {
  deriveNativeHostMinimalEvidenceReplayRefs,
  type NativeHostAutomationBarrier,
  type NativeHostEvidenceLedger,
  type NativeHostHumanInputEvent,
  type NativeHostSession,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';
import type { GenericVisionAction } from './types.js';
import { sanitizeId } from './utils.js';
import {
  isVirtualDisplayReadinessControllable,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayProviderReadinessStatus,
  type VirtualDisplayReadiness,
} from './virtual-display-provider.js';
import { readVirtualAppScreenProviderSessionRecord } from './virtual-app-screen-provider-session-store.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
  updateVirtualAppScreenNativeHostSessionFrame,
  type VirtualAppScreenNativeHostSessionRecord,
} from './virtual-app-screen-native-host-session-store.js';

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

export interface VirtualAppScreenInputRuntimeNativeHostExecutorOptions {
  executorId: string;
  providerId: string;
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

interface NativeHostControlEvidence {
  agentQueueRef?: string;
  currentFrameRefreshRef?: string;
  safeStopRef?: string;
}

interface NativeHostReplayProjection {
  currentRunPointerRef: string;
  minimalEvidenceReplayRefs: string[];
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

export async function tryRunVirtualAppScreenInputRuntimeNativeHost(
  command: VirtualScreenInputIntentCommand,
  options: VirtualAppScreenInputRuntimeNativeHostExecutorOptions,
): Promise<VirtualAppScreenInputRuntimeProjection | undefined> {
  const binding = nativeHostInputBinding(command);
  if (binding.status === 'no-host-binding') return undefined;
  if (binding.status === 'blocked') {
    return nativeHostBlockedProjection(command, options, binding.reason, binding.record);
  }
  const result = await (
    command.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE
      ? executeNativeHostControlInput(command, options, binding.record)
      : executeNativeHostCanvasInput(command, options, binding.record)
  );
  return validateVirtualAppScreenInputRuntimeResult(command, result);
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
  const providerSessionRecord = readVirtualAppScreenProviderSessionRecord({
    screenRef: command.refs.screenRef,
    sessionRef: command.refs.sessionRef,
  });
  const providerSessionRef = providerSessionRecord?.providerLifecycleSessionRef ?? command.refs.sessionRef;
  const providerCommand = providerSessionRef === command.refs.sessionRef
    ? command
    : inputRuntimeCommandWithSessionRef(command, providerSessionRef);
  const operationOptions = inputRuntimeOperationOptions(providerCommand, runId);
  const probe = await options.provider.probe(operationOptions);
  const probeBlocked = blockedProviderInputRuntimeResult(command, options, 'probe', probe, probe.readiness);
  if (probeBlocked) return probeBlocked;

  const operationResults: VirtualDisplayProviderInvokeResult[] = [probe];
  if (command.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) {
    const sendInputIntent = await options.provider.sendInputIntent(operationOptions);
    const sendBlocked = blockedProviderInputRuntimeResult(command, options, 'sendInputIntent', sendInputIntent, probe.readiness);
    if (sendBlocked) return sendBlocked;
    operationResults.push(sendInputIntent);
    return executedInputRuntimeResult(command, options, runId, operationResults, providerSessionRef);
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

  return executedInputRuntimeResult(command, options, runId, operationResults, providerSessionRef);
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
  providerSessionRef = command.refs.sessionRef,
  nativeHostReplay?: NativeHostReplayProjection,
): VirtualAppScreenInputRuntimeProjection {
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const refs = executedRefs(results);
  const inconsistentProviderEvidence = validateExecutedProviderRefs(command, results, refs, providerSessionRef);
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
      nativeHostReplay?.currentRunPointerRef,
      ...(nativeHostReplay?.minimalEvidenceReplayRefs ?? []),
    ]),
  };
  const routeDecision = {
    ...virtualAppScreenInputRuntimeRouteDecision(command, runId, runtimeRefs, message),
    executorId: options.executorId,
    providerId: providerId(options, results),
    status: 'executed',
    sessionRef: command.refs.sessionRef,
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
    currentRunPointerRef: nativeHostReplay?.currentRunPointerRef,
    minimalEvidenceReplayRefs: nativeHostReplay?.minimalEvidenceReplayRefs,
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
      currentRunPointerRef: nativeHostReplay?.currentRunPointerRef,
      screenRef: command.refs.screenRef,
      visibleScreenRefs: [command.refs.screenRef].filter((ref): ref is string => Boolean(ref)),
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: command.refs.targetWindowRef,
      sessionRef: command.refs.sessionRef,
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
      minimalEvidenceReplayRefs: nativeHostReplay?.minimalEvidenceReplayRefs,
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
          sessionRef: command.refs.sessionRef,
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
          currentRunPointerRef: nativeHostReplay?.currentRunPointerRef,
          minimalEvidenceReplayRefs: nativeHostReplay?.minimalEvidenceReplayRefs,
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
        currentRunPointerRef: nativeHostReplay?.currentRunPointerRef,
        minimalEvidenceReplayRefs: nativeHostReplay?.minimalEvidenceReplayRefs,
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

async function executeNativeHostCanvasInput(
  command: Extract<VirtualScreenInputIntentCommand, { source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE }>,
  options: VirtualAppScreenInputRuntimeNativeHostExecutorOptions,
  record: VirtualAppScreenNativeHostSessionRecord,
): Promise<VirtualAppScreenInputRuntimeProjection> {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const inputEvent = nativeHostHumanInputEvent(command, runtimeRefs);
  if ('reason' in inputEvent) return nativeHostBlockedProjection(command, options, inputEvent.reason, record);

  const accepted = await record.host.sendHumanInput(record.sessionId, inputEvent.event);
  if (accepted.status !== 'ok') {
    return nativeHostBlockedProjection(command, options, `Native Host blocked input: ${accepted.error.message}`, record);
  }

  const afterFrame = record.host.readFrame(record.sessionId, accepted.value.inputAcceptedRef);
  if (afterFrame.status !== 'ok') {
    return nativeHostBlockedProjection(command, options, `Native Host could not refresh the frame after input: ${afterFrame.error.message}`, record);
  }
  updateVirtualAppScreenNativeHostSessionFrame({ sessionRef: record.sessionRef, frame: afterFrame.value });

  const ledgerValidation = record.host.validateLedger(record.sessionId, {
    requireFrame: true,
    requireHumanInput: true,
    requireGrantValidation: true,
  });
  if (!ledgerValidation.ok) {
    return nativeHostBlockedProjection(
      command,
      options,
      `Native Host input ledger failed validation: ${ledgerValidation.issues.join(' ')}`,
      record,
    );
  }

  const beforeFrameRef = command.refs.frameRef ?? record.currentFrameRef;
  const actionResult = nativeHostInputInvokeResult({
    command,
    options,
    record,
    intent: 'sendInputIntent',
    runtimeRefs,
    beforeFrameRef,
    afterFrameRef: afterFrame.value.frameRef,
    executorEventRefs: [accepted.value.inputAcceptedRef],
    mutatingActionExecuted: true,
  });
  const readFrameResult = nativeHostInputInvokeResult({
    command,
    options,
    record,
    intent: 'readFrame',
    runtimeRefs,
    beforeFrameRef,
    afterFrameRef: afterFrame.value.frameRef,
    currentFrameRef: afterFrame.value.frameRef,
    mutatingActionExecuted: false,
  });
  return executedInputRuntimeResult(
    command,
    options,
    runId,
    [actionResult, readFrameResult],
    command.refs.sessionRef,
    nativeHostReplayProjection(record),
  );
}

async function executeNativeHostControlInput(
  command: Extract<VirtualScreenInputIntentCommand, { source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE }>,
  options: VirtualAppScreenInputRuntimeNativeHostExecutorOptions,
  record: VirtualAppScreenNativeHostSessionRecord,
): Promise<VirtualAppScreenInputRuntimeProjection> {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const beforeFrameRef = record.currentFrameRef ?? command.refs.frameRef;
  if (!beforeFrameRef) return nativeHostBlockedProjection(command, options, 'Native Host control requires a current frame.', record);

  const barrier = nativeHostControlBarrier(command, record, beforeFrameRef);
  const control = await (
    command.controlKind === 'stop-session'
      ? record.host.closeSession(record.sessionId)
      : command.controlKind === 'resume-agent'
        ? record.host.resumeAgent(record.sessionId, barrier)
        : record.host.pauseAgent(record.sessionId, command.controlKind)
  );
  if (control.status !== 'ok') {
    return nativeHostBlockedProjection(command, options, `Native Host blocked control "${command.controlKind}": ${control.error.message}`, record);
  }
  const controlEvidence = nativeHostControlEvidenceFromSession(control.value);
  const missingControlEvidence = [
    controlEvidence.agentQueueRef ? undefined : 'agentQueueRef',
    command.controlKind === 'resume-agent' && !controlEvidence.currentFrameRefreshRef ? 'currentFrameRefreshRef' : undefined,
    command.controlKind === 'stop-session' && !controlEvidence.safeStopRef ? 'safeStopRef' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (missingControlEvidence.length) {
    return nativeHostBlockedProjection(
      command,
      options,
      `Native Host control adapter did not return provider-validated control evidence: ${missingControlEvidence.join(', ')}.`,
      record,
    );
  }

  const refreshedFrame = command.controlKind === 'resume-agent'
    ? record.host.readFrame(record.sessionId, runtimeRefs.currentFrameRefreshRef)
    : undefined;
  if (refreshedFrame?.status === 'blocked') {
    return nativeHostBlockedProjection(command, options, `Native Host could not refresh the frame after resume: ${refreshedFrame.error.message}`, record);
  }
  if (refreshedFrame?.status === 'ok') {
    updateVirtualAppScreenNativeHostSessionFrame({ sessionRef: record.sessionRef, frame: refreshedFrame.value });
  }

  const ledgerValidation = record.host.validateLedger(record.sessionId, {
    requireFrame: true,
    requireGrantValidation: true,
  });
  if (!ledgerValidation.ok) {
    return nativeHostBlockedProjection(
      command,
      options,
      `Native Host control ledger failed validation: ${ledgerValidation.issues.join(' ')}`,
      record,
    );
  }

  const afterFrameRef = refreshedFrame?.status === 'ok'
    ? refreshedFrame.value.frameRef
    : beforeFrameRef;
  const controlResult = nativeHostInputInvokeResult({
    command,
    options,
    record,
    intent: command.controlKind === 'stop-session' ? 'closeSession' : command.controlKind === 'resume-agent' ? 'resume' : 'pause',
    runtimeRefs,
    beforeFrameRef,
    afterFrameRef,
    currentFrameRef: afterFrameRef,
    executorEventRefs: [nativeHostRuntimeRef(record, 'control-events', `${command.controlKind}.json`)],
    controlEvidence,
    mutatingActionExecuted: true,
  });
  const results = refreshedFrame?.status === 'ok'
    ? [
        controlResult,
        nativeHostInputInvokeResult({
          command,
          options,
          record,
          intent: 'readFrame',
          runtimeRefs,
          beforeFrameRef,
          afterFrameRef,
          currentFrameRef: afterFrameRef,
          controlEvidence,
          mutatingActionExecuted: false,
        }),
      ]
    : [controlResult];
  return executedInputRuntimeResult(
    command,
    options,
    runId,
    results,
    command.refs.sessionRef,
    nativeHostReplayProjection(record),
  );
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
      command.refs.currentRunPointerRef,
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
  providerSessionRef = command.refs.sessionRef,
) {
  const providerActionResults = results.filter((result) => result.intent !== 'probe');
  if (!providerActionResults.length) return 'no mutating provider operation returned evidence';
  const publicSessionRef = command.refs.sessionRef;
  if (!publicSessionRef) return 'command.sessionRef was missing';
  if (!providerSessionRef) return 'provider lifecycle sessionRef was missing';
  const providerSessionRefLabel = providerSessionRef === publicSessionRef
    ? 'command.sessionRef'
    : 'provider lifecycle sessionRef';
  if (!refs.sessionRef) return 'provider sessionRef was missing';
  if (refs.sessionRef !== providerSessionRef) {
    return providerSessionRef === publicSessionRef
      ? 'provider sessionRef did not match command.sessionRef'
      : 'provider sessionRef did not match recorded provider lifecycle sessionRef';
  }
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
    const sessionMismatch = requireProviderResultRef(result, operation, 'sessionRef', providerSessionRef, providerSessionRefLabel);
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

type NativeHostInputBinding =
  | { status: 'no-host-binding' }
  | { status: 'blocked'; reason: string; record?: VirtualAppScreenNativeHostSessionRecord }
  | { status: 'ready'; record: VirtualAppScreenNativeHostSessionRecord };

function nativeHostInputBinding(command: VirtualScreenInputIntentCommand): NativeHostInputBinding {
  const providerSessionRecord = readVirtualAppScreenProviderSessionRecord({
    screenRef: command.refs.screenRef,
    sessionRef: command.refs.sessionRef,
  });
  if (!providerSessionRecord) {
    return isNativeHostSessionRef(command.refs.sessionRef)
      ? { status: 'blocked', reason: 'Native Host InputIntent has no recorded current-session provider ownership record.' }
      : { status: 'no-host-binding' };
  }
  if (providerSessionRecord.owner !== 'NativeVirtualAppScreenHost') return { status: 'no-host-binding' };

  const record = readVirtualAppScreenNativeHostSessionRecord({
    screenRef: command.refs.screenRef,
    sessionRef: command.refs.sessionRef,
  });
  if (!record) {
    return {
      status: 'blocked',
      reason: 'Native Host InputIntent found Host-owned public refs but no live Host session binding in this runtime.',
    };
  }

  const mismatches = [
    command.refs.sessionRef !== record.sessionRef ? 'sessionRef' : undefined,
    command.refs.screenRef && command.refs.screenRef !== record.screenRef ? 'screenRef' : undefined,
    command.refs.targetWindowRef && record.targetWindowRef && command.refs.targetWindowRef !== record.targetWindowRef ? 'targetWindowRef' : undefined,
    command.refs.inputLeaseRef !== record.inputLeaseRef ? 'inputLeaseRef' : undefined,
    command.refs.actionAdapterRef && command.refs.actionAdapterRef !== record.actionAdapterRef ? 'actionAdapterRef' : undefined,
    command.refs.adapterReadinessRef && command.refs.adapterReadinessRef !== record.adapterReadinessRef ? 'adapterReadinessRef' : undefined,
    command.refs.evidenceLedgerRef && command.refs.evidenceLedgerRef !== record.evidenceLedgerRef ? 'evidenceLedgerRef' : undefined,
    command.refs.currentRunPointerRef && command.refs.currentRunPointerRef !== record.currentRunPointerRef ? 'currentRunPointerRef' : undefined,
    command.refs.frameRef && record.currentFrameRef && command.refs.frameRef !== record.currentFrameRef ? 'currentFrameRef' : undefined,
    providerSessionRecord.sessionRef !== record.sessionRef ? 'providerSessionRecord.sessionRef' : undefined,
    providerSessionRecord.liveSurfaceRef !== record.liveSurfaceRef ? 'liveSurfaceRef' : undefined,
    providerSessionRecord.frameStreamRef !== record.frameStreamRef ? 'frameStreamRef' : undefined,
    providerSessionRecord.adapterReadinessRef !== record.adapterReadinessRef ? 'providerSessionRecord.adapterReadinessRef' : undefined,
    providerSessionRecord.evidenceLedgerRef !== record.evidenceLedgerRef ? 'providerSessionRecord.evidenceLedgerRef' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (mismatches.length) {
    return {
      status: 'blocked',
      reason: `Native Host InputIntent refs do not match the recorded current Host session: ${mismatches.join(', ')}.`,
      record,
    };
  }

  if (!record.liveBindingAttachGrantRef) {
    return { status: 'blocked', reason: 'Native Host InputIntent has no recorded live binding grant ref.', record };
  }
  const grant = record.host.validateGrant(record.liveBindingAttachGrantRef);
  if (!grant.ok) {
    return {
      status: 'blocked',
      reason: `Native Host InputIntent grant validation failed: ${grant.issues.join(' ')}`,
      record,
    };
  }
  if (record.grantValidationRef && grant.validationLedgerEntryRef !== record.grantValidationRef) {
    return {
      status: 'blocked',
      reason: 'Native Host InputIntent grant validation ref does not match the recorded attach validation.',
      record,
    };
  }

  return { status: 'ready', record };
}

function nativeHostBlockedProjection(
  command: VirtualScreenInputIntentCommand,
  options: VirtualAppScreenInputRuntimeNativeHostExecutorOptions,
  reason: string,
  record?: VirtualAppScreenNativeHostSessionRecord,
): VirtualAppScreenInputRuntimeProjection {
  const runId = virtualAppScreenInputRuntimeRunId(command);
  const runtimeRefs = inputRuntimeRefs(command, runId);
  const projection = virtualAppScreenInputRuntimeProjection(command, reason);
  return {
    ...projection,
    status: 'blocked',
    executorId: options.executorId,
    providerId: options.providerId,
    evidence: {
      ...projection.evidence,
      evidenceRefs: uniqueRefs([
        ...projection.evidence.evidenceRefs,
        record?.liveBindingAttachGrantRef,
        record?.grantValidationRef,
        record?.liveSurfaceRef,
        record?.frameStreamRef,
        record?.currentFrameRef,
        record?.currentRunPointerRef,
      ]),
    },
    routeDecision: {
      ...projection.routeDecision,
      executorId: options.executorId,
      providerId: options.providerId,
      status: 'blocked',
      blockedReason: reason,
      providerExecuted: false,
      mutatingActionExecuted: false,
      providerBlockedReason: reason,
      adapterReadinessRef: record?.adapterReadinessRef ?? command.refs.adapterReadinessRef,
      evidenceLedgerRef: record?.evidenceLedgerRef ?? runtimeRefs.evidenceLedgerRef,
    },
    virtualScreenData: {
      ...projection.virtualScreenData,
      status: 'blocked',
      attachState: 'blocked',
      adapterReadinessRef: record?.adapterReadinessRef ?? command.refs.adapterReadinessRef,
      evidenceLedgerRef: record?.evidenceLedgerRef ?? runtimeRefs.evidenceLedgerRef,
      currentRunPointerRef: record?.currentRunPointerRef,
      blockedReason: reason,
      runSummary: {
        ...recordValue(projection.virtualScreenData.runSummary),
        status: 'blocked',
        providerExecuted: false,
        mutatingActionExecuted: false,
        completionEligible: false,
        blockedReason: reason,
      },
    },
  };
}

function nativeHostHumanInputEvent(
  command: Extract<VirtualScreenInputIntentCommand, { source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE }>,
  runtimeRefs: InputRuntimeRefs,
): { event: NativeHostHumanInputEvent } | { reason: string } {
  if (!command.refs.screenRef) return { reason: 'Native Host canvas input requires screenRef.' };
  const action = command.action;
  const base = {
    screenRef: command.refs.screenRef,
    targetWindowRef: command.refs.targetWindowRef,
    inputIntentRef: runtimeRefs.inputIntentRef,
  };
  if (action.type === 'click' || action.type === 'double_click') {
    const point = pointRatios(command, action.x, action.y, 'x-ratio', 'y-ratio');
    if ('reason' in point) return point;
    return {
      event: {
        ...base,
        kind: action.type === 'double_click' ? 'double-click' : 'click',
        xRatio: point.xRatio,
        yRatio: point.yRatio,
      },
    };
  }
  if (action.type === 'drag') {
    const start = pointRatios(command, action.fromX, action.fromY, 'start-x-ratio', 'start-y-ratio');
    if ('reason' in start) return start;
    const end = pointRatios(command, action.toX, action.toY, 'end-x-ratio', 'end-y-ratio');
    if ('reason' in end) return end;
    return {
      event: {
        ...base,
        kind: 'drag',
        xRatio: start.xRatio,
        yRatio: start.yRatio,
        endXRatio: end.xRatio,
        endYRatio: end.yRatio,
      },
    };
  }
  if (action.type === 'scroll') {
    const amount = Math.max(1, action.amount ?? 1);
    const delta = 120 * amount;
    return {
      event: {
        ...base,
        kind: 'scroll',
        deltaX: action.direction === 'left' ? -delta : action.direction === 'right' ? delta : 0,
        deltaY: action.direction === 'up' ? -delta : action.direction === 'down' ? delta : 0,
      },
    };
  }
  if (action.type === 'type_text') {
    return {
      event: {
        ...base,
        kind: 'type-text',
        textRef: `${runtimeRefs.inputIntentRef}#text`,
      },
    };
  }
  if (action.type === 'press_key') {
    return {
      event: {
        ...base,
        kind: 'key-down',
        key: action.key,
      },
    };
  }
  if (action.type === 'hotkey') {
    return {
      event: {
        ...base,
        kind: 'key-down',
        keySequence: action.keys,
      },
    };
  }
  return { reason: `Native Host canvas input does not support action type "${(action as GenericVisionAction).type}".` };
}

function nativeHostControlBarrier(
  command: Extract<VirtualScreenInputIntentCommand, { source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE }>,
  record: VirtualAppScreenNativeHostSessionRecord,
  beforeFrameRef: string,
): NativeHostAutomationBarrier {
  const latestRecheckRef = latestPermissionRecheckRef(record);
  return {
    barrierRef: command.refs.leaseControlRef ?? nativeHostRuntimeRef(record, 'barriers', `${command.controlKind}.json`),
    currentRunRef: record.currentRunRef,
    requiredReadinessRef: record.adapterReadinessRef,
    beforeFrameRef,
    resumeAfterPermissionRecheckRef: latestRecheckRef,
  };
}

function latestPermissionRecheckRef(record: VirtualAppScreenNativeHostSessionRecord): string | undefined {
  const ledger = record.host.getLedger(record.sessionId);
  const latestHandoff = ledger?.entries.findLast((entry) => entry.type === 'permission.handoff');
  if (!latestHandoff) return undefined;
  return ledger?.entries.findLast((entry) =>
    entry.type === 'permission.recheck'
    && entry.sequence > latestHandoff.sequence
    && typeof entry.refs.recheckRef === 'string'
    && entry.refs.recheckRef.trim()
  )?.refs.recheckRef;
}

function nativeHostControlEvidenceFromSession(session: NativeHostSession): NativeHostControlEvidence {
  const evidence = recordValue(session.profile.metadata?.nativeHostControlEvidence);
  return {
    agentQueueRef: stringValue(evidence.agentQueueRef),
    currentFrameRefreshRef: stringValue(evidence.currentFrameRefreshRef),
    safeStopRef: stringValue(evidence.safeStopRef),
  };
}

function nativeHostReplayProjection(record: VirtualAppScreenNativeHostSessionRecord): NativeHostReplayProjection {
  const ledger: NativeHostEvidenceLedger | undefined = record.host.getLedger(record.sessionId);
  return {
    currentRunPointerRef: record.currentRunPointerRef,
    minimalEvidenceReplayRefs: ledger ? deriveNativeHostMinimalEvidenceReplayRefs(ledger) : [],
  };
}

function nativeHostInputInvokeResult(params: {
  command: VirtualScreenInputIntentCommand;
  options: VirtualAppScreenInputRuntimeNativeHostExecutorOptions;
  record: VirtualAppScreenNativeHostSessionRecord;
  intent: VirtualDisplayProviderInvokeResult['intent'];
  runtimeRefs: InputRuntimeRefs;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  currentFrameRef?: string;
  executorEventRefs?: string[];
  controlEvidence?: NativeHostControlEvidence;
  mutatingActionExecuted: boolean;
}): VirtualDisplayProviderInvokeResult {
  return {
    schemaVersion: 'sciforge.virtual-display.provider-invoke-result.v1',
    intent: params.intent,
    providerId: params.options.providerId,
    status: 'ready',
    refs: {
      currentRunRef: params.record.currentRunRef,
      sessionRef: params.command.refs.sessionRef,
      inputLeaseRef: params.command.refs.inputLeaseRef,
      actionAdapterRef: params.command.refs.actionAdapterRef,
      adapterReadinessRef: params.record.adapterReadinessRef,
      evidenceLedgerRef: params.record.evidenceLedgerRef,
      currentFrameRef: params.currentFrameRef ?? params.afterFrameRef ?? params.record.currentFrameRef,
      beforeFrameRef: params.beforeFrameRef ?? params.record.currentFrameRef,
      afterFrameRef: params.afterFrameRef ?? params.beforeFrameRef ?? params.record.currentFrameRef,
      beforeAfterFrameRefs: [
        nativeHostRuntimeRef(params.record, 'before-after', `${sanitizeId(params.command.intentKind)}.json`),
      ],
      inputIntentRefs: [params.runtimeRefs.inputIntentRef],
      executorEventRefs: params.executorEventRefs ?? [params.runtimeRefs.executorEventRef],
      verificationRefs: [
        nativeHostRuntimeRef(params.record, 'verification', `${sanitizeId(params.command.intentKind)}.json`),
      ],
      agentQueueRef: params.controlEvidence?.agentQueueRef,
      currentFrameRefreshRef: params.controlEvidence?.currentFrameRefreshRef,
      safeStopRef: params.controlEvidence?.safeStopRef,
    },
    providerExecuted: true,
    mutatingActionExecuted: params.mutatingActionExecuted,
    rawPayloadWritten: false,
  };
}

function pointRatios(
  command: VirtualScreenInputIntentCommand,
  x: number | undefined,
  y: number | undefined,
  xRatioKey: string,
  yRatioKey: string,
): { xRatio: number; yRatio: number } | { reason: string } {
  const xRatio = command.ratios[xRatioKey] ?? ratioFromCoordinate(x, command.frame?.width);
  const yRatio = command.ratios[yRatioKey] ?? ratioFromCoordinate(y, command.frame?.height);
  if (xRatio === undefined || yRatio === undefined) {
    return { reason: `Native Host pointer input requires ${xRatioKey}/${yRatioKey} or frame-space coordinates.` };
  }
  return {
    xRatio: clampRatio(xRatio),
    yRatio: clampRatio(yRatio),
  };
}

function ratioFromCoordinate(value: number | undefined, size: number | undefined) {
  if (value === undefined || size === undefined || size <= 0) return undefined;
  return value / size;
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function nativeHostRuntimeRef(record: VirtualAppScreenNativeHostSessionRecord, scope: string, leaf: string) {
  return `computer-use:native-host/input-runtime/${record.sessionId}/${scope}/${leaf}`;
}

function isNativeHostSessionRef(value: string | undefined) {
  return value?.startsWith('computer-use:native-host/sessions/') === true;
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

function inputRuntimeCommandWithSessionRef(
  command: VirtualScreenInputIntentCommand,
  sessionRef: string,
): VirtualScreenInputIntentCommand {
  return {
    ...command,
    refs: {
      ...command.refs,
      sessionRef,
    },
  } as VirtualScreenInputIntentCommand;
}

function firstStringRef(results: VirtualDisplayProviderInvokeResult[], key: string) {
  return results.map((result) => stringRef(result, key)).find((ref): ref is string => Boolean(ref));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
