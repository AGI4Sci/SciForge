import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { reportRuntimeResultViewSlots } from '../../../packages/presentation/interactive-views';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import {
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  buildDirectContextFastPathItems,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
} from '@sciforge-ui/runtime-contract/artifact-policy';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  if (!policyRequestsDirectContext(request)) return undefined;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  if (!context.length) return undefined;
  const missingExpectedArtifacts = missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, context, missingExpectedArtifacts);
  const message = directContextFastPathMessage(context);
  const reportId = DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId;
  return {
    message,
    confidence: 0.74,
    claimType: DIRECT_CONTEXT_FAST_PATH_POLICY.claimType,
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines.join('\n'),
    claims: [{
      id: DIRECT_CONTEXT_FAST_PATH_POLICY.claimId,
      text: context[0]?.summary ?? DIRECT_CONTEXT_FAST_PATH_POLICY.defaultClaimText,
      type: 'fact',
      confidence: 0.74,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs: directContextFastPathSupportingRefs(context),
      opposingRefs: [],
    }],
    uiManifest: reportRuntimeResultViewSlots(reportId, DIRECT_CONTEXT_FAST_PATH_POLICY.uiRoute),
    executionUnits: [{
      id: `EU-direct-context-${sha1(JSON.stringify(context)).slice(0, 8)}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
      }),
      status: 'done',
      hash: sha1(message).slice(0, 16),
      outputRef: DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef,
    }],
    artifacts: [{
      id: reportId,
      type: DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactType,
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: DIRECT_CONTEXT_FAST_PATH_POLICY.source,
        policyOwner: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
      },
      data: {
        markdown: message,
        context,
      },
    }],
    objectReferences: context
      .filter((item) => item.ref)
      .map((item, index) => ({
        id: `obj-direct-context-${index + 1}`,
        kind: item.kind,
        title: item.label,
        ref: item.ref,
        status: 'available',
        summary: item.summary,
      })),
  };
}

function missingExpectedArtifactsPayload(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  missingExpectedArtifacts: string[],
): ToolPayload {
  const reportId = DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId;
  const supportingRefs = directContextFastPathSupportingRefs(context);
  const nextStep = `Resume or repair the prior run before answering this follow-up; missing expected artifacts: ${missingExpectedArtifacts.join(', ')}.`;
  const message = [
    '当前会话有可复用 refs，但缺少本轮 follow-up 需要的结构化产物，不能把上下文摘要当作任务成功。',
    `缺失产物：${missingExpectedArtifacts.join(', ')}`,
    `下一步：${nextStep}`,
  ].join('\n');
  return {
    message,
    confidence: 0.52,
    claimType: 'missing-expected-artifacts',
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: [
      ...DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines,
      'Direct-context fast path was downgraded to needs-work because expected artifacts were not present in current refs.',
    ].join('\n'),
    claims: [{
      id: 'direct-context-missing-expected-artifacts',
      text: `Missing expected artifacts: ${missingExpectedArtifacts.join(', ')}`,
      type: 'limitation',
      confidence: 0.8,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs,
      opposingRefs: [],
    }],
    uiManifest: reportRuntimeResultViewSlots(reportId, DIRECT_CONTEXT_FAST_PATH_POLICY.uiRoute),
    executionUnits: [{
      id: `EU-direct-context-missing-${sha1(JSON.stringify({ missingExpectedArtifacts, supportingRefs })).slice(0, 8)}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
        missingExpectedArtifacts,
      }),
      status: 'repair-needed',
      failureReason: `Direct context fast path cannot satisfy follow-up without expected artifacts: ${missingExpectedArtifacts.join(', ')}`,
      recoverActions: [
        'Resume or repair the prior run using preserved execution refs.',
        'Generate the missing expected artifact before answering the format/change/audit follow-up.',
      ],
      nextStep,
      hash: sha1(message).slice(0, 16),
      outputRef: DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef,
    }],
    artifacts: [{
      id: reportId,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: DIRECT_CONTEXT_FAST_PATH_POLICY.source,
        policyOwner: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        status: 'needs-work',
        missingExpectedArtifacts,
        contextItemCount: context.length,
      },
      data: {
        markdown: message,
        context,
      },
    }],
    objectReferences: context
      .filter((item) => item.ref)
      .map((item, index) => ({
        id: `obj-direct-context-missing-${index + 1}`,
        kind: item.kind,
        title: item.label,
        ref: item.ref,
        status: 'available',
        summary: item.summary,
      })),
  };
}

function missingExpectedArtifactTypes(request: GatewayRequest) {
  const expected = expectedArtifactTypesForRequest(request);
  if (!expected.length) return [];
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const artifacts = [...request.artifacts, ...recordRows(uiState.artifacts)];
  const present = new Set(artifacts
    .filter(hasUsableArtifactRefOrData)
    .map((artifact) => stringField(artifact.type) ?? stringField(artifact.artifactType))
    .filter((type): type is string => Boolean(type)));
  return expected.filter((type) => !present.has(type));
}

function hasUsableArtifactRefOrData(artifact: Record<string, unknown>) {
  if (stringField(artifact.dataRef) || stringField(artifact.path) || stringField(artifact.ref)) return true;
  const metadata = artifact.metadata;
  if (isRecord(metadata)) {
    const metadataRefs = ['reportRef', 'markdownRef', 'dataRef', 'path', 'outputRef']
      .some((key) => stringField(metadata[key]));
    if (metadataRefs) return true;
  }
  return artifact.data !== undefined;
}

function policyRequestsDirectContext(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return false;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : {};
  const capabilityPolicy = isRecord(contract.capabilityPolicy) ? contract.capabilityPolicy : {};
  if (
    stringField(contract.intentMode) === 'audit'
    && toStringList(capabilityPolicy.preferredCapabilityIds).includes('runtime.direct-context-answer')
  ) return true;
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const execution = isRecord(uiState.executionModePlan)
    ? uiState.executionModePlan
    : isRecord(conversationPolicy.executionModePlan)
      ? conversationPolicy.executionModePlan
      : isRecord(uiState.executionModeDecision)
      ? uiState.executionModeDecision
      : {};
  const responsePlan = isRecord(uiState.responsePlan) ? uiState.responsePlan : {};
  const latencyPolicy = isRecord(uiState.latencyPolicy) ? uiState.latencyPolicy : {};
  const mode = stringField(execution.executionMode) ?? stringField(execution.executionModeRecommendation);
  const initialMode = stringField(responsePlan.initialResponseMode);
  return mode === 'direct-context-answer'
    && (initialMode === undefined || initialMode === 'direct-context-answer')
    && latencyPolicy.blockOnContextCompaction !== true;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
