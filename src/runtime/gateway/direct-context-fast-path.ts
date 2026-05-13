import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { runtimeResultViewSlotsPolicy } from '../../../packages/presentation/interactive-views';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import {
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  buildDirectContextFastPathItems,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
} from '@sciforge-ui/runtime-contract/artifact-policy';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return undefined;
  if (!policyRequestsDirectContext(request)) return undefined;
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    currentReferenceDigests: uiState.currentReferenceDigests,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  if (!context.length) return undefined;
  if (!hasCurrentContextEvidence(context)) return undefined;
  const missingExpectedArtifacts = missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, context, missingExpectedArtifacts);
  const message = directContextFastPathMessage(context);
  const instance = directContextInstance(request, context);
  const reportId = directContextArtifactId(instance.id);
  const outputRef = directContextOutputRef(instance.id);
  return {
    message,
    confidence: 0.74,
    claimType: DIRECT_CONTEXT_FAST_PATH_POLICY.claimType,
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines.join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `${DIRECT_CONTEXT_FAST_PATH_POLICY.claimId}-${instance.id}`,
      text: context[0]?.summary ?? DIRECT_CONTEXT_FAST_PATH_POLICY.defaultClaimText,
      type: 'fact',
      confidence: 0.74,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs: directContextFastPathSupportingRefs(context),
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(reportId, DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactType),
    executionUnits: [{
      id: `EU-direct-context-${instance.id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
      }),
      status: 'done',
      hash: sha1(message).slice(0, 16),
      runId: instance.runId,
      outputRef,
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
        runId: instance.runId,
        sourceRunId: instance.runId,
        producerRunId: instance.runId,
        outputRef,
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
        runId: instance.runId,
        producerRunId: instance.runId,
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
  const instance = directContextInstance(request, context, missingExpectedArtifacts);
  const reportId = directContextArtifactId(instance.id);
  const outputRef = directContextOutputRef(instance.id);
  const supportingRefs = directContextFastPathSupportingRefs(context);
  const policy = DIRECT_CONTEXT_FAST_PATH_POLICY.missingExpectedArtifacts;
  const missing = missingExpectedArtifacts.join(', ');
  const nextStep = policy.nextStepTemplate.replace('{{missing}}', missing);
  const message = [
    policy.messageHeader,
    `缺失产物：${missing}`,
    `下一步：${nextStep}`,
  ].join('\n');
  return {
    message,
    confidence: 0.52,
    claimType: policy.claimType,
    evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
    reasoningTrace: [
      ...DIRECT_CONTEXT_FAST_PATH_POLICY.reasoningTraceLines,
      'Direct-context fast path was downgraded to needs-work because expected artifacts were not present in current refs.',
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: policy.status,
    },
    claims: [{
      id: `${policy.claimId}-${instance.id}`,
      text: `Missing expected artifacts: ${missing}`,
      type: 'limitation',
      confidence: 0.8,
      evidenceLevel: DIRECT_CONTEXT_FAST_PATH_POLICY.evidenceLevel,
      supportingRefs,
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(reportId, policy.artifactType),
    executionUnits: [{
      id: `EU-direct-context-missing-${instance.id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        contextItemCount: context.length,
        missingExpectedArtifacts,
      }),
      status: 'repair-needed',
      failureReason: `Direct context fast path cannot satisfy follow-up without expected artifacts: ${missing}`,
      recoverActions: [...policy.recoverActions],
      nextStep,
      hash: sha1(message).slice(0, 16),
      runId: instance.runId,
      outputRef,
    }],
    artifacts: [{
      id: reportId,
      type: policy.artifactType,
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: DIRECT_CONTEXT_FAST_PATH_POLICY.source,
        policyOwner: DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner,
        status: policy.status,
        missingExpectedArtifacts,
        contextItemCount: context.length,
        runId: instance.runId,
        sourceRunId: instance.runId,
        producerRunId: instance.runId,
        outputRef,
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
        runId: instance.runId,
        producerRunId: instance.runId,
        status: 'available',
        summary: item.summary,
      })),
  };
}

function directContextInstance(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  extra: unknown = undefined,
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const runId = stringField(uiState.silentStreamRunId)
    ?? stringField(uiState.activeRunId)
    ?? `direct-context-${sha1(JSON.stringify({
      skillDomain: request.skillDomain,
      prompt: request.prompt,
      refs: directContextFastPathSupportingRefs(context),
      extra,
    })).slice(0, 12)}`;
  return { runId, id: sanitizeInstanceId(runId) };
}

function directContextArtifactId(instanceId: string) {
  return `${DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId}-${instanceId}`;
}

function directContextOutputRef(instanceId: string) {
  return `${DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef}/${instanceId}`;
}

function sanitizeInstanceId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || sha1(value).slice(0, 12);
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

function directContextUiManifest(primaryArtifactRef: string, primaryArtifactType: string) {
  return runtimeResultViewSlotsPolicy({
    primaryArtifactRef,
    primaryArtifactType,
    runtimeResultRef: DIRECT_CONTEXT_FAST_PATH_POLICY.uiRoute,
  });
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

function hasCurrentContextEvidence(context: ReturnType<typeof buildDirectContextFastPathItems>) {
  return context.some((item) => item.kind !== 'execution-unit');
}

function policyRequestsDirectContext(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return false;
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  if (stringField(conversationPolicy.applicationStatus) === 'failed') return false;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : {};
  const contract = isRecord(agentHarness.contract) ? agentHarness.contract : {};
  const capabilityPolicy = isRecord(contract.capabilityPolicy) ? contract.capabilityPolicy : {};
  if (
    stringField(contract.intentMode) === 'audit'
    && toStringList(capabilityPolicy.preferredCapabilityIds).includes('runtime.direct-context-answer')
  ) return true;
  if (
    stringField(conversationPolicy.applicationStatus) !== 'applied'
    || stringField(conversationPolicy.policySource) !== DIRECT_CONTEXT_FAST_PATH_POLICY.policyOwner
  ) return false;
  const execution = isRecord(conversationPolicy.executionModePlan) ? conversationPolicy.executionModePlan : {};
  const responsePlan = isRecord(conversationPolicy.responsePlan) ? conversationPolicy.responsePlan : {};
  const latencyPolicy = isRecord(conversationPolicy.latencyPolicy) ? conversationPolicy.latencyPolicy : {};
  const mode = stringField(execution.executionMode);
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
