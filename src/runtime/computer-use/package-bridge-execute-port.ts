import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRecord } from '../gateway-utils.js';
import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import {
  computerUseActionObservationContextBlockReason,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import { executeGenericDesktopAction, executorBoundary } from './executor.js';
import {
  executeIndependentInputAdapterAction,
  hasExecutableIndependentInputAdapter,
  independentInputAdapterExecutionBoundary,
} from './independent-input-adapter.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, ComputerUseObserveBeforeMutateEvidence, GenericVisionAction, WindowTargetResolution } from './types.js';
import { scheduleComputerUseActionProposals, validateComputerUseScopedAction } from './scheduler.js';
import {
  type VirtualRemoteVisibleArtifact,
} from './virtual-remote-session.js';
import {
  inputChannelDescription,
  toTraceWindowTarget,
} from './window-target.js';
import {
  bindWindowTargetFromOpenAppAction,
} from '../vision-sense/computer-use-window-session.js';
import { workspaceRel } from './utils.js';

type PackageBridgeExecuteState = {
  runDir: string;
  targetResolution: WindowTargetResolution;
  activeAction?: GenericVisionAction;
  executedActions: GenericVisionAction[];
  latestObservation?: Record<string, unknown>;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

type PackagePlanToGenericAction = (
  plan: Record<string, unknown>,
  activeAction?: GenericVisionAction,
  grounding?: Record<string, unknown>,
) => GenericVisionAction;

export async function executePackageBridgePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    callbacks?: WorkspaceRuntimeCallbacks;
    state: PackageBridgeExecuteState;
    packagePlanToGenericAction: PackagePlanToGenericAction;
  },
) {
  const { workspace, config, state } = context;
  const action = await actionWithBridgeObservationEvidence(
    context.packagePlanToGenericAction(recordArg(call, 0), state.activeAction, recordArg(call, 1)),
    state,
    recordArg(call, 1),
    { workspace },
  );
  const requestArg = recordArg(call, 2);
  state.activeAction = action;
  const now = new Date().toISOString();
  const stopSignal = schedulerStopSignalFromAbort(context.callbacks?.signal, now);
  if (stopSignal) {
    const queue = scheduleComputerUseActionProposals([{
      id: `execute-${String(state.executedActions.length).padStart(3, '0')}-${action.type}`,
      action,
      targetResolution: state.targetResolution,
      submittedAt: now,
    }], { now, stopSignal });
    const entry = queue.entries[0];
    return {
      ok: false,
      message: entry?.reason ?? stopSignal.reason ?? 'Computer Use action cancelled before executor lease.',
      blocked: true,
      metadata: {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
        exitCode: 125,
        stderr: entry?.reason ?? stopSignal.reason,
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
        schedulerQueue: queue,
        schedulerDecision: entry,
        schedulerDecisionRefs: entry?.schedulerDecisionRefs,
        observeBeforeMutate: entry?.observeBeforeMutate,
      },
    };
  }
  const observationSummary = stringAt(state.latestObservation, 'summary');
  const visibleTexts = [
    ...stringList(state.latestObservation?.visibleTexts),
    ...stringList(recordAt(state.latestObservation, 'metadata')?.visibleTexts),
  ];
  const contextBlockReason = computerUseActionObservationContextBlockReason({
    actionType: action.type,
    text: action.type === 'type_text' ? action.text : undefined,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    targetAppName: state.targetResolution.ok ? state.targetResolution.appName : undefined,
    targetTitle: state.targetResolution.ok ? state.targetResolution.title : undefined,
    observationSummary,
    visibleTexts,
    visibleTextExtractionEnabled: Boolean(config.visibleTextExtraction?.enabled),
  });
  if (contextBlockReason) {
    return {
      ok: false,
      message: contextBlockReason,
      blocked: true,
      metadata: {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
        exitCode: 125,
        stderr: contextBlockReason,
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      },
    };
  }
  const packageOwnedVirtualSessionIntent = hasExecutableIndependentInputAdapter(config)
    && Boolean(computerUseArtifactIntentText(requestArg));
  if (!config.dryRun && !packageOwnedVirtualSessionIntent) {
    const schedulerDecision = validateComputerUseScopedAction({
      action,
      targetResolution: state.targetResolution,
      observeBeforeMutate: action.observeBeforeMutate,
      now,
    });
    if (!schedulerDecision.ok) {
      return {
        ok: false,
        message: schedulerDecision.reason,
        blocked: true,
        metadata: {
          executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
          exitCode: 125,
          stderr: schedulerDecision.reason,
          inputChannel: inputChannelDescription(config, state.targetResolution),
          windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
          schedulerDecision,
          schedulerDecisionRefs: schedulerDecision.schedulerDecisionRefs,
          observeBeforeMutate: schedulerDecision.observeBeforeMutate,
        },
      };
    }
  }
  const result = config.dryRun
    ? { exitCode: 0, stdout: 'dry-run package bridge', stderr: '' }
    : hasExecutableIndependentInputAdapter(config)
      ? await executeIndependentInputAdapterAction(action, config, state.targetResolution, {
          workspace,
          runDir: state.runDir,
          stepIndex: state.executedActions.length,
          taskText: computerUseArtifactIntentText(requestArg),
        })
      : await executeGenericDesktopAction(action, config, state.targetResolution);
  if (result.exitCode === 0) state.executedActions.push(action);
  if (result.exitCode === 0 && !hasExecutableIndependentInputAdapter(config)) {
    bindWindowTargetFromOpenAppAction(config, action);
  }
  const rawIndependentAdapterMetadata = (result as { independentInputAdapter?: unknown }).independentInputAdapter;
  const independentAdapterMetadata = isRecord(rawIndependentAdapterMetadata)
    ? rawIndependentAdapterMetadata
    : undefined;
  const virtualArtifacts = recordList(independentAdapterMetadata?.visibleArtifacts).filter(isVirtualRemoteVisibleArtifact);
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, virtualArtifacts);
  const virtualRemoteSessionRef = stringAt(independentAdapterMetadata, 'virtualRemoteSessionRef');
  if (virtualRemoteSessionRef) state.virtualRemoteSessionRef = virtualRemoteSessionRef;
  return {
    ok: result.exitCode === 0,
    message: result.stderr || result.stdout || `exitCode=${result.exitCode}`,
    blocked: result.exitCode !== 0,
    metadata: {
      executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      inputChannel: inputChannelDescription(config, state.targetResolution),
      windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      schedulerDecision: isRecord((result as { schedulerDecision?: unknown }).schedulerDecision) ? (result as { schedulerDecision?: unknown }).schedulerDecision : undefined,
      schedulerDecisionRefs: isRecord((result as { schedulerDecision?: Record<string, unknown> }).schedulerDecision?.schedulerDecisionRefs)
        ? (result as { schedulerDecision?: Record<string, unknown> }).schedulerDecision?.schedulerDecisionRefs
        : undefined,
      schedulerLease: isRecord((result as { schedulerLease?: unknown }).schedulerLease) ? (result as { schedulerLease?: unknown }).schedulerLease : undefined,
      independentInputAdapter: independentAdapterMetadata,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: state.visibleArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: state.visibleArtifacts,
    },
  };
}

