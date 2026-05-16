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
  const transformMode = decision.transformMode && decision.transformMode !== 'none'
    ? decision.transformMode
    : answerOnlyTransformRequestedLegacyFallback(request.prompt);
  const missingExpectedArtifacts = transformMode ? [] : missingExpectedArtifactTypes(request);
  if (missingExpectedArtifacts.length) return missingExpectedArtifactsPayload(request, context, missingExpectedArtifacts, gate);
  const message = directContextAnswerMessage(request, context, decision);
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
      text: directContextClaimText(message, context),
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
    intent: DirectContextIntent;
    requiredContext: string[];
    usedContextRefs: string[];
    sufficiency: 'sufficient' | 'insufficient';
    skippedTaskReason?: string;
    blockReason?: string;
  };
}

type DirectContextIntent =
  | 'context-summary'
  | 'context-summary:risk'
  | 'context-summary:method'
  | 'context-summary:timeline'
  | 'run-diagnostic'
  | 'artifact-status'
  | 'capability-status'
  | 'fresh-execution'
  | 'unknown';

type DirectContextTransformMode =
  | 'answer-only-compress'
  | 'answer-only-summary'
  | 'answer-only-checklist'
  | 'none';

interface DirectContextDecision {
  decisionRef: string;
  decisionOwner: 'agentserver' | 'backend' | 'harness-policy';
  intent: DirectContextIntent;
  requiredTypedContext: string[];
  usedRefs: string[];
  allowDirectContext?: boolean;
  transformMode?: DirectContextTransformMode;
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
  const harnessContract = isRecord(conversationPolicy.harnessContract) ? conversationPolicy.harnessContract : {};
  return normalizeDirectContextDecision(harnessContract.directContextDecision);
}

function normalizeDirectContextDecision(value: unknown): DirectContextDecision | undefined {
  if (!isRecord(value)) return undefined;
  const decisionRef = stringField(value.decisionRef);
  const decisionOwner = normalizeDirectContextDecisionOwner(value.decisionOwner);
  const intent = normalizeDirectContextIntent(value.intent);
  const requiredTypedContext = toStringList(value.requiredTypedContext);
  const usedRefs = normalizeDirectContextUsedRefs(value.usedRefs);
  const transformMode = normalizeDirectContextTransformMode(value.transformMode);
  const sufficiency = value.sufficiency === 'sufficient' || value.sufficiency === 'insufficient' ? value.sufficiency : undefined;
  if (!decisionRef || !decisionOwner || !intent || !requiredTypedContext.length || !usedRefs.length || !sufficiency) return undefined;
  return {
    decisionRef,
    decisionOwner,
    intent,
    requiredTypedContext,
    usedRefs,
    allowDirectContext: value.allowDirectContext === false ? false : value.allowDirectContext === true ? true : undefined,
    transformMode,
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
    || value === 'context-summary:risk'
    || value === 'context-summary:method'
    || value === 'context-summary:timeline'
    || value === 'run-diagnostic'
    || value === 'artifact-status'
    || value === 'capability-status'
    || value === 'fresh-execution'
    || value === 'unknown') return value;
  return undefined;
}

function normalizeDirectContextTransformMode(value: unknown): DirectContextTransformMode | undefined {
  if (value === 'answer-only-compress'
    || value === 'answer-only-summary'
    || value === 'answer-only-checklist'
    || value === 'none') return value;
  return undefined;
}

function requiredContextForDirectIntent(intent: DirectContextIntent) {
  if (intent === 'run-diagnostic') return ['run-trace', 'execution-units', 'failure-evidence'];
  if (intent === 'artifact-status') return ['artifact-index', 'object-references', 'current-refs'];
  if (intent.startsWith('context-summary')) return ['current-session-context'];
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
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  decision: DirectContextDecision,
) {
  const prompt = request.prompt;
  const transformed = answerOnlyTransformMessage(prompt, context, decision.transformMode);
  if (transformed) return transformed;
  const intentSummary = intentSummaryAnswer(decision.intent, prompt, context);
  if (intentSummary) return intentSummary;
  const selectedReferenceSummary = selectedReferenceSummaryMessage(request, context);
  if (selectedReferenceSummary) return selectedReferenceSummary;
  return directContextFastPathMessage(context);
}

