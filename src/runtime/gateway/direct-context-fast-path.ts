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
import { capabilityProviderPreflight } from './capability-provider-preflight.js';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return undefined;
  if (directContextIntent(request.prompt) === 'capability-status') return capabilityStatusFastPathPayload(request);
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
  const gate = directContextGate(request, context);
  if (!gate.allowed) return undefined;
  const missingExpectedArtifacts = missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, context, missingExpectedArtifacts, gate);
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
        directContextGate: gate.audit,
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
        directContextGate: gate.audit,
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
  gate: DirectContextGateDecision,
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
        directContextGate: gate.audit,
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
        directContextGate: gate.audit,
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

interface DirectContextGateDecision {
  allowed: boolean;
  audit: {
    intent: 'context-summary' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown';
    requiredContext: string[];
    usedContextRefs: string[];
    sufficiency: 'sufficient' | 'insufficient';
    skippedTaskReason?: string;
    blockReason?: string;
  };
}

function directContextGate(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
): DirectContextGateDecision {
  const intent = directContextIntent(request.prompt);
  const usedContextRefs = directContextFastPathSupportingRefs(context).slice(0, 12);
  const requiredContext = requiredContextForDirectIntent(intent);
  if (intent === 'capability-status') {
    return {
      allowed: false,
      audit: {
        intent,
        requiredContext: ['capability-registry', 'tool-registry', 'provider-registry', 'agentserver-worker-registry'],
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: 'Skill/tool/capability/provider status must be answered from registries, not artifact summaries.',
      },
    };
  }
  if (intent === 'fresh-execution') {
    return {
      allowed: false,
      audit: {
        intent,
        requiredContext,
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: 'Fresh execution or external lookup request requires backend/tool routing.',
      },
    };
  }
  return {
    allowed: true,
    audit: {
      intent,
      requiredContext,
      usedContextRefs,
      sufficiency: usedContextRefs.length > 0 ? 'sufficient' : 'insufficient',
      skippedTaskReason: 'Typed current-session context was sufficient for a bounded direct answer.',
    },
  };
}