export function computerUseArtifactIntentText(request: Record<string, unknown>) {
  const metadata = recordAt(request, 'metadata');
  return [
    stringAt(request, 'task'),
    stringAt(request, 'text'),
    metadata ? JSON.stringify(recordAt(metadata, 'plannerAcceptanceContract') ?? {}) : '',
  ].filter((value) => value && value.trim()).join('\n');
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) merged.set(artifact.artifactRef, artifact);
  return [...merged.values()];
}

function isVirtualRemoteVisibleArtifact(record: Record<string, unknown>): record is VirtualRemoteVisibleArtifact {
  return typeof record.artifactRef === 'string'
    && typeof record.dataRef === 'string'
    && typeof record.path === 'string'
    && typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.appId === 'string'
    && record.delivery === 'virtual-remote-session-artifact'
    && Array.isArray(record.visibleTexts)
    && Array.isArray(record.sourceActionIds);
}

function actionWithBridgeObservationEvidence(
  action: GenericVisionAction,
  state: PackageBridgeExecuteState,
  grounding: Record<string, unknown>,
  context: { workspace: string },
): Promise<GenericVisionAction> {
  return actionWithBridgeObservationEvidenceAsync(action, state, grounding, context);
}

async function actionWithBridgeObservationEvidenceAsync(
  action: GenericVisionAction,
  state: PackageBridgeExecuteState,
  grounding: Record<string, unknown>,
  context: { workspace: string },
): Promise<GenericVisionAction> {
  const activeAction = state.activeAction;
  const groundingRef = stringAt(grounding, 'groundingRef')
    ?? stringAt(recordAt(grounding, 'metadata'), 'groundingRef')
    ?? activeAction?.groundingRefs?.[0]
    ?? await writeExecuteGroundingRef({ workspace: context.workspace, state, action, grounding });
  const observeBeforeMutate = bridgeObserveBeforeMutateEvidence(state, grounding, groundingRef);
  const activeGrounding = activeAction?.grounding && isRecord(activeAction.grounding) ? activeAction.grounding : {};
  return {
    ...action,
    grounding: {
      ...activeGrounding,
      ...grounding,
      ...(groundingRef ? { groundingRef } : {}),
      ...(observeBeforeMutate?.sourceObservationRef ? { sourceObservationRef: observeBeforeMutate.sourceObservationRef } : {}),
      ...(observeBeforeMutate?.browserRuntimeObservationRef ? {
        browserRuntimeObservationRef: observeBeforeMutate.browserRuntimeObservationRef,
        browserRuntimeObservationUse: observeBeforeMutate.browserRuntimeObservationUse,
      } : {}),
      ...(observeBeforeMutate?.groundingHintRefs?.length ? { groundingHintRefs: observeBeforeMutate.groundingHintRefs } : {}),
    },
    beforeEvidenceRefs: uniqueStrings([
      ...(activeAction?.beforeEvidenceRefs ?? []),
      ...(observeBeforeMutate?.sourceObservationRef ? [observeBeforeMutate.sourceObservationRef] : []),
      ...(observeBeforeMutate?.screenshotRef ? [observeBeforeMutate.screenshotRef] : []),
      ...(observeBeforeMutate?.captureRef ? [observeBeforeMutate.captureRef] : []),
      ...(observeBeforeMutate?.appStateRef ? [observeBeforeMutate.appStateRef] : []),
      ...(observeBeforeMutate?.accessibilitySnapshotRef ? [observeBeforeMutate.accessibilitySnapshotRef] : []),
      ...(observeBeforeMutate?.stateSnapshotRef ? [observeBeforeMutate.stateSnapshotRef] : []),
      ...(observeBeforeMutate?.browserRuntimeObservationRef ? [observeBeforeMutate.browserRuntimeObservationRef] : []),
      ...(observeBeforeMutate?.browserRuntimeVisibleDomRef ? [observeBeforeMutate.browserRuntimeVisibleDomRef] : []),
      ...(observeBeforeMutate?.browserRuntimeAccessibilitySnapshotRef ? [observeBeforeMutate.browserRuntimeAccessibilitySnapshotRef] : []),
      ...(observeBeforeMutate?.browserRuntimePlaywrightEvaluateRef ? [observeBeforeMutate.browserRuntimePlaywrightEvaluateRef] : []),
      ...(observeBeforeMutate?.groundingHintRefs ?? []),
    ]),
    groundingRefs: uniqueStrings([
      ...(activeAction?.groundingRefs ?? []),
      ...(groundingRef ? [groundingRef] : []),
      ...(observeBeforeMutate?.groundingHintRefs ?? []),
    ]),
    observeBeforeMutate,
  } as GenericVisionAction;
}

