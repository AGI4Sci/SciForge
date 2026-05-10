import type { GatewayRequest, LlmEndpointConfig } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import {
  agentServerBackendSelectionDecision,
  type AgentServerBackendSelectionDecision,
} from './agent-backend-config.js';

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
  const contractRef = stringField(agentHarness.contractRef) ?? stringField(summary.contractRef);
  const traceRef = stringField(agentHarness.traceRef) ?? stringField(summary.traceRef);
  return {
    ...decision,
    harnessSignals: {
      profileId: stringField(agentHarness.profileId) ?? stringField(summary.profileId) ?? stringField(uiState.harnessProfileId),
      contractRef,
      traceRef,
      harnessStage: decision.harnessStage,
      sourceCallbackId: sourceCallbackIdForTraceStage(trace, decision.harnessStage) ?? 'harness.runtime.beforeAgentDispatch',
    },
    trace: {
      ...decision.trace,
      harness: {
        stage: decision.harnessStage,
        contractRef,
        traceRef,
      },
    },
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
