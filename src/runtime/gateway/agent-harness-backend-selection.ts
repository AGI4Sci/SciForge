import type { GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { HARNESS_EXTERNAL_HOOK_STAGES } from '../../../packages/agent-harness/src/runtime.js';
import {
  agentServerBackendSelectionDecision,
  type AgentServerBackendSelectionDecision,
} from './agent-backend-config.js';

export type AgentHarnessStageHookTraceMetadata = ReturnType<typeof agentHarnessStageHookTraceMetadata>;

export function agentHarnessBackendSelectionDecision(
  request: GatewayRequest,
  input: {
    backendSelectionDecision?: AgentServerBackendSelectionDecision;
    llmEndpoint?: LlmEndpointConfig;
    agentHarness?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = input.agentHarness ?? (isRecord(uiState.agentHarness) ? uiState.agentHarness : {});
  const summary = input.summary ?? (isRecord(agentHarness.summary) ? agentHarness.summary : {});
  const trace = input.trace ?? (isRecord(agentHarness.trace) ? agentHarness.trace : undefined);
  const decision = input.backendSelectionDecision ?? agentServerBackendSelectionDecision(request, input.llmEndpoint);
  const harnessSignals = agentHarnessStageHookTraceMetadata(request, decision.harnessStage, { agentHarness, summary, trace });
  return {
    ...decision,
    harnessSignals,
    trace: {
      ...decision.trace,
      harness: {
        stage: decision.harnessStage,
        contractRef: harnessSignals.contractRef,
        traceRef: harnessSignals.traceRef,
        externalHookStage: harnessSignals.externalHook.stage,
        externalHookDeclaredBy: harnessSignals.externalHook.declaredBy,
        externalHookDeclared: harnessSignals.externalHook.declared,
      },
    },
  };
}

export function agentHarnessStageHookTraceMetadata(
  request: GatewayRequest,
  stage: string,
  input: {
    agentHarness?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  } = {},
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const agentHarness = input.agentHarness ?? (isRecord(uiState.agentHarness) ? uiState.agentHarness : {});
  const summary = input.summary ?? (isRecord(agentHarness.summary) ? agentHarness.summary : {});
  const trace = input.trace ?? (isRecord(agentHarness.trace) ? agentHarness.trace : undefined);
  const externalHook = agentHarnessExternalHookTraceMetadata(stage);
  return {
    profileId: stringField(agentHarness.profileId) ?? stringField(summary.profileId) ?? stringField(uiState.harnessProfileId),
    contractRef: stringField(agentHarness.contractRef) ?? stringField(summary.contractRef),
    traceRef: stringField(agentHarness.traceRef) ?? stringField(summary.traceRef),
    harnessStage: stage,
    externalHook,
    sourceCallbackId: sourceCallbackIdForTraceStage(trace, stage) ?? `harness.runtime.${stage}`,
  };
}

export function agentHarnessExternalHookTraceMetadata(stage: string) {
  return {
    schemaVersion: 'sciforge.agent-harness-external-hook-trace.v1',
    stage,
    stageGroup: 'external-hook',
    declaredBy: 'HARNESS_EXTERNAL_HOOK_STAGES',
    declared: HARNESS_EXTERNAL_HOOK_STAGES.some((declaredStage) => declaredStage === stage),
  };
}

function sourceCallbackIdForTraceStage(trace: Record<string, unknown> | undefined, expectedStage: string) {
  const stages = Array.isArray(trace?.stages) ? trace.stages.filter(isRecord) : [];
  for (const stage of [...stages].reverse()) {
    if (stringField(stage.stage) !== expectedStage) continue;
    const callbackId = stringField(stage.callbackId);
    if (callbackId) return callbackId;
  }
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