function bridgeObserveBeforeMutateEvidence(
  state: PackageBridgeExecuteState,
  grounding: Record<string, unknown>,
  groundingRef: string | undefined,
): ComputerUseObserveBeforeMutateEvidence | undefined {
  const observation = state.latestObservation;
  if (!observation) return undefined;
  const metadata = recordAt(observation, 'metadata') ?? {};
  const observationRef = stringAt(observation, 'ref');
  const screenshotRef = firstTraceRef(metadata.screenshotRefs)
    ?? firstTraceRef(recordAt(observation, 'artifacts')?.screenshotRefs)
    ?? observationRef;
  const target = state.targetResolution.ok ? state.targetResolution : undefined;
  const displayId = target?.displayId ?? target?.target.displayId ?? 1;
  const displayGroupId = stringAt(metadata, 'displayGroupId')
    ?? target?.displayGroupId
    ?? target?.target.displayGroupId
    ?? `display-group-${displayId}`;
  const screenId = stringAt(metadata, 'screenId')
    ?? target?.screenId
    ?? target?.target.screenId
    ?? `screen-${displayId}`;
  const numericWindowId = target?.windowId !== undefined ? `window-${target.windowId}` : undefined;
  const windowId = stringAt(metadata, 'windowId')
    ?? target?.virtualWindowId
    ?? target?.target.virtualWindowId
    ?? numericWindowId
    ?? (target ? `virtual-remote-session-window-${displayId}` : undefined);
  const observedAt = stringAt(metadata, 'observedAt')
    ?? stringAt(metadata, 'capturedAt')
    ?? target?.captureTimestamp
    ?? new Date().toISOString();
  const browserRuntimeHintOnly = browserRuntimeMetadataIsHintOnly(metadata);
  const groundingHintRefs = uniqueStrings([
    ...(browserRuntimeHintOnly ? stringList(metadata.browserRuntimeGroundingHintRefs) : []),
    ...(browserRuntimeHintOnly && stringAt(metadata, 'browserRuntimeGroundingHintRef') ? [stringAt(metadata, 'browserRuntimeGroundingHintRef') as string] : []),
  ]);
  const browserRuntimeAccessibilitySnapshotRef = browserRuntimeHintOnly ? stringAt(metadata, 'browserRuntimeAccessibilitySnapshotRef') : undefined;
  const browserRuntimeStateSnapshotRef = browserRuntimeHintOnly ? stringAt(metadata, 'browserRuntimeStateSnapshotRef') : undefined;
  return {
    appStateRef: stringAt(metadata, 'appStateRef') ?? stringAt(metadata, 'stateSnapshotRef'),
    screenshotRef,
    captureRef: screenshotRef,
    accessibilitySnapshotRef: stringAt(metadata, 'accessibilitySnapshotRef') ?? browserRuntimeAccessibilitySnapshotRef,
    stateSnapshotRef: stringAt(metadata, 'stateSnapshotRef') ?? stringAt(metadata, 'appStateRef') ?? browserRuntimeStateSnapshotRef,
    groundingRef,
    groundingHintRefs,
    browserRuntimeObservationRef: browserRuntimeHintOnly ? stringAt(metadata, 'browserRuntimeObservationRef') : undefined,
    browserRuntimeVisibleDomRef: browserRuntimeHintOnly ? stringAt(metadata, 'browserRuntimeVisibleDomRef') : undefined,
    browserRuntimeAccessibilitySnapshotRef,
    browserRuntimePlaywrightEvaluateRef: browserRuntimeHintOnly ? stringAt(metadata, 'browserRuntimePlaywrightEvaluateRef') : undefined,
    browserRuntimeStateSnapshotRef,
    browserRuntimeObservationUse: browserRuntimeHintOnly && stringAt(metadata, 'browserRuntimeObservationUse') === 'observe-before-mutate-hint'
      ? 'observe-before-mutate-hint'
      : undefined,
    browserRuntimeCompletionEvidenceEligible: false,
    browserRuntimeExecutorLeaseSubstitute: false,
    browserRuntimeGuiActionSubstitute: false,
    browserRuntimeArtifactCausalitySubstitute: false,
    browserRuntimeUserLevelCompletionSubstitute: false,
    sourceObservationRef: observationRef,
    displayGroupId,
    screenId,
    windowId,
    appName: target?.appName,
    windowTitle: target?.title,
    observedAt,
    capturedAt: observedAt,
    freshnessCheckedAt: new Date().toISOString(),
    freshnessCheck: freshnessCheckFromMetadata(metadata, observedAt),
  };
}

