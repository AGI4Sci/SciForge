import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { normalizeGenericActionRisk } from './actions.js';
import { toTraceScreenshotRef } from './capture.js';
import { executorBoundary } from './executor.js';
import { independentInputAdapterExecutionBoundary } from './independent-input-adapter.js';
import {
  COMPUTER_USE_ACTION_PROVIDER_ID,
  computerUseHostPortsContract,
  type ComputerUseActionProviderRequest,
} from './host-adapter.js';
import {
  finalArtifactRefsForTrace,
  finalVisibleArtifactForTrace,
  finalWindowScreenshotRef,
} from './package-bridge-final-artifacts.js';
import { materializePackageBridgeTraceRequest } from './package-bridge-request.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import { workspaceRel } from './utils.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import {
  inputChannelContract,
  inputChannelDescription,
  schedulerRunMetadata,
  schedulerStepMetadata,
  stepInputChannelMetadata,
  toTraceWindowTarget,
  windowTargetTraceConfig,
} from './window-target.js';
import {
  visionSenseTraceContractPolicy,
  visionSenseTraceIds,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { computerUseRequiresSavedVisibleArtifact } from '../../../packages/actions/computer-use/runtime-policy.js';
import { VISION_TOOL_ID } from '../vision-sense/computer-use-trace-output.js';
import {
  pixelDiffForScreenshotSets,
} from './capture.js';
import {
  localCoordinateMetadata,
  mappedCoordinateMetadata,
  windowConsistencyMetadata,
  windowLifecycleTrace,
} from '../vision-sense/computer-use-window-session.js';
import { tuiHostRunTaskChainPath } from './package-bridge-evidence.js';

export const PACKAGE_BRIDGE_TRACE_SCHEMA = 'sciforge.computer-use.package-bridge-trace.v1';
const OBSERVATION_COST_TIER_USAGE_SCHEMA = 'sciforge.computer-use.observation-cost-tier-usage.v1';
const ACTION_LEDGER_CAUSALITY_SCHEMA = 'sciforge.computer-use.action-ledger-causality.v1';
const COMPUTER_USE_COST_TIERS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;
const SAFE_TRACE_REF_PREFIXES = new Set([
  'action',
  'artifact',
  'artifact-validation',
  'attempt',
  'benchmark-result',
  'computer-use',
  'evidence',
  'execution-unit',
  'executor-event',
  'freshness',
  'grounding',
  'harness-contract',
  'harness-trace',
  'ledger',
  'log',
  'observation',
  'run',
  'screen',
  'target',
  'trace',
  'verification',
  'verification-artifact',
  'window',
]);

type ComputerUseTraceCostTier = (typeof COMPUTER_USE_COST_TIERS)[number];

type ObservationCostTierUsageEntry = {
  tier: ComputerUseTraceCostTier;
  ref?: string;
  sourceKind?: string;
  fromTier?: ComputerUseTraceCostTier;
  upgradeReason?: string;
  latencyMs?: number;
  modelCallCount?: number;
  reasonCodes?: string[];
};

export type PackageBridgeTraceState = {
  runId: string;
  runDir: string;
  targetResolution: WindowTargetResolution;
  screenshotLedger: ScreenshotRef[];
  captureRefsByObservationRef: Map<string, ScreenshotRef[]>;
  focusRegionByObservationRef: Map<string, FocusRegion>;
  beforeFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  afterFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  actionQueue: GenericVisionAction[];
  executedActions: GenericVisionAction[];
  plannerTraceSteps: LoopStep[];
  visionHistorySteps: LoopStep[];
  missingPlannerAfterCaptured: boolean;
  tracePath?: string;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export type PackageBridgeTraceInput = {
  workspace: string;
  config: ComputerUseConfig;
  state: PackageBridgeTraceState;
  request?: GatewayRequest;
  actionProviderRequest?: ComputerUseActionProviderRequest;
  packageResult: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string;
};

export function materializePackageBridgeTrace(params: PackageBridgeTraceInput) {
  const now = new Date().toISOString();
  const packageResult = sanitizeTracePayload(params.packageResult) as Record<string, unknown>;
  const taskText = stringAt(params.actionProviderRequest, 'task')
    ?? stringAt(params.request, 'text')
    ?? '';
  const finalArtifactSelection = { requireSaved: computerUseRequiresSavedVisibleArtifact(taskText) };
  const finalVisibleArtifact = finalVisibleArtifactForTrace(params.state.visibleArtifacts, finalArtifactSelection);
  const finalArtifactRefs = finalArtifactRefsForTrace(params.state.visibleArtifacts, finalArtifactSelection);
  const finalArtifactRef = finalVisibleArtifact?.artifactRef;
  const finalVisibleScreenshotRef = finalWindowScreenshotRef(params.state.screenshotLedger);
  return {
    schemaVersion: visionSenseTraceIds.traceSchema,
    runId: params.state.runId,
    tool: VISION_TOOL_ID,
    runtime: visionSenseTraceIds.workspaceRuntime,
    packageBridge: {
      schemaVersion: PACKAGE_BRIDGE_TRACE_SCHEMA,
      runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
      actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
      hostPortProtocol: 'ts-host-port-loop',
      tuiHostRunTaskChainRef: workspaceRel(params.workspace, tuiHostRunTaskChainPath(params.state.runDir)),
    },
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    executionBoundary: params.config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(params.config) ?? executorBoundary(params.config),
    createdAt: params.createdAt ?? now,
    completedAt: params.completedAt ?? now,
    request: params.request && params.actionProviderRequest
      ? materializePackageBridgeTraceRequest(params.request, params.actionProviderRequest)
      : undefined,
    artifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
    finalArtifactRef,
    finalArtifactRefs,
    finalVisibleScreenshotRef,
    cuUserAcceptance: finalArtifactRef || finalVisibleScreenshotRef ? {
      finalArtifactRef,
      finalArtifactRefs,
      finalVisibleScreenshotRef,
      visibleArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
    } : undefined,
    config: {
      captureDisplays: params.config.captureDisplays,
      desktopPlatform: params.config.desktopPlatform,
      windowTarget: params.state.targetResolution.ok
        ? toTraceWindowTarget(params.state.targetResolution)
        : {
            ...windowTargetTraceConfig(params.state.targetResolution.target),
            status: 'unresolved',
            diagnostics: params.state.targetResolution.diagnostics,
          },
      outputDir: workspaceRel(params.workspace, params.state.runDir),
      maxSteps: params.config.maxSteps,
      dryRun: params.config.dryRun,
      allowHighRiskActions: params.config.allowHighRiskActions,
      schedulerLockTimeoutMs: params.config.schedulerLockTimeoutMs,
      schedulerStaleLockMs: params.config.schedulerStaleLockMs,
      inputAdapter: params.config.inputAdapter,
      independentInputAdapterProvider: params.config.independentInputAdapterProvider,
      allowSharedSystemInput: params.config.allowSharedSystemInput,
      showVisualCursor: params.config.showVisualCursor,
      completionPolicy: params.config.completionPolicy,
      visibleTextExtraction: params.config.visibleTextExtraction,
      testActionFixtureMode: params.config.testActionFixtureMode,
      testOnlyPlannedActionCount: params.config.testActionFixtureMode ? params.config.testOnlyPlannedActions.length : 0,
    },
    hostPorts: computerUseHostPortsContract(params.config),
    imageMemory: {
      ...visionSenseTraceContractPolicy.imageMemory,
      refs: params.state.screenshotLedger.map(toTraceScreenshotRef),
    },
    virtualRemoteSession: params.state.virtualRemoteSessionRef ? {
      schemaVersion: 'sciforge.computer-use.virtual-remote-session-trace.v1',
      sessionRef: params.state.virtualRemoteSessionRef,
      visibleArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: params.state.visibleArtifacts,
    } : undefined,
    genericComputerUse: {
      actionSchema: visionSenseTraceContractPolicy.genericActionSchema,
      actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
      hostPorts: computerUseHostPortsContract(params.config),
      appSpecificShortcuts: visionSenseTraceContractPolicy.appSpecificShortcuts,
      inputChannel: inputChannelDescription(params.config, params.state.targetResolution),
      inputChannelContract: inputChannelContract(params.config, params.state.targetResolution),
      coordinateContract: visionSenseTraceContractPolicy.coordinateContract(
        params.state.targetResolution.ok ? params.state.targetResolution.coordinateSpace : params.config.windowTarget.coordinateSpace,
      ),
      verifierContract: visionSenseTraceContractPolicy.verifierContract,
      inputIsolation: params.state.targetResolution.ok ? params.state.targetResolution.inputIsolation : params.config.windowTarget.inputIsolation,
      requires: visionSenseTraceContractPolicy.requires,
    },
    windowLifecycle: windowLifecycleTrace(
      params.state.targetResolution.ok
        ? toTraceWindowTarget(params.state.targetResolution)
        : {
            ...windowTargetTraceConfig(params.config.windowTarget),
            captureKind: 'display',
            source: 'display-fallback',
          },
      params.state.screenshotLedger,
    ),
    scheduler: {
      ...schedulerRunMetadata(params.state.targetResolution, params.config),
      executorLock: {
        provider: 'filesystem-lease',
        pathRoot: '/tmp/sciforge-computer-use-locks',
        timeoutMs: params.config.schedulerLockTimeoutMs ?? 60000,
        staleLockMs: params.config.schedulerStaleLockMs ?? 120000,
        appliesTo: params.config.dryRun
          ? 'none-dry-run'
          : independentInputAdapterExecutionBoundary(params.config) ?? 'real-gui-executor',
      },
    },
    validation: {
      ok: params.state.screenshotLedger.every((ref) => Boolean(ref.bytes && ref.sha256 && ref.width && ref.height)),
      checkedRefs: params.state.screenshotLedger.map((ref) => ref.path),
      missingRefs: params.state.screenshotLedger
        .filter((ref) => !ref.bytes || !ref.sha256 || !ref.width || !ref.height)
        .map((ref) => ref.path),
      invalidRefs: [],
      diagnostics: [],
      noInlineImages: !/data:image\/|;base64,/i.test(JSON.stringify(packageResult)),
    },
    observationCostTierUsage: observationCostTierUsageForPackageResult(packageResult, params.state.runId),
    steps: packageResultStepsToVisionSteps(packageResult, params.state, params.config),
    packageResult,
  };
}

export async function writePackageBridgeTrace(params: PackageBridgeTraceInput) {
  const tracePath = join(params.state.runDir, 'vision-trace.json');
  params.state.tracePath = tracePath;
  const trace = sanitizeTracePayload(materializePackageBridgeTrace(params));
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return tracePath;
}

export function packageResultStepsToVisionSteps(
  packageResult: Record<string, unknown>,
  state: PackageBridgeTraceState,
  config: ComputerUseConfig,
): LoopStep[] {
  if (!state.targetResolution.ok) {
    return [{
      id: 'step-000-blocked-window-target',
      kind: 'planning',
      status: 'blocked',
      verifier: {
        status: 'blocked',
        reason: 'target window contract could not be resolved',
        diagnostics: state.targetResolution.diagnostics,
        windowTarget: windowTargetTraceConfig(state.targetResolution.target),
        windowConsistency: windowConsistencyMetadata([], [], config),
      },
      failureReason: state.targetResolution.reason,
    }];
  }
  const packageSteps = Array.isArray(packageResult.steps) ? packageResult.steps.filter(isRecord) : [];
  const steps = packageSteps.filter((step) => {
    const action = recordAt(step, 'action');
    return Boolean(stringAt(action, 'kind') ?? stringAt(action, 'type'));
  });
  if (!steps.length && state.visionHistorySteps.some((step) => step.kind === 'gui-execution')) {
    return state.visionHistorySteps;
  }
  if (!steps.length && state.missingPlannerAfterCaptured) {
    const beforeRefs = refsByName(state, 'step-000-before');
    const afterRefs = refsByName(state, 'step-000-after');
    return [{
      id: 'step-000-plan',
      kind: 'planning',
      status: 'blocked',
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      verifier: {
        status: 'blocked',
        reason: stringAt(packageResult, 'reason') || 'missing Runtime Codex planner/Grounder action plan',
        pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
        windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
      },
      execution: {
        planner: 'computer-use-package-host-port-planner',
        status: 'blocked',
        rawResponse: {
          done: false,
          actions: [],
          reason: stringAt(packageResult, 'reason') || 'Computer Use package planner emitted no action.',
        },
      },
      failureReason: stringAt(packageResult, 'reason') || 'Computer Use package planner emitted no action.',
    }];
  }
  const actionSteps = steps.map((step, index): LoopStep => {
    const actionRecord = recordAt(step, 'action') ?? {};
    const beforeObservationRef = stringAt(step, 'beforeRef') ?? '';
    const beforeRefs = state.captureRefsByObservationRef.get(beforeObservationRef) ?? refsForStepIndex(state, index, 'before');
    const afterRefs = state.captureRefsByObservationRef.get(stringAt(step, 'afterRef') ?? '') ?? refsForStepIndex(state, index, 'after');
    const focusRegion = state.focusRegionByObservationRef.get(beforeObservationRef);
    const beforeFocusRefs = state.beforeFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
    const afterFocusRefs = state.afterFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
    const grounding = normalizeTraceGrounding(recordAt(step, 'grounding') ?? {});
    const status = step.status === 'done' ? 'done' : step.status === 'blocked' ? 'blocked' : 'failed';
    const action = preservePackageBlockedRisk(
      packageTraceActionToGenericAction(actionRecord, grounding),
      step,
      status,
    );
    const execution = recordAt(step, 'execution');
    const executionMetadata = recordAt(execution, 'metadata');
    const executorLease = isRecord(executionMetadata?.schedulerLease) ? executionMetadata.schedulerLease : undefined;
    const verification = recordAt(step, 'verification');
    const pixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
    const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
      ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
      : undefined;
    const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
    const planningFeedback = packageVerifierPlanningFeedback(action, grounding, pixelDiff, windowConsistency, status);
    const regionSemantic = packageRegionSemanticVerifier(action, grounding, pixelDiff, status);
    const maxStepsExhausted = stringAt(packageResult, 'status') === 'max-steps' && index === steps.length - 1;
    const visualFocus = focusRegion ? {
      ...visionSenseTraceContractPolicy.visualFocus,
      region: focusRegion,
      beforeFocusScreenshotRefs: beforeFocusRefs.map(toTraceScreenshotRef),
      afterFocusScreenshotRefs: afterFocusRefs.map(toTraceScreenshotRef),
      pixelDiff: focusPixelDiff,
      fineGrounding: isRecord(grounding.fineGrounding) ? grounding.fineGrounding : undefined,
    } : undefined;
    const actionLedgerCausality = packageActionLedgerCausality({
      step,
      actionRecord,
      grounding,
      beforeRefs,
      afterRefs,
      execution,
      executionMetadata,
      verification,
    });
    return {
      id: `step-${String(index + 1).padStart(3, '0')}-${status === 'blocked' ? 'blocked' : 'execute'}-${action.type}`,
      kind: 'gui-execution',
      status,
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      plannedAction: action,
      grounding,
      windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      localCoordinate: localCoordinateMetadata(grounding, action, beforeRefs[0]),
      mappedCoordinate: mappedCoordinateMetadata(grounding, action),
      inputChannel: stepInputChannelMetadata(config, state.targetResolution),
      visualFocus,
      actionLedgerCausality,
      execution: execution ? {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
        status: execution.ok === false ? 'failed' : 'done',
        exitCode: numberAt(executionMetadata?.exitCode) ?? (execution.ok === false ? 1 : 0),
        stdout: stringAt(executionMetadata, 'stdout'),
        stderr: stringAt(executionMetadata, 'stderr'),
        schedulerLease: executorLease,
        independentInputAdapter: executionMetadata?.independentInputAdapter,
        virtualRemoteSessionRef: stringAt(executionMetadata, 'virtualRemoteSessionRef'),
        visibleArtifactRefs: stringList(executionMetadata?.visibleArtifactRefs),
      } : undefined,
      scheduler: {
        ...schedulerStepMetadata(state.targetResolution, `step-${String(index + 1).padStart(3, '0')}`, config),
        executorLease,
      },
      verifier: {
        status: verification?.ok === false ? 'blocked' : 'checked',
        method: 'computer-use-package-host-port-verifier',
        reason: maxStepsExhausted ? 'maxSteps exhausted before planner reported done=true' : stringAt(verification, 'reason'),
        pixelDiff,
        focusRegionPixelDiff: focusPixelDiff,
        windowConsistency,
        regionSemantic,
        planningFeedback,
        packageVerification: verification,
      },
      failureReason: stringAt(step, 'failureReason') ?? stringAt(step, 'failure_reason') ?? undefined,
    } as LoopStep;
  });
  return mergePlannerAndActionTraceSteps(state.plannerTraceSteps, actionSteps);
}

function observationCostTierUsageForPackageResult(packageResult: Record<string, unknown>, currentRunId: string) {
  const entries = uniqueCostTierUsageEntries(collectObservationCostTierUsageEntries(packageResult, currentRunId))
    .sort((left, right) =>
      costTierRank(left.tier) - costTierRank(right.tier)
      || (left.ref ?? '').localeCompare(right.ref ?? ''),
    );
  if (!entries.length) return undefined;
  const byTier = Object.fromEntries(
    COMPUTER_USE_COST_TIERS.map((tier) => [tier, entries.filter((entry) => entry.tier === tier)]),
  ) as Record<ComputerUseTraceCostTier, ObservationCostTierUsageEntry[]>;
  return {
    schemaVersion: OBSERVATION_COST_TIER_USAGE_SCHEMA,
    entries,
    byTier,
  };
}

function collectObservationCostTierUsageEntries(packageResult: Record<string, unknown>, currentRunId: string): ObservationCostTierUsageEntry[] {
  const entries: ObservationCostTierUsageEntry[] = [];
  const visit = (item: unknown) => {
    if (!isRecord(item)) return;
    if (isNonCurrentOrDiagnosticCostTierRecord(item, currentRunId)) return;

    const observation = recordAt(item, 'observation');
    const metadata = recordAt(item, 'metadata');
    if (isNonCurrentOrDiagnosticCostTierRecord(observation, currentRunId)) return;
    if (isNonCurrentOrDiagnosticCostTierRecord(metadata, currentRunId)) return;
    const registration = recordAt(item, 'costTierRegistration')
      ?? recordAt(observation, 'costTierRegistration')
      ?? recordAt(metadata, 'costTierRegistration');
    const source = recordAt(item, 'source') ?? recordAt(observation, 'source') ?? recordAt(metadata, 'source');
    const ref = firstSafeRefFromRecords([item, observation, metadata], [
      'ref',
      'evidenceRef',
      'observationRef',
      'traceRef',
      'screenshotRef',
      'captureRef',
      'path',
    ]);
    const sourceKind = safeTextAtKeys(item, ['sourceKind'])
      ?? safeTextAtKeys(registration, ['sourceKind'])
      ?? safeTextAtKeys(source, ['kind']);
    if (isDiagnosticSourceKind(sourceKind)) return;
    const tier = parseCostTier(
      safeTextAtKeys(registration, ['tier', 'costTier'])
      ?? safeTextAtKeys(item, ['tier', 'costTier'])
      ?? safeTextAtKeys(observation, ['tier', 'costTier']),
    );
    if (tier) {
      const entry: ObservationCostTierUsageEntry = { tier };
      if (ref) entry.ref = ref;
      if (sourceKind) entry.sourceKind = sourceKind;
      const fromTier = parseCostTier(safeTextAtKeys(registration, ['fromTier', 'from']));
      if (fromTier) entry.fromTier = fromTier;
      const upgradeReason = safeTextAtKeys(registration, ['upgradeReason', 'reason'])
        ?? safeTextAtKeys(item, ['upgradeReason', 'reason']);
      if (upgradeReason) entry.upgradeReason = upgradeReason;
      const latencyMs = numberAtKeys(registration, ['latencyMs', 'latency_ms'])
        ?? numberAtKeys(item, ['latencyMs', 'latency_ms']);
      if (latencyMs !== undefined) entry.latencyMs = latencyMs;
      const modelCallCount = numberAtKeys(registration, ['modelCallCount', 'modelCalls', 'model_call_count', 'model_calls'])
        ?? numberAtKeys(item, ['modelCallCount', 'modelCalls', 'model_call_count', 'model_calls']);
      if (modelCallCount !== undefined) entry.modelCallCount = modelCallCount;
      const reasonCodes = safeStringList(registration?.reasonCodes ?? item.reasonCodes);
      if (reasonCodes.length) entry.reasonCodes = reasonCodes;
      entries.push(entry);
    }
  };
  for (const record of explicitObservationCostTierRecords(packageResult)) visit(record);
  return entries;
}

function explicitObservationCostTierRecords(packageResult: Record<string, unknown>) {
  const evidence = recordAt(packageResult, 'evidence');
  return [
    ...recordListAt(packageResult, 'observationCostTierUsage'),
    ...recordListAt(packageResult, 'evidenceLedger'),
    ...recordListAt(packageResult, 'observationLedger'),
    ...recordListAt(packageResult, 'evidenceRecords'),
    ...recordListAt(packageResult, 'observations'),
    ...recordListAt(evidence, 'ledger'),
    ...recordListAt(evidence, 'records'),
    ...recordListAt(evidence, 'observations'),
  ];
}

function isNonCurrentOrDiagnosticCostTierRecord(record: Record<string, unknown> | undefined, currentRunId: string) {
  if (!record) return false;
  const recordRunId = safeTextAtKeys(record, ['runId', 'currentRunId']);
  if (recordRunId && recordRunId !== currentRunId) return true;
  if (record.stale === true || record.debug === true || record.debugOnly === true || record.providerDebug === true) return true;
  const status = safeTextAtKeys(record, ['status', 'freshnessStatus']);
  if (status && /stale|debug/i.test(status)) return true;
  const classification = safeTextAtKeys(record, ['classification', 'tier', 'category']);
  return Boolean(classification && /debug/i.test(classification));
}

function isDiagnosticSourceKind(value: string | undefined) {
  return Boolean(value && /debug|provider/i.test(value));
}

function uniqueCostTierUsageEntries(entries: ObservationCostTierUsageEntry[]) {
  const seen = new Set<string>();
  const unique: ObservationCostTierUsageEntry[] = [];
  for (const entry of entries) {
    const key = [
      entry.tier,
      entry.ref ?? '',
      entry.sourceKind ?? '',
      entry.fromTier ?? '',
      entry.upgradeReason ?? '',
      entry.latencyMs ?? '',
      entry.modelCallCount ?? '',
      (entry.reasonCodes ?? []).join(','),
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function packageActionLedgerCausality(input: {
  step: Record<string, unknown>;
  actionRecord: Record<string, unknown>;
  grounding: Record<string, unknown>;
  beforeRefs: ScreenshotRef[];
  afterRefs: ScreenshotRef[];
  execution?: Record<string, unknown>;
  executionMetadata?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}) {
  const stepMetadata = recordAt(input.step, 'metadata');
  const actionMetadata = recordAt(input.actionRecord, 'metadata');
  const groundingMetadata = recordAt(input.grounding, 'metadata');
  const verificationMetadata = recordAt(input.verification, 'metadata');
  const beforeObserveRefs = observeBeforeMutateRefs(recordAt(input.actionRecord, 'observeBeforeMutate'))
    .concat(observeBeforeMutateRefs(recordAt(actionMetadata, 'observeBeforeMutate')));
  const groundingObserveRefs = groundingHintRefs(recordAt(input.actionRecord, 'observeBeforeMutate'))
    .concat(groundingHintRefs(recordAt(actionMetadata, 'observeBeforeMutate')));
  const invalidation = freshnessInvalidationRefsAndKeys([
    input.step,
    stepMetadata,
    input.actionRecord,
    actionMetadata,
    input.grounding,
    groundingMetadata,
    input.execution,
    input.executionMetadata,
    input.verification,
    verificationMetadata,
  ]);
  const evidenceScope = traceEvidenceScopeForActionLedger([
    input.step,
    stepMetadata,
    input.actionRecord,
    actionMetadata,
    input.grounding,
    groundingMetadata,
    input.execution,
    input.executionMetadata,
    input.verification,
    verificationMetadata,
  ]);
  const executorEventRef = firstSafeRefFromRecords([
    input.step,
    input.execution,
    input.executionMetadata,
    recordAt(input.execution, 'executorEvent'),
  ], [
    'executorEventRef',
    'executeEventRef',
    'commandEventRef',
    'executorCommandEventRef',
    'commandEventLogRef',
    'ref',
  ]);

  const beforeEvidenceRefs = uniqueTraceStrings([
    ...input.beforeRefs.flatMap((ref) => safeRefStrings(ref.path)),
    ...refsAtKeys(input.step, ['beforeEvidenceRef', 'beforeEvidenceRefs']),
    ...refsAtKeys(stepMetadata, ['beforeEvidenceRef', 'beforeEvidenceRefs']),
    ...refsAtKeys(input.actionRecord, ['beforeEvidenceRef', 'beforeEvidenceRefs']),
    ...refsAtKeys(actionMetadata, ['beforeEvidenceRef', 'beforeEvidenceRefs']),
    ...refsAtKeys(input.grounding, ['sourceObservationRef', 'browserRuntimeObservationRef']),
    ...refsAtKeys(groundingMetadata, ['sourceObservationRef', 'browserRuntimeObservationRef']),
    ...beforeObserveRefs,
  ]);
  const groundingRefs = uniqueTraceStrings([
    ...refsAtKeys(input.step, ['groundingRef', 'groundingRefs']),
    ...refsAtKeys(stepMetadata, ['groundingRef', 'groundingRefs']),
    ...refsAtKeys(input.actionRecord, ['groundingRef', 'groundingRefs']),
    ...refsAtKeys(actionMetadata, ['groundingRef', 'groundingRefs']),
    ...refsAtKeys(input.grounding, ['groundingRef', 'groundingRefs', 'groundingHintRefs']),
    ...refsAtKeys(groundingMetadata, ['groundingRef', 'groundingRefs', 'groundingHintRefs']),
    ...groundingObserveRefs,
  ]);
  const afterEvidenceRefs = uniqueTraceStrings([
    ...input.afterRefs.flatMap((ref) => safeRefStrings(ref.path)),
    ...refsAtKeys(input.step, ['afterEvidenceRef', 'afterEvidenceRefs']),
    ...refsAtKeys(stepMetadata, ['afterEvidenceRef', 'afterEvidenceRefs']),
    ...refsAtKeys(input.actionRecord, ['afterEvidenceRef', 'afterEvidenceRefs']),
    ...refsAtKeys(actionMetadata, ['afterEvidenceRef', 'afterEvidenceRefs']),
  ]);
  const verificationRefs = uniqueTraceStrings([
    ...refsAtKeys(input.step, ['verificationRef', 'verificationRefs']),
    ...refsAtKeys(stepMetadata, ['verificationRef', 'verificationRefs']),
    ...refsAtKeys(input.actionRecord, ['verificationRef', 'verificationRefs']),
    ...refsAtKeys(actionMetadata, ['verificationRef', 'verificationRefs']),
    ...refsAtKeys(input.verification, ['ref', 'verificationRef', 'verificationRefs']),
    ...refsAtKeys(verificationMetadata, ['ref', 'verificationRef', 'verificationRefs']),
  ]);
  const missingRequiredRefs = [
    groundingRefs.length ? undefined : 'groundingRefs',
    executorEventRef ? undefined : 'executorEventRef',
    verificationRefs.length ? undefined : 'verificationRefs',
    invalidation.refs.length || invalidation.keys.length ? undefined : 'freshnessInvalidation',
  ].filter((value): value is string => Boolean(value));

  return {
    schemaVersion: ACTION_LEDGER_CAUSALITY_SCHEMA,
    status: missingRequiredRefs.length ? 'incomplete' : 'complete',
    complete: missingRequiredRefs.length === 0,
    missingRequiredRefs,
    beforeEvidenceRefs,
    groundingRefs,
    executorEventRef,
    afterEvidenceRefs,
    verificationRefs,
    freshnessInvalidationRefs: invalidation.refs,
    freshnessInvalidationKeys: invalidation.keys,
    evidenceScope,
  };
}

function traceEvidenceScopeForActionLedger(records: Array<Record<string, unknown> | undefined>) {
  const evidenceScope = firstRecordFromRecords(records, ['evidenceScope', 'observationScope']);
  const scopeRecords = evidenceScope ? [evidenceScope, ...records] : records;
  const targetRef = firstSafeRefFromRecords(scopeRecords, ['targetRef']);
  const windowRef = firstSafeRefFromRecords(scopeRecords, ['windowRef', 'targetWindowRef']);
  const screenRef = firstSafeRefFromRecords(scopeRecords, ['screenRef']);
  const explicitKind = normalizeEvidenceScopeKind(safeTextAtKeys(evidenceScope, ['kind', 'scopeKind', 'scopeType', 'type']));
  const kind = explicitKind ?? (targetRef ? 'target' : windowRef ? 'window' : undefined);
  if (!kind) return undefined;
  const explicitReason = safeTextAtKeys(evidenceScope, ['reason', 'scopeReason', 'upgradeReason']);
  if ((kind === 'full-screen' || kind === 'cross-window') && !explicitReason) return undefined;
  const reason = explicitReason ?? 'target/window refs present in trace metadata';
  const scope: Record<string, unknown> = { kind };
  if (targetRef) scope.targetRef = targetRef;
  if (windowRef) scope.windowRef = windowRef;
  if (screenRef) scope.screenRef = screenRef;
  const explicitWindowRefs = refsAtKeys(evidenceScope, ['windowRefs']);
  const windowRefs = uniqueTraceStrings([
    ...explicitWindowRefs,
    kind === 'cross-window' ? windowRef : undefined,
  ]);
  if (windowRefs.length) scope.windowRefs = windowRefs;
  scope.reason = reason;
  return scope;
}

function normalizeEvidenceScopeKind(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'target' || normalized === 'target-crop') return 'target';
  if (normalized === 'window' || normalized === 'window-local' || normalized === 'window-crop') return 'window';
  if (normalized === 'cross-window' || normalized === 'multi-window') return 'cross-window';
  if (normalized === 'full-screen' || normalized === 'fullscreen' || normalized === 'screen' || normalized === 'display' || normalized === 'global') return 'full-screen';
  return normalized;
}

function freshnessInvalidationRefsAndKeys(values: Array<Record<string, unknown> | undefined>) {
  const refs: string[] = [];
  const keys: string[] = [];
  const collect = (value: unknown) => {
    if (!isRecord(value)) return;
    refs.push(
      ...refsAtKeys(value, ['refs', 'staleEvidenceRefs', 'freshnessInvalidationRefs', 'invalidatesRefs']),
      ...refsAtKeys(recordAt(value, 'invalidates'), ['refs']),
    );
    keys.push(
      ...safeStringsAtKeys(value, ['keys', 'staleEvidenceKeys', 'freshnessInvalidationKeys', 'invalidatesKeys', 'staleEvidenceKinds']),
      ...safeStringsAtKeys(recordAt(value, 'invalidates'), ['keys']),
    );
  };
  for (const value of values) {
    if (!value) continue;
    collect(recordAt(value, 'freshnessInvalidation'));
    collect(recordAt(value, 'staleEvidenceInvalidation'));
    collect(recordAt(value, 'visibleEvidenceInvalidation'));
    collect(recordAt(value, 'invalidates'));
    collect({
      freshnessInvalidationRefs: value.freshnessInvalidationRefs,
      freshnessInvalidationKeys: value.freshnessInvalidationKeys,
      staleEvidenceRefs: value.staleEvidenceRefs,
      staleEvidenceKeys: value.staleEvidenceKeys,
    });
  }
  return {
    refs: uniqueTraceStrings(refs),
    keys: uniqueTraceStrings(keys),
  };
}

function observeBeforeMutateRefs(value: Record<string, unknown> | undefined) {
  return [
    ...refsAtKeys(value, [
      'appStateRef',
      'screenshotRef',
      'captureRef',
      'accessibilitySnapshotRef',
      'stateSnapshotRef',
      'browserRuntimeObservationRef',
      'browserRuntimeVisibleDomRef',
      'browserRuntimeAccessibilitySnapshotRef',
      'browserRuntimePlaywrightEvaluateRef',
      'browserRuntimeStateSnapshotRef',
      'sourceObservationRef',
    ]),
  ];
}

function groundingHintRefs(value: Record<string, unknown> | undefined) {
  return refsAtKeys(value, ['groundingRef', 'groundingHintRefs']);
}

function preservePackageBlockedRisk(
  action: GenericVisionAction,
  step: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
): GenericVisionAction {
  if (status !== 'blocked') return action;
  const reason = stringAt(step, 'failureReason') ?? stringAt(step, 'failure_reason') ?? '';
  if (!/confirm|approval|high-risk|高风险|确认|授权/i.test(reason)) return action;
  return {
    ...action,
    riskLevel: 'high',
    requiresConfirmation: true,
  };
}

function mergePlannerAndActionTraceSteps(plannerSteps: LoopStep[], actionSteps: LoopStep[]) {
  if (!plannerSteps.length) return actionSteps;
  const remaining = new Map(plannerSteps.map((step) => [step.id, step]));
  const merged: LoopStep[] = [];
  const pushPlanner = (id: string) => {
    const step = remaining.get(id);
    if (!step) return;
    merged.push(step);
    remaining.delete(id);
  };
  pushPlanner('step-000-plan');
  for (const actionStep of actionSteps) {
    merged.push(actionStep);
    const match = /^step-(\d{3})-/.exec(actionStep.id);
    if (match) pushPlanner(`step-${match[1]}-replan`);
  }
  merged.push(...remaining.values());
  return merged;
}

function refsByName(state: PackageBridgeTraceState, fragment: string) {
  return state.screenshotLedger.filter((ref) => ref.id.includes(fragment) || ref.path.includes(fragment));
}

function refsForStepIndex(state: PackageBridgeTraceState, index: number, phase: 'before' | 'after') {
  const stepNumber = String(index + 1).padStart(3, '0');
  return refsByName(state, `step-${stepNumber}-${phase}`);
}

function normalizeTraceGrounding(grounding: Record<string, unknown>) {
  const metadata = recordAt(grounding, 'metadata') ?? {};
  return {
    ...metadata,
    ...grounding,
  };
}

function packageTraceActionToGenericAction(action: Record<string, unknown>, grounding: Record<string, unknown> = {}): GenericVisionAction {
  const type = (stringAt(action, 'kind') ?? 'wait') as GenericVisionAction['type'];
  const targetDescription = stringAt(action, 'target');
  const targetRegionDescription = stringAt(action, 'targetRegion');
  const riskLevel = parseRiskLevel(stringAt(action, 'riskLevel'));
  const base = {
    targetDescription,
    targetRegionDescription,
    riskLevel,
    requiresConfirmation: action.requiresConfirmation === true,
  };
  const x = numberAt(action.x) ?? numberAt(grounding.x) ?? numberAt(grounding.executorX) ?? numberAt(grounding.localX);
  const y = numberAt(action.y) ?? numberAt(grounding.y) ?? numberAt(grounding.executorY) ?? numberAt(grounding.localY);
  if (type === 'click') return normalizeGenericActionRisk({ ...base, type: 'click', x, y });
  if (type === 'double_click') return normalizeGenericActionRisk({ ...base, type: 'double_click', x, y });
  if (type === 'drag') {
    return normalizeGenericActionRisk({
      ...base,
      type: 'drag',
      fromX: numberAt(action.fromX)
        ?? numberAt(grounding.executorFromX)
        ?? numberAt(grounding.localFromX),
      fromY: numberAt(action.fromY)
        ?? numberAt(grounding.executorFromY)
        ?? numberAt(grounding.localFromY),
      toX: numberAt(action.toX)
        ?? numberAt(grounding.executorToX)
        ?? numberAt(grounding.localToX),
      toY: numberAt(action.toY)
        ?? numberAt(grounding.executorToY)
        ?? numberAt(grounding.localToY),
      fromTargetDescription: stringAt(action, 'fromTargetDescription') ?? stringAt(grounding, 'fromTargetDescription'),
      toTargetDescription: stringAt(action, 'toTargetDescription') ?? stringAt(grounding, 'toTargetDescription'),
    });
  }
  if (type === 'type_text') return normalizeGenericActionRisk({ ...base, type: 'type_text', text: stringAt(action, 'text') ?? '' });
  if (type === 'press_key') return normalizeGenericActionRisk({ ...base, type: 'press_key', key: stringAt(action, 'key') ?? '' });
  if (type === 'hotkey') return normalizeGenericActionRisk({ ...base, type: 'hotkey', keys: stringList(action.keys) });
  if (type === 'scroll') return normalizeGenericActionRisk({ ...base, type: 'scroll', direction: scrollDirection(stringAt(action, 'direction')), amount: numberAt(action.amount) });
  if (type === 'open_app') return normalizeGenericActionRisk({ ...base, type: 'open_app', appName: stringAt(action, 'appName') ?? '' });
  if (type === 'save') return normalizeGenericActionRisk({ ...base, type: 'save', targetPath: stringAt(action, 'targetPath') });
  if (type === 'open_menu') return normalizeGenericActionRisk({ ...base, type: 'open_menu', menuName: stringAt(action, 'menuName') });
  return normalizeGenericActionRisk({ ...base, type: 'wait' });
}

export function packageVerifierPlanningFeedback(
  action: GenericVisionAction,
  grounding: Record<string, unknown>,
  pixelDiff: Record<string, unknown>,
  windowConsistency: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
) {
  const noVisibleEffect = pixelDiff.possiblyNoEffect === true;
  const ratios = Array.isArray(pixelDiff.pairs)
    ? pixelDiff.pairs
      .filter(isRecord)
      .map((pair) => numberAt(pair.changedByteRatio)?.toFixed(4) ?? 'unknown')
      .join(',')
    : 'unknown';
  const target = action.targetDescription ? ` target="${action.targetDescription}"` : '';
  const local = numberAt(grounding.localX) !== undefined && numberAt(grounding.localY) !== undefined
    ? ` local=${numberAt(grounding.localX)},${numberAt(grounding.localY)}`
    : '';
  const executor = numberAt(grounding.executorX) !== undefined && numberAt(grounding.executorY) !== undefined
    ? ` executor=${numberAt(grounding.executorX)},${numberAt(grounding.executorY)}`
    : '';
  const next = status === 'done' && noVisibleEffect
    ? `${action.type} produced no visible window effect; avoid repeating same target unless screenshot changed`
    : status === 'done'
      ? 'continue only if the visible task is not complete'
      : 'repair the blocked or failed action before retrying';
  return [
    `pixel=${noVisibleEffect ? 'no-visible-effect' : 'changed'} ratios=${ratios}`,
    `window=${stringAt(windowConsistency, 'status') ?? 'unknown'} sameWindow=${windowConsistency.sameWindow === true} scopeOk=${windowConsistency.scopeOk === true}`,
    `grounding=${stringAt(grounding, 'status') ?? 'ok'}${target}${local}${executor}`,
    `next=${next}`,
  ].join(' | ');
}

export function packageRegionSemanticVerifier(
  action: GenericVisionAction,
  grounding: Record<string, unknown>,
  pixelDiff: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
) {
  const noVisibleEffect = pixelDiff.possiblyNoEffect === true;
  const verdict = status !== 'done'
    ? 'action-not-applied'
    : noVisibleEffect
      ? 'focused-target-no-visible-effect'
      : 'focused-target-reacted';
  const nextPlannerHint = status !== 'done'
    ? 'repair the blocked or failed action before retrying'
    : noVisibleEffect
      ? 'switch modality, choose a different visible control, or request a wider focus region'
      : 'continue only if the visible task is not complete';
  return {
    schemaVersion: 'sciforge.vision-sense.region-semantic-verifier.v1',
    verdict,
    confidence: noVisibleEffect ? 0.78 : 0.72,
    targetDescription: action.targetDescription,
    actionType: action.type,
    focusChanged: !noVisibleEffect,
    windowChanged: !noVisibleEffect,
    possiblyNoEffect: noVisibleEffect,
    grounding: {
      localX: numberAt(grounding.localX),
      localY: numberAt(grounding.localY),
      executorX: numberAt(grounding.executorX),
      executorY: numberAt(grounding.executorY),
    },
    nextPlannerHint,
    summary: [
      `regionSemantic=${verdict}`,
      `action=${action.type}`,
      action.targetDescription ? `target="${action.targetDescription}"` : undefined,
      `next=${nextPlannerHint}`,
    ].filter(Boolean).join(' | '),
  };
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

function numberAt(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordListAt(value: Record<string, unknown> | undefined, key: string) {
  if (!value || !Array.isArray(value[key])) return [];
  return value[key].filter(isRecord);
}

function scrollDirection(value: string | undefined): 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'left' || value === 'right' ? value : 'down';
}

function sanitizeTracePayload(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'string') return sanitizeTraceString(value);
  if (value === null || typeof value !== 'object') return value;
  const prior = seen.get(value);
  if (prior) return prior;
  if (Array.isArray(value)) {
    const sanitizedArray: unknown[] = [];
    seen.set(value, sanitizedArray);
    sanitizedArray.push(
      ...value
        .map((item) => sanitizeTracePayload(item, seen))
        .filter((item) => item !== undefined),
    );
    return sanitizedArray;
  }
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  seen.set(value, sanitized);
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveTracePayloadKey(key)) continue;
    const sanitizedItem = sanitizeTracePayload(item, seen);
    if (sanitizedItem !== undefined) sanitized[key] = sanitizedItem;
  }
  return sanitized;
}

function sanitizeTraceString(value: string) {
  if (isSensitiveTracePayloadToken(value)) return '[redacted-trace-payload-token]';
  if (hasInlinePayload(value)) return '[redacted-inline-trace-payload]';
  if (value.length > 4096 && !isSafeTraceRef(value)) return '[redacted-large-trace-string]';
  return value;
}

function isSensitiveTracePayloadKey(key: string) {
  const normalized = normalizeTracePayloadToken(key);
  return normalized === 'rawproviderpayload'
    || normalized === 'providerrequestbody'
    || normalized === 'providerresponsebody'
    || normalized === 'rawpayload'
    || normalized === 'rawscreenshot'
    || normalized === 'inlinescreenshot'
    || normalized === 'inlineimagebytes'
    || normalized === 'imagebytes'
    || normalized === 'imagebase64'
    || normalized === 'screenshotbase64'
    || normalized === 'base64';
}

function isSensitiveTracePayloadToken(value: string) {
  const text = value.trim();
  if (!text || text.length > 80) return false;
  return isSensitiveTracePayloadKey(text);
}

function normalizeTracePayloadToken(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function parseRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function parseCostTier(value: string | undefined): ComputerUseTraceCostTier | undefined {
  return COMPUTER_USE_COST_TIERS.includes(value as ComputerUseTraceCostTier)
    ? value as ComputerUseTraceCostTier
    : undefined;
}

function costTierRank(tier: ComputerUseTraceCostTier) {
  return COMPUTER_USE_COST_TIERS.indexOf(tier);
}

function numberAtKeys(value: Record<string, unknown> | undefined, keys: string[]) {
  if (!value) return undefined;
  for (const key of keys) {
    const number = numberAt(value[key]);
    if (number !== undefined) return number;
  }
  return undefined;
}

function safeTextAtKeys(value: Record<string, unknown> | undefined, keys: string[]) {
  if (!value) return undefined;
  for (const key of keys) {
    const item = safeTraceText(value[key]);
    if (item) return item;
  }
  return undefined;
}

function safeStringsAtKeys(value: Record<string, unknown> | undefined, keys: string[]) {
  if (!value) return [];
  return uniqueTraceStrings(keys.flatMap((key) => safeStringList(value[key])));
}

function refsAtKeys(value: Record<string, unknown> | undefined, keys: string[]) {
  if (!value) return [];
  return uniqueTraceStrings(keys.flatMap((key) => safeRefStrings(value[key])));
}

function firstSafeRefFromRecords(records: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const record of records) {
    if (!record) continue;
    const direct = refsAtKeys(record, keys)[0];
    if (direct) return direct;
    const targetRefs = refsAtKeys(recordAt(record, 'targetRefs'), keys)[0];
    if (targetRefs) return targetRefs;
    const target = refsAtKeys(recordAt(record, 'target'), keys)[0];
    if (target) return target;
    const session = refsAtKeys(recordAt(record, 'session'), keys)[0];
    if (session) return session;
  }
  return undefined;
}

function firstRecordFromRecords(records: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const found = recordAt(record, key);
      if (found) return found;
    }
  }
  return undefined;
}

