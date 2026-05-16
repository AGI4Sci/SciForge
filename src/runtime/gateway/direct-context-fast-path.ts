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
import { capabilityProviderRoutesForHandoff } from './capability-provider-preflight.js';

export function directContextFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return undefined;
  const decision = directContextDecisionForRequest(request);
  if (!decision) return undefined;
  if (decision.intent === 'capability-status') return directContextDecisionAllowsAnswer(decision)
    ? capabilityStatusFastPathPayload(request)
    : undefined;
  if (!policyRequestsDirectContext(request, decision)) return undefined;
  const context = buildDirectContextFastPathItems({
    artifacts: request.artifacts,
    uiArtifacts: uiState.artifacts,
    references: request.references,
    currentReferences: uiState.currentReferences,
    currentReferenceDigests: uiState.currentReferenceDigests,
    claims: uiState.claims,
    recentExecutionRefs: uiState.recentExecutionRefs,
    executionUnits: uiState.executionUnits,
  });
  if (!context.length) return undefined;
  if (!hasCurrentContextEvidence(context, decision.intent)) return undefined;
  const gate = directContextGate(context, decision);
  if (!gate.allowed) return undefined;
  const missingExpectedArtifacts = missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, context, missingExpectedArtifacts, gate);
  const message = directContextAnswerMessage(request.prompt, context);
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
    decisionRef?: string;
    intent: 'context-summary' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown';
    requiredContext: string[];
    usedContextRefs: string[];
    sufficiency: 'sufficient' | 'insufficient';
    skippedTaskReason?: string;
    blockReason?: string;
  };
}

type DirectContextIntent = DirectContextGateDecision['audit']['intent'];

interface DirectContextDecision {
  decisionRef: string;
  decisionOwner: 'agentserver' | 'backend' | 'harness-policy';
  intent: DirectContextIntent;
  requiredTypedContext: string[];
  usedRefs: string[];
  allowDirectContext?: boolean;
  sufficiency: 'sufficient' | 'insufficient';
  blockReason?: string;
}

function directContextGate(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  decision: DirectContextDecision,
): DirectContextGateDecision {
  const intent = decision.intent;
  const contextRefs = directContextFastPathSupportingRefs(context);
  const usedContextRefs = uniqueStrings([...decision.usedRefs, ...contextRefs]).slice(0, 12);
  const requiredContext = decision.requiredTypedContext.length ? decision.requiredTypedContext : requiredContextForDirectIntent(intent);
  if (intent === 'capability-status') {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext: ['capability-registry', 'tool-registry', 'provider-registry', 'agentserver-worker-registry'],
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Skill/tool/capability/provider status must be answered from registries, not artifact summaries.',
      },
    };
  }
  if (intent === 'fresh-execution') {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext,
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Fresh execution or external lookup request requires backend/tool routing.',
      },
    };
  }
  if (decision.allowDirectContext === false) {
    return {
      allowed: false,
      audit: {
        decisionRef: decision.decisionRef,
        intent,
        requiredContext,
        usedContextRefs,
        sufficiency: 'insufficient',
        blockReason: decision.blockReason ?? 'Structured direct-context decision did not authorize a direct answer.',
      },
    };
  }
  return {
    allowed: true,
    audit: {
      decisionRef: decision.decisionRef,
      intent,
      requiredContext,
      usedContextRefs,
      sufficiency: usedContextRefs.length > 0 ? 'sufficient' : 'insufficient',
      skippedTaskReason: 'Typed current-session context was sufficient for a bounded direct answer.',
    },
  };
}

function directContextDecisionForRequest(request: GatewayRequest): DirectContextDecision | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const execution = isRecord(conversationPolicy.executionModePlan) ? conversationPolicy.executionModePlan : {};
  return firstDirectContextDecision(
    uiState.directContextDecision,
    conversationPolicy.directContextDecision,
    execution.directContextDecision,
  );
}

function firstDirectContextDecision(...values: unknown[]): DirectContextDecision | undefined {
  for (const value of values) {
    const decision = normalizeDirectContextDecision(value);
    if (decision) return decision;
  }
  return undefined;
}

function normalizeDirectContextDecision(value: unknown): DirectContextDecision | undefined {
  if (!isRecord(value)) return undefined;
  const decisionRef = stringField(value.decisionRef);
  const decisionOwner = normalizeDirectContextDecisionOwner(value.decisionOwner);
  const intent = normalizeDirectContextIntent(value.intent);
  const requiredTypedContext = toStringList(value.requiredTypedContext);
  const usedRefs = normalizeDirectContextUsedRefs(value.usedRefs);
  const sufficiency = value.sufficiency === 'sufficient' || value.sufficiency === 'insufficient' ? value.sufficiency : undefined;
  if (!decisionRef || !decisionOwner || !intent || !requiredTypedContext.length || !usedRefs.length || !sufficiency) return undefined;
  return {
    decisionRef,
    decisionOwner,
    intent,
    requiredTypedContext,
    usedRefs,
    allowDirectContext: value.allowDirectContext === false ? false : value.allowDirectContext === true ? true : undefined,
    sufficiency,
    blockReason: stringField(value.blockReason),
  };
}