function browserRuntimeMetadataIsHintOnly(metadata: Record<string, unknown>) {
  const use = stringAt(metadata, 'browserRuntimeObservationUse');
  if (use !== 'observe-before-mutate-hint') return false;
  if (stringAt(metadata, 'browserRuntimeTrust') !== 'untrusted-page-observation') return false;
  if (metadata.browserRuntimeRefsFirst !== true || metadata.browserRuntimeCurrentBundleOnly !== true) return false;
  const refKeys = [
    'browserRuntimeObservationRef',
    'browserRuntimeVisibleDomRef',
    'browserRuntimeAccessibilitySnapshotRef',
    'browserRuntimePlaywrightEvaluateRef',
    'browserRuntimeStateSnapshotRef',
    'browserRuntimeGroundingHintRef',
  ];
  for (const key of refKeys) {
    const ref = stringAt(metadata, key);
    if (ref && !isBundleLocalObservationRef(ref)) return false;
  }
  for (const ref of stringArrayAt(metadata, 'browserRuntimeGroundingHintRefs')) {
    if (!isBundleLocalObservationRef(ref)) return false;
  }
  return metadata.browserRuntimeCompletionEvidenceEligible === false
    && metadata.browserRuntimeExecutorLeaseSubstitute === false
    && metadata.browserRuntimeGuiActionSubstitute === false
    && metadata.browserRuntimeArtifactCausalitySubstitute === false
    && metadata.browserRuntimeUserLevelCompletionSubstitute === false;
}