function answerOnlyTransformMessage(
  text: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  transformMode: DirectContextTransformMode | undefined,
) {
  const requested = transformMode && transformMode !== 'none'
    ? transformMode
    : answerOnlyTransformRequestedLegacyFallback(text);
  if (!requested) {
    return undefined;
  }
  const prioritizedContext = [
    ...context.filter((item) => /claim|finding|answer/i.test(item.kind)),
    ...context.filter((item) => !/claim|finding|answer/i.test(item.kind)),
  ];
  const snippets = directContextStatements(prioritizedContext, { answerOnlyTransform: true })
    .slice(0, requested === 'answer-only-checklist' || /three|3|三/.test(text) ? 3 : /two|2|两|二/.test(text) ? 2 : 5);
  if (!snippets.length) return undefined;
  if (requested === 'answer-only-checklist' || /(checklist|bullet|清单|列表)/i.test(text)) {
    const header = /[一-龥]/.test(text) ? '基于上一轮可见答案整理为清单：' : 'Checklist from the previous visible answer:';
    return [header, ...snippets.map((item) => `- ${item}`)].join('\n');
  }
  if (/[一-龥]/.test(text)) {
    return `基于上一轮可见答案直接回答：${snippets.join('；')}。`;
  }
  return `Direct answer from the previous visible answer: ${snippets.join('; ')}.`;
}

function answerOnlyTransformRequestedLegacyFallback(text: string): DirectContextTransformMode | undefined {
  // Legacy baseline fallback for requests that predate the harness L1
  // classifyDirectContextTransform hook.
  const matched = /(compress|condense|shorten|summari[sz]e|rewrite|rephrase|checklist|bullet|压缩|浓缩|改写|重写|总结|归纳|清单)/i.test(text)
    && /(previous|prior|last|existing|above|answer|conclusion|points?|上一轮|之前|刚才|已有|答案|结论|要点)/i.test(text)
    && !/(rerun|run again|execute|download|生成(?:新的)?(?:报告|表格|图|文件|产物)|下载|执行|运行)/i.test(text);
  if (!matched) return undefined;
  if (/(checklist|bullet|清单|列表)/i.test(text)) return 'answer-only-checklist';
  if (/(compress|condense|shorten|压缩|浓缩)/i.test(text)) return 'answer-only-compress';
  return 'answer-only-summary';
}

function selectedReferenceSummaryMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const text = request.prompt;
  const selectedRefs = selectedReferenceTokens(request);
  if (!selectedRefs.length) return undefined;
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const answerContext = selectedContext.filter((item) => !/claim|execution-unit|audit|diagnostic/i.test(item.kind));
  const snippets = directContextStatements(answerContext.length ? answerContext : selectedContext)
    .slice(0, /three|3|三/.test(text) ? 3 : /two|2|两|二/.test(text) ? 2 : 5);
  if (!snippets.length) return undefined;
  const header = /[一-龥]/.test(text)
    ? '基于当前选中引用整理为要点：'
    : 'Summary from the selected reference:';
  return [header, ...snippets.map((item) => `- ${item}`)].join('\n');
}

function directContextStatements(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  options: { answerOnlyTransform?: boolean } = {},
) {
  return uniqueStrings(context.flatMap((item) => statementParts(item.summary)))
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((part) => options.answerOnlyTransform
      ? isDirectContextAnswerStatement(part)
      : part.length > 0 && !/^(fields|refs?|artifact|run|message):/i.test(part));
}

function statementParts(value: string | undefined) {
  if (!value) return [];
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Answered directly from current-session context without starting a new workspace task\.|基于当前会话已有上下文直接回答，不启动新的 workspace task。)/gi, '')
    .trim();
  return normalized
    .split(/(?<=[。.!?；;])\s+|[\n\r]+|(?:\s+-\s+)/)
    .map((part) => part.trim().replace(/[。.!?；;]+$/, ''))
    .filter((part) => part.length > 0 && part.length <= 260)
    .slice(0, 8);
}