function normalizeDirectContextDecisionOwner(value: unknown): DirectContextDecision['decisionOwner'] | undefined {
  if (value === 'agentserver' || value === 'backend' || value === 'harness-policy') return value;
  if (value === 'AgentServer') return 'agentserver';
  if (value === 'Backend') return 'backend';
  return undefined;
}

function normalizeDirectContextUsedRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (isRecord(item)) return [stringField(item.ref)].filter((ref): ref is string => Boolean(ref));
    return [];
  }));
}

function normalizeDirectContextIntent(value: unknown): DirectContextIntent | undefined {
  if (value === 'context-summary'
    || value === 'run-diagnostic'
    || value === 'artifact-status'
    || value === 'capability-status'
    || value === 'fresh-execution'
    || value === 'unknown') return value;
  return undefined;
}

function requiredContextForDirectIntent(intent: DirectContextIntent) {
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

function directContextAnswerMessage(
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const riskSummary = riskSummaryAnswer(prompt, context);
  if (riskSummary) return riskSummary;
  return directContextFastPathMessage(context);
}

function riskSummaryAnswer(
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (!/(risk|risks|风险|隐患|问题)/i.test(prompt)) return undefined;
  if (!/(summari[sz]e|summary|概括|总结|归纳|一句|一段|paragraph|简短|short)/i.test(prompt)) return undefined;
  const riskSentences = uniqueStrings(context.flatMap((item) => riskSentencesFromText(item.summary)));
  if (!riskSentences.length) return undefined;
  const selected = riskSentences.slice(0, /two|2|两|二/.test(prompt) ? 2 : 3);
  if (/[一-龥]/.test(prompt)) {
    return `基于当前会话已有上下文直接回答，不启动新的 workspace task。${selected.join('；')}。`;
  }
  return `Answered directly from current-session context without starting a new workspace task. ${selected.join('; ')}.`;
}

function riskSentencesFromText(value: string | undefined) {
  if (!value) return [];
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((part) => part.trim().replace(/^[#*\-\d.\s:：]+/, '').replace(/[。.!?；;]+$/, ''))
    .filter((part) => /(risk|风险|隐患|问题|漂移|溢出|不一致|失败|超时|缺失|阻塞)/i.test(part))
    .slice(0, 6);
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

function hasCurrentContextEvidence(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  intent: DirectContextIntent,
) {
  if (intent === 'run-diagnostic') return context.some((item) => item.ref);
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
  const routeStatus = capabilityProviderRoutesForHandoff(request);
  const selectedIds = uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...(request.selectedSenseIds ?? []),
    ...(request.selectedVerifierIds ?? []),
    ...toStringList(uiState.selectedToolIds),
  ]);
  if (!routeStatus.routes.length && !selectedIds.length && !context.length) return undefined;
  const id = sha1(JSON.stringify({
    prompt: request.prompt,
    routes: routeStatus.routes,
    selectedIds,
    refs: directContextFastPathSupportingRefs(context),
  })).slice(0, 12);
  const routeLines = routeStatus.routes.length
    ? routeStatus.routes.map((route) => {
      const primary = route.primaryProviderId ?? route.providers[0]?.providerId ?? 'none';
      const provider = route.providers.find((candidate) => candidate.providerId === primary);
      const transport = provider?.transport ? `; transport=${provider.transport}` : '';
      return `- ${route.capabilityId}: ${route.status}; primary=${primary}${transport}; ${route.reason}`;
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
      text: routeStatus.ok ? 'Required provider routes are available.' : 'Some requested provider routes are unavailable.',
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
        requiredCapabilityIds: routeStatus.requiredCapabilityIds,
        selectedIds,
        routes: routeStatus.routes,
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
        requiredCapabilityIds: routeStatus.requiredCapabilityIds,
      },
      data: {
        markdown: message,
        routes: routeStatus.routes,
        selectedIds,
        context,
      },
    }],
    objectReferences: [{
      id: `obj-capability-provider-status-${id}`,
      kind: 'runtime-diagnostic',
      title: 'Capability provider status',
      ref: routeRef,
      status: routeStatus.ok ? 'available' : 'needs-attention',
      summary: routeLines.join(' '),
    }],
  };
}

function policyRequestsDirectContext(request: GatewayRequest, decision: DirectContextDecision) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return false;
  if (!directContextDecisionAllowsAnswer(decision)) return false;
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  if (stringField(conversationPolicy.applicationStatus) === 'failed') return false;
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

function directContextDecisionAllowsAnswer(decision: DirectContextDecision) {
  return decision.allowDirectContext === true
    && decision.sufficiency === 'sufficient'
    && Boolean(decision.decisionRef)
    && decision.requiredTypedContext.length > 0
    && decision.usedRefs.length > 0;
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
