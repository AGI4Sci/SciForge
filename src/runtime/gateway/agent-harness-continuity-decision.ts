import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toRecordList } from '../gateway-utils.js';

const AGENT_HARNESS_CONTINUITY_DECISION_SCHEMA_VERSION = 'sciforge.agent-harness-continuity-decision.v1';

export function agentHarnessContinuityDecision(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  const policyMode = typeof policy?.mode === 'string' ? policy.mode : '';
  const historyReuse = isRecord(policy?.historyReuse) ? policy.historyReuse : {};
  const repairTargetAvailable = requestHasConcreteRepairTarget(request, uiState);
  const policyAllowsReuse = policyMode === 'continue'
    ? historyReuse.allowed !== false
    : policyMode === 'repair'
      ? historyReuse.allowed !== false && repairTargetAvailable
      : false;
  const currentReferenceCount = toRecordList(uiState.currentReferences).length;
  const recentRefCount = toRecordList(uiState.recentExecutionRefs).length;
  const artifactCount = Array.isArray(request.artifacts) ? request.artifacts.length : 0;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : undefined;
  const summary = isRecord(agentHarness.summary) ? agentHarness.summary : undefined;
  const trace = isRecord(agentHarness.trace) ? agentHarness.trace : undefined;
  const intentMode = stringField(contract?.intentMode) ?? stringField(summary?.intentMode);
  const intentUseContinuity = intentMode === 'continuation'
    || intentMode === 'audit'
    || (intentMode === 'repair' && repairTargetAvailable);
  const useContinuity = intentUseContinuity || policyAllowsReuse;
  const reasons = [
    policyAllowsReuse ? 'reuse-policy-advisory' : undefined,
    intentUseContinuity ? 'intent-continuity' : undefined,
    currentReferenceCount > 0 ? 'current-reference' : undefined,
    recentRefCount > 0 ? 'recent-execution-ref' : undefined,
    artifactCount > 0 ? 'artifact-input' : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    schemaVersion: AGENT_HARNESS_CONTINUITY_DECISION_SCHEMA_VERSION,
    shadowMode: true,
    decisionOwner: 'AgentHost',
    decision: useContinuity ? 'continuity' : 'fresh',
    useContinuity,
    reasons,
    runtimeSignals: {
      policyMode: policyMode || undefined,
      policyAllowsReuse,
      policyDrivesContinuity: policyAllowsReuse ? true : undefined,
      repairTargetAvailable: policyMode === 'repair' ? repairTargetAvailable : undefined,
      currentReferenceCount,
      recentExecutionRefCount: recentRefCount,
      artifactCount,
    },
    harnessSignals: {
      profileId: stringField(agentHarness.profileId) ?? stringField(summary?.profileId) ?? stringField(uiState.harnessProfileId),
      contractRef: stringField(agentHarness.contractRef) ?? stringField(summary?.contractRef),
      traceRef: stringField(agentHarness.traceRef) ?? stringField(summary?.traceRef),
      intentMode,
      intentUseContinuity: intentMode ? intentUseContinuity : undefined,
      sourceCallbackId: sourceCallbackIdForTraceField(trace, 'intentMode') ?? (intentMode ? 'harness.defaults.intentMode' : undefined),
    },
    trace: {
      policy: policy ? {
        source: 'request.uiState.contextReusePolicy',
        mode: policyMode || undefined,
        historyReuseAllowed: historyReuse.allowed === true,
      } : undefined,
      recentExecutionRefs: recentRefCount,
      artifacts: artifactCount,
    },
  };
}

const REPAIR_TARGET_STATUSES = new Set(['failed', 'error', 'repair-needed', 'failed-with-reason', 'needs-human']);

function requestHasConcreteRepairTarget(request: GatewayRequest, uiState: Record<string, unknown>) {
  return [
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
    ...toRecordList(uiState.currentReferenceDigests),
    ...toRecordList(uiState.recentExecutionRefs),
    ...toRecordList(uiState.recentRuns),
    ...toRecordList(uiState.recentExecutionUnits),
    ...toRecordList(uiState.executionUnits),
    isRecord(uiState.activeRun) ? uiState.activeRun : undefined,
    isRecord(uiState.currentRun) ? uiState.currentRun : undefined,
  ].filter((record): record is Record<string, unknown> => Boolean(record)).some(isRepairTargetRecord);
}

function isRepairTargetRecord(record: Record<string, unknown>) {
  const source = stringField(record.source) ?? stringField(record.sourceId) ?? '';
  const kind = stringField(record.kind) ?? '';
  const status = (stringField(record.status) ?? '').toLowerCase();
  return source.toLowerCase() === 'recover-action'
    || source.toLowerCase() === 'failure-evidence'
    || kind.toLowerCase() === 'recover-action'
    || REPAIR_TARGET_STATUSES.has(status)
    || Boolean(stringField(record.failureReason) || stringField(record.stderrRef) || stringField(record.errorRef));
}

function sourceCallbackIdForTraceField(trace: Record<string, unknown> | undefined, field: string) {
  const stages = Array.isArray(trace?.stages) ? trace.stages.filter(isRecord) : [];
  for (const stage of [...stages].reverse()) {
    const callbackId = stringField(stage.callbackId);
    if (!callbackId) continue;
    const decision = isRecord(stage.decision) ? stage.decision : {};
    const intentSignals = isRecord(decision.intentSignals) ? decision.intentSignals : {};
    if (field === 'intentMode' && stringField(intentSignals.intentMode)) return callbackId;
  }
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