function directContextIntent(prompt: string): DirectContextGateDecision['audit']['intent'] {
  const normalized = prompt.toLowerCase();
  const hasCapabilityStatusIntent = /(?:skill|tool|capabilit|provider|registry|web[-_\s]?search|web[-_\s]?fetch|工具|能力|搜索工具|AgentServer worker)/i.test(prompt)
    && /(?:activated|active|available|enabled|configured|status|source|registry|provider|有哪些|有没有|可用|激活|启用|配置|来源|状态)/i.test(prompt);
  const hasFreshExecutionIntent = /(?:latest|today|news|search|download|fetch|rerun|run again|execute|查找|检索|搜索|最新|今天|下载|执行|重跑|继续跑|联网|arxiv)/i.test(prompt);
  const hasExplicitFreshAction = /(?:download|fetch\s+https?:|\bsearch\b(?![-_\s]?(?:provider|route|tool|status))|rerun|run again|execute|查找|检索|搜索|下载|执行|重跑|继续跑|联网|arxiv)/i.test(prompt);
  const hasBackendOrRepairExecutionIntent = /(?:create|generate|build|produce|make|write|run|execute)\b.{0,120}\b(?:task|adapter|result|payload|artifact|report|run|repair)|\b(?:task|adapter|result|payload|artifact|report|run|repair)\b.{0,120}\b(?:create|generate|build|produce|make|write|run|execute)|(?:return|emit|produce).{0,120}(?:failed[-\s]?with[-\s]?reason|repair-needed|failure reason|recover actions|next step).{0,120}(?:tool payload|payload)|(?:continue|repair).{0,80}(?:last bounded stop|failed run|failure|bounded-stop|adapter task|repair task)|(?:task|adapter|repair)\b.{0,80}\bcontinue|最小.{0,40}(?:任务|适配器|结果)|(?:创建|生成|构建|继续|执行).{0,80}(?:任务|适配器|结果|产物|修复)/i.test(prompt);
  const conditionalNoFreshExecution = /(?:only if needed|if needed|无需|不需要|不要).*?(?:fetch|search|rerun|run|execute|检索|搜索|重跑|执行|调用)|(?:fetch|search|rerun|run|execute|检索|搜索|重跑|执行|调用).{0,120}(?:only if needed|if needed|无需|不需要)/i.test(prompt);
  const hasNoExecutionDirective = /(?:do not|don't|no)\s+(?:rerun|run|execute|dispatch|call)|不要(?:重跑|执行|调用|启动)|只基于当前|current refs only/i.test(prompt);
  if (hasNoExecutionDirective && !hasBackendOrRepairExecutionIntent) {
    return 'context-summary';
  }
  if (hasBackendOrRepairExecutionIntent) return 'fresh-execution';
  if (hasCapabilityStatusIntent && !(hasExplicitFreshAction && !conditionalNoFreshExecution)) return 'capability-status';
  if (hasFreshExecutionIntent) return 'fresh-execution';
  if (/(?:fail|failed|failure|error|diagnos|stderr|stdout|为什么|失败|原因|报错|日志)/i.test(prompt)) return 'run-diagnostic';
  if (/(?:artifact|ref|reference|产物|引用|证据|结果)/i.test(prompt)) return 'artifact-status';
  if (normalized.trim()) return 'context-summary';
  return 'unknown';
}

function requiredContextForDirectIntent(intent: DirectContextGateDecision['audit']['intent']) {
  if (intent === 'run-diagnostic') return ['run-trace', 'execution-units', 'failure-evidence'];
  if (intent === 'artifact-status') return ['artifact-index', 'object-references', 'current-refs'];
  if (intent === 'context-summary') return ['current-session-context'];
  if (intent === 'capability-status') return ['capability-registry', 'tool-registry', 'provider-registry'];
  if (intent === 'fresh-execution') return ['backend-routing', 'capability-provider-routes'];
  return ['typed-current-context'];
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

function capabilityStatusFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    currentReferenceDigests: uiState.currentReferenceDigests,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  const preflight = capabilityProviderPreflight(request);
  const selectedIds = uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...(request.selectedSenseIds ?? []),
    ...(request.selectedVerifierIds ?? []),
    ...toStringList(uiState.selectedToolIds),
  ]);
  if (!preflight.routes.length && !selectedIds.length && !context.length) return undefined;
  const id = sha1(JSON.stringify({
    prompt: request.prompt,
    routes: preflight.routes,
    selectedIds,
    refs: directContextFastPathSupportingRefs(context),
  })).slice(0, 12);
  const routeLines = preflight.routes.length
    ? preflight.routes.map((route) => {
      const primary = route.primaryProviderId ?? route.providers[0]?.providerId ?? 'none';
      const worker = route.providers.find((provider) => provider.providerId === primary)?.workerId;
      return `- ${route.capabilityId}: ${route.status}; primary=${primary}${worker ? `; worker=${worker}` : ''}; ${route.reason}`;
    })
    : ['- No core web/pdf provider route was required by this status query.'];
  const selectedLine = selectedIds.length ? `Selected runtime ids: ${selectedIds.join(', ')}` : 'Selected runtime ids: none reported.';
  const contextMessage = context.length
    ? `\n\nCurrent context summary:\n${directContextFastPathMessage(context)}`
    : '';
  const message = [
    'Tool/provider status answered from SciForge runtime registries without dispatching AgentServer generation.',
    selectedLine,
    'Provider routes:',
    ...routeLines,
    contextMessage,
  ].filter((line) => line !== '').join('\n');
  const routeRef = `runtime://capability-provider-status/${id}`;
  return {
    message,
    confidence: 0.86,
    claimType: 'capability-provider-status',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'Capability/provider status queries are answered from runtime registry and preflight route discovery.',
      'This fast path avoids sending large prior conversation payloads to AgentServer for registry-only follow-up questions.',
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `capability-provider-status-${id}`,
      text: preflight.ok ? 'Required provider routes are available.' : 'Some requested provider routes are unavailable.',
      type: 'observation',
      confidence: 0.86,
      evidenceLevel: 'runtime',
      supportingRefs: [routeRef, ...directContextFastPathSupportingRefs(context).slice(0, 6)],
      opposingRefs: [],
    }],
    uiManifest: directContextUiManifest(`capability-provider-status-${id}`, 'runtime-context-summary'),
    executionUnits: [{
      id: `EU-capability-provider-status-${id}`,
      tool: DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId,
      params: JSON.stringify({
        policy: 'capability-status-fast-path',
        requiredCapabilityIds: preflight.requiredCapabilityIds,
        selectedIds,
        routes: preflight.routes,
      }),
      status: 'done',
      hash: id,
      outputRef: routeRef,
    }],
    artifacts: [{
      id: `capability-provider-status-${id}`,
      type: 'runtime-context-summary',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'capability-status-fast-path',
        routeRef,
        selectedIds,
        requiredCapabilityIds: preflight.requiredCapabilityIds,
      },
      data: {
        markdown: message,
        routes: preflight.routes,
        selectedIds,
        context,
      },
    }],
    objectReferences: [{
      id: `obj-capability-provider-status-${id}`,
      kind: 'runtime-diagnostic',
      title: 'Capability provider status',
      ref: routeRef,
      status: preflight.ok ? 'available' : 'needs-attention',
      summary: routeLines.join(' '),
    }],
  };
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