function isDirectContextAnswerStatement(part: string) {
  if (!part) return false;
  if (/^(fields|refs?|artifact|run|message):/i.test(part)) return false;
  if (/Reference path was not readable inside the workspace|Reference exists but is not a regular file/i.test(part)) return false;
  if (/selected artifact content was not available|no refs found|no explicit blockers found|no explicit recover actions found/i.test(part)) return false;
  if (/^record-only$/i.test(part)) return false;
  if (/^(?:artifact|file|run|execution-unit|agentserver|runtime):/i.test(part)) return false;
  if (/^(?:\.sciforge|workspace\/|\/Applications\/|[A-Za-z]:[\\/]|~\/)/.test(part)) return false;
  if (/\.(?:json|md|txt|csv|tsv|log|py|ts|tsx|js|ipynb)(?:\b|$)/i.test(part) && !/\s/.test(part.replace(/[()[\],;:]/g, ''))) return false;
  return true;
}

function selectedReferenceTokens(request: GatewayRequest) {
  return uniqueStrings(recordRows(request.references).flatMap((reference) => {
    const ref = stringField(reference.ref);
    const sourceId = stringField(reference.sourceId);
    const title = stringField(reference.title);
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    return [
      ref,
      sourceId,
      title,
      stringField(currentReference.ref),
      stringField(currentReference.id),
      stringField(currentReference.title),
      stringField(objectReference.ref),
      stringField(objectReference.id),
      stringField(objectReference.title),
    ].flatMap((value) => value ? selectedReferenceTokenVariants(value) : []);
  }));
}

function selectedReferenceTokenVariants(value: string) {
  const text = value.trim();
  if (!text) return [];
  const withoutScheme = text.replace(/^(?:artifact|file|message|claim|execution-unit):/, '');
  const basename = withoutScheme.split(/[\\/]/).pop() ?? withoutScheme;
  return uniqueStrings([text, withoutScheme, basename.replace(/\.[a-z0-9]+$/i, '')]);
}

function directContextItemMatchesSelectedRef(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
  selectedRefs: string[],
) {
  const haystack = [
    item.ref,
    item.label,
  ].filter((value): value is string => Boolean(value)).join('\n').toLowerCase();
  if (!haystack) return false;
  return selectedRefs.some((ref) => ref && haystack.includes(ref.toLowerCase()));
}

function directContextClaimText(
  message: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const statement = statementParts(message)
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .find(isDirectContextAnswerStatement);
  return statement ?? context.find((item) => isDirectContextAnswerStatement(item.summary ?? ''))?.summary ?? DIRECT_CONTEXT_FAST_PATH_POLICY.defaultClaimText;
}

function intentSummaryAnswer(
  intent: DirectContextIntent,
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (intent !== 'context-summary:risk' && intent !== 'context-summary:method' && intent !== 'context-summary:timeline') return undefined;
  const sentences = uniqueStrings(context.flatMap((item) => contextSummarySentencesFromText(item.summary, intent)));
  if (!sentences.length) return undefined;
  const selected = sentences.slice(0, /two|2|两|二/.test(prompt) ? 2 : 3);
  if (/[一-龥]/.test(prompt)) {
    return `基于当前会话已有上下文直接回答，不启动新的 workspace task。${selected.join('；')}。`;
  }
  return `Answered directly from current-session context without starting a new workspace task. ${selected.join('; ')}.`;
}

function contextSummarySentencesFromText(value: string | undefined, intent: DirectContextIntent) {
  if (!value) return [];
  const pattern = intent === 'context-summary:risk'
    ? /(risk|风险|隐患|问题|漂移|溢出|不一致|失败|超时|缺失|阻塞)/i
    : intent === 'context-summary:method'
      ? /(method|methods|workflow|protocol|approach|procedure|步骤|方法|流程|方案|实验|检索|分析)/i
      : /(timeline|sequence|history|progress|phase|event|when|时间线|顺序|阶段|进展|事件)/i;
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[。.!?；;])\s+|[\n\r]+/)
    .map((part) => part.trim().replace(/^[#*\-\d.\s:：]+/, '').replace(/[。.!?；;]+$/, ''))
    .filter((part) => pattern.test(part))
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