function isBundleLocalObservationRef(ref: string) {
  return ref.length > 0
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref)
    && !ref.startsWith('/')
    && !ref.startsWith('~')
    && !ref.split(/[\\/]+/).includes('..');
}

async function writeExecuteGroundingRef(params: {
  workspace: string;
  state: PackageBridgeExecuteState;
  action: GenericVisionAction;
  grounding: Record<string, unknown>;
}) {
  const observationRef = stringAt(params.state.latestObservation, 'ref');
  if (!observationRef) return undefined;
  const stepIndex = params.state.executedActions.length + 1;
  const path = join(params.state.runDir, `step-${String(stepIndex).padStart(3, '0')}-execute-grounding.json`);
  const ref = workspaceRel(params.workspace, path);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.grounding-diagnostic.v1',
    ref,
    source: 'execute-port-observe-before-mutate',
    sourceObservationRef: observationRef,
    actionType: params.action.type,
    targetDescription: params.action.targetDescription,
    targetRegionDescription: params.action.targetRegionDescription,
    grounding: params.grounding,
    windowTarget: params.state.targetResolution.ok ? toTraceWindowTarget(params.state.targetResolution) : undefined,
    writtenAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return ref;
}

function freshnessCheckFromMetadata(metadata: Record<string, unknown>, observedAt: string): ComputerUseObserveBeforeMutateEvidence['freshnessCheck'] {
  const freshness = recordAt(metadata, 'freshnessCheck');
  if (freshness) {
    return {
      status: freshness.status === 'current' || freshness.status === 'stale' || freshness.status === 'unknown'
        ? freshness.status
        : 'unknown',
      checkedAt: stringAt(freshness, 'checkedAt') ?? new Date().toISOString(),
      observedAt: stringAt(freshness, 'observedAt') ?? observedAt,
      expiresAt: stringAt(freshness, 'expiresAt'),
      maxAgeMs: numberAt(freshness.maxAgeMs),
      staleBy: stringAt(freshness, 'staleBy'),
      reason: stringAt(freshness, 'reason'),
    };
  }
  return {
    status: 'current',
    observedAt,
    checkedAt: new Date().toISOString(),
    maxAgeMs: 30_000,
  };
}

function firstTraceRef(value: unknown) {
  const records = recordList(value);
  const recordRef = records
    .map((record) => stringAt(record, 'path') ?? stringAt(record, 'ref'))
    .find((ref): ref is string => Boolean(ref));
  if (recordRef) return recordRef;
  return stringList(value)[0];
}

function schedulerStopSignalFromAbort(signal: AbortSignal | undefined, receivedAt: string) {
  if (!signal?.aborted) return undefined;
  const reason = signal.reason instanceof Error
    ? signal.reason.message
    : typeof signal.reason === 'string'
      ? signal.reason
      : 'workspace runtime stop/cancel signal';
  return {
    aborted: true,
    reason,
    receivedAt,
    ref: `abort-signal:${receivedAt}`,
  };
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function stringArrayAt(value: unknown, key: string) {
  if (!isRecord(value)) return [];
  return stringList(value[key]).filter((item) => item.trim().length > 0);
}

function numberAt(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