function safeRefStrings(value: unknown): string[] {
  if (typeof value === 'string') return isSafeTraceRef(value) ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(safeRefStrings);
  if (isRecord(value)) {
    return uniqueTraceStrings([
      ...safeRefStrings(value.ref),
      ...safeRefStrings(value.path),
      ...safeRefStrings(value.uri),
    ]);
  }
  return [];
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueTraceStrings(value.flatMap((item) => {
    const text = safeTraceText(item);
    return text ? [text] : [];
  }));
}

function safeTraceText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && !hasInlinePayload(text) ? text : undefined;
}

function isSafeTraceRef(value: string) {
  const text = value.trim();
  if (!text || hasInlinePayload(text)) return false;
  if (text.startsWith('.sciforge/')) return !text.includes('://');
  if (text.startsWith('/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false;
  const separatorIndex = text.indexOf(':');
  if (separatorIndex <= 0) return false;
  const prefix = text.slice(0, separatorIndex);
  const body = text.slice(separatorIndex + 1);
  if (!SAFE_TRACE_REF_PREFIXES.has(prefix)) return false;
  if (!body || body.startsWith('/') || body.startsWith('//') || body.includes('://')) return false;
  return true;
}

function hasInlinePayload(value: string) {
  return /data:image|;base64,/i.test(value);
}

function uniqueTraceStrings(values: readonly (string | undefined)[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = safeTraceText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  return unique;
}
