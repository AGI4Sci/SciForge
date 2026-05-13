import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toRecordList } from '../gateway-utils.js';

const AGENT_HARNESS_CONTINUITY_DECISION_SCHEMA_VERSION = 'sciforge.agent-harness-continuity-decision.v1';

export function agentHarnessContinuityDecision(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policy = isRecord(uiState.contextReusePolicy)
    ? uiState.contextReusePolicy
    : isRecord(uiState.contextIsolation)
      ? uiState.contextIsolation
      : undefined;
  const policyMode = typeof policy?.mode === 'string' ? policy.mode : '';
  const historyReuse = isRecord(policy?.historyReuse) ? policy.historyReuse : {};
  const policyAllowsReuse = historyReuse.allowed === true || policyMode === 'continue' || policyMode === 'repair';
  const currentReferenceCount = toRecordList(uiState.currentReferences).length;
  const recentRefCount = toRecordList(uiState.recentExecutionRefs).length;
  const artifactCount = Array.isArray(request.artifacts) ? request.artifacts.length : 0;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : undefined;
  const summary = isRecord(agentHarness.summary) ? agentHarness.summary : undefined;
  const trace = isRecord(agentHarness.trace) ? agentHarness.trace : undefined;
  const intentMode = stringField(contract?.intentMode) ?? stringField(summary?.intentMode);
  const intentUseContinuity = intentMode === 'continuation' || intentMode === 'repair' || intentMode === 'audit';
  const useContinuity = intentUseContinuity;
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
    decisionOwner: 'AgentServer',
    decision: useContinuity ? 'continuity' : 'fresh',
    useContinuity,
    reasons,
    runtimeSignals: {
      policyMode: policyMode || undefined,
      policyAllowsReuse,
      policyReuseIsAdvisory: policyAllowsReuse ? true : undefined,
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
        source: isRecord(uiState.contextReusePolicy) ? 'request.uiState.contextReusePolicy' : 'request.uiState.contextIsolation',
        mode: policyMode || undefined,
        historyReuseAllowed: historyReuse.allowed === true,
      } : undefined,
      recentExecutionRefs: recentRefCount,
      artifacts: artifactCount,
    },
  };
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
