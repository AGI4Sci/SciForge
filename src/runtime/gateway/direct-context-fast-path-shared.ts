import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { runtimeResultViewSlotsPolicy } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy.js';
import {
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  buildDirectContextFastPathItems,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
} from '@sciforge-ui/runtime-contract/artifact-policy';
import {
  capabilityProviderStatusClaimText,
  capabilityProviderStatusFastPathMessage,
  capabilityProviderStatusReasoningTrace,
  capabilityProviderStatusRouteRef,
  capabilityProviderStatusRouteSummaryLines,
} from '@sciforge-ui/runtime-contract';
import {
  directContextBoundedArtifactIntent,
  directContextBoundedArtifactTransformMode,
  directContextIntentSummaryLimit,
  directContextPromptRequestsFreshExternalWork,
  directContextTextWantsChinese,
} from '@sciforge-ui/runtime-contract/direct-context-followup-policy';
import { capabilityProviderRoutesForHandoff } from './capability-provider-preflight.js';

export type DirectContextIntent =
  | 'context-summary'
  | 'context-summary:risk'
  | 'context-summary:method'
  | 'context-summary:timeline'
  | 'run-diagnostic'
  | 'artifact-status'
  | 'capability-status'
  | 'fresh-execution'
  | 'unknown';

export type DirectContextTransformMode =
  | 'answer-only-compress'
  | 'answer-only-summary'
  | 'answer-only-checklist'
  | 'answer-only-planning-register'
  | 'answer-only-document'
  | 'none';

export interface DirectContextDecision {
  decisionRef: string;
  decisionOwner: 'agentserver' | 'backend' | 'harness-policy';
  intent: DirectContextIntent;
  requiredTypedContext: string[];
  usedRefs: string[];
  allowDirectContext?: boolean;
  transformMode?: DirectContextTransformMode;
  sufficiency: 'sufficient' | 'insufficient';
  blockReason?: string;
  semanticSignal?: {
    schemaVersion: 'sciforge.direct-context.semantic-signal.v1';
    signal: 'refs-backed-bounded-artifact-followup';
    refsFirstEvidence: boolean;
    lexicalFeatures: string[];
    confidence: 'low' | 'medium';
  };
}

function directContextUiManifest(primaryArtifactRef: string, primaryArtifactType: string) {
  return runtimeResultViewSlotsPolicy({
    primaryArtifactRef,
    primaryArtifactType,
    runtimeResultRef: DIRECT_CONTEXT_FAST_PATH_POLICY.uiRoute,
  });
}

export function promptNamedDirectContextItems(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = normalizeDirectContextMentionText(request.prompt);
  if (!prompt) return [];
  const directMatches = context.filter((item) => directContextItemMatchesPromptMention(item, prompt));
  if (!directMatches.length) return [];
  return expandPromptNamedDirectContextItems(directMatches, context);
}

function directContextItemMatchesPromptMention(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
  normalizedPrompt: string,
) {
  return directContextPromptMentionCandidates(item)
    .some((candidate) => normalizedPrompt.includes(candidate));
}

function directContextPromptMentionCandidates(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
) {
  return uniqueStrings([
    item.ref,
    item.label,
  ].filter((value): value is string => Boolean(value))
    .flatMap((value) => selectedReferenceTokenVariants(value))
    .map(normalizeDirectContextMentionText)
    .filter(isStrongDirectContextMentionCandidate));
}

function expandPromptNamedDirectContextItems(
  directMatches: ReturnType<typeof buildDirectContextFastPathItems>,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const directSet = new Set(directMatches);
  const expansionTokens = uniqueStrings(directMatches
    .flatMap(directContextPromptMentionExpansionCandidates));
  if (!expansionTokens.length) return directMatches;
  const expanded = context.filter((item) => {
    if (directSet.has(item)) return true;
    const itemTokens = directContextPromptMentionExpansionCandidates(item);
    return itemTokens.some((token) => expansionTokens.includes(token));
  });
  return expanded.length ? expanded : directMatches;
}

function directContextPromptMentionExpansionCandidates(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
) {
  return uniqueStrings([
    item.ref,
    item.label,
  ].filter((value): value is string => Boolean(value))
    .flatMap((value) => selectedReferenceTokenVariants(value)
      .flatMap((variant) => [variant, ...directContextMentionSuffixVariants(variant)]))
    .map(normalizeDirectContextMentionText)
    .filter(isExpansionDirectContextMentionCandidate));
}

function directContextMentionSuffixVariants(value: string) {
  const basename = value.trim().split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  const parts = basename.split(/[-_]+/).filter(Boolean);
  if (parts.length < 2) return [];
  return uniqueStrings([
    parts.slice(-2).join('-'),
    parts.slice(-3).join('-'),
  ].filter((item) => item.length >= 8));
}

export function normalizeDirectContextMentionText(value: string) {
  let text = value.trim().toLowerCase();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the original string when it is not URI-encoded.
  }
  return text
    .replace(/[`'"“”‘’<>()[\],;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongDirectContextMentionCandidate(value: string) {
  if (value.length < 8) return false;
  if (/^(?:report|research-report|reproduction-report|runtime-context-summary|selected|current|artifact|file)$/i.test(value)) return false;
  return /[._/-]/.test(value);
}

function isExpansionDirectContextMentionCandidate(value: string) {
  if (value.length < 8) return false;
  if (/^(?:report|research-report|runtime-context-summary|selected|current|artifact|file)$/i.test(value)) return false;
  return /[._/-]/.test(value);
}

export function promptMentionedFileTitle(text: string) {
  const match = text.match(/(?:^|[\s`'"“”])([A-Za-z0-9._/-]+\.(?:md|markdown|txt|json|csv|tsv|py|ipynb))(?:$|[\s`'"“”，,。；;：:])/i);
  return match?.[1]?.split(/[\\/]/).pop();
}

export function selectedReferenceSummaryMessage(
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

export function directContextStatements(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  options: { answerOnlyTransform?: boolean } = {},
) {
  return uniqueStrings(context.flatMap((item) => statementParts(item.summary)))
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((part) => options.answerOnlyTransform
      ? isDirectContextAnswerStatement(part)
      : part.length > 0 && !/^(fields|refs?|artifact|run|message):/i.test(part));
}

export function statementParts(value: string | undefined) {
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

export function isDirectContextAnswerStatement(part: string) {
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

export function selectedReferenceTokens(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([...recordRows(request.references), ...recordRows(uiState.currentReferences)].flatMap((reference) => {
    const ref = stringField(reference.ref);
    const sourceId = stringField(reference.sourceId);
    const title = stringField(reference.title);
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const provenance = isRecord(payload.provenance) ? payload.provenance : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const currentProvenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    const objectProvenance = isRecord(objectReference.provenance) ? objectReference.provenance : {};
    return [
      ref,
      sourceId,
      title,
      stringField(reference.dataRef),
      stringField(reference.path),
      stringField(payload.dataRef),
      stringField(payload.path),
      stringField(provenance.dataRef),
      stringField(provenance.path),
      stringField(currentReference.ref),
      stringField(currentReference.id),
      stringField(currentReference.title),
      stringField(currentReference.dataRef),
      stringField(currentReference.path),
      stringField(currentProvenance.dataRef),
      stringField(currentProvenance.path),
      stringField(objectReference.ref),
      stringField(objectReference.id),
      stringField(objectReference.title),
      stringField(objectReference.dataRef),
      stringField(objectReference.path),
      stringField(objectProvenance.dataRef),
      stringField(objectProvenance.path),
    ].flatMap((value) => value ? selectedReferenceTokenVariants(value) : []);
  }));
}

export function selectedDurableReferenceTokens(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([...recordRows(request.references), ...recordRows(uiState.currentReferences)].flatMap((reference) => {
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const provenance = isRecord(payload.provenance) ? payload.provenance : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const currentProvenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    const objectProvenance = isRecord(objectReference.provenance) ? objectReference.provenance : {};
    return [
      stringField(reference.dataRef),
      stringField(reference.path),
      stringField(payload.dataRef),
      stringField(payload.path),
      stringField(provenance.dataRef),
      stringField(provenance.path),
      stringField(currentReference.dataRef),
      stringField(currentReference.path),
      stringField(currentProvenance.dataRef),
      stringField(currentProvenance.path),
      stringField(objectReference.dataRef),
      stringField(objectReference.path),
      stringField(objectProvenance.dataRef),
      stringField(objectProvenance.path),
    ]
      .filter(isDirectContextReadableTextRef)
      .flatMap((value) => uniqueStrings([value, value.replace(/^(?:file|artifact)::?/i, '')]));
  }));
}

function isDirectContextReadableTextRef(value: string | undefined): value is string {
  return typeof value === 'string'
    && /\.(?:md|markdown|txt|csv|tsv|json|py|ipynb)(?:$|[?#])/i.test(value)
    && !/^(?:artifact|run|execution-unit|claim|runtime):/i.test(value);
}

export function selectedReferenceTokenVariants(value: string) {
  const text = value.trim();
  if (!text) return [];
  const withoutScheme = text.replace(/^(?:artifact|file|message|claim|execution-unit):/, '');
  const basename = withoutScheme.split(/[\\/]/).pop() ?? withoutScheme;
  return uniqueStrings([text, withoutScheme, basename.replace(/\.[a-z0-9]+$/i, '')]);
}

export function directContextItemMatchesSelectedRef(
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

export function directContextClaimText(
  message: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const statement = statementParts(message)
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .find(isDirectContextAnswerStatement);
  return statement ?? context.find((item) => isDirectContextAnswerStatement(item.summary ?? ''))?.summary ?? DIRECT_CONTEXT_FAST_PATH_POLICY.defaultClaimText;
}

export function intentSummaryAnswer(
  intent: DirectContextIntent,
  prompt: string,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  if (intent !== 'context-summary:risk' && intent !== 'context-summary:method' && intent !== 'context-summary:timeline') return undefined;
  const sentences = uniqueStrings(context.flatMap((item) => contextSummarySentencesFromText(item.summary, intent)));
  if (!sentences.length) return undefined;
  const selected = sentences.slice(0, directContextIntentSummaryLimit(prompt));
  if (directContextTextWantsChinese(prompt)) {
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

export function hasUsableArtifactRefOrData(artifact: Record<string, unknown>) {
  if (stringField(artifact.dataRef) || stringField(artifact.path) || stringField(artifact.ref)) return true;
  const metadata = artifact.metadata;
  if (isRecord(metadata)) {
    const metadataRefs = ['reportRef', 'markdownRef', 'dataRef', 'path', 'outputRef']
      .some((key) => stringField(metadata[key]));
    if (metadataRefs) return true;
  }
  return artifact.data !== undefined;
}

export function hasCurrentContextEvidence(
  context: ReturnType<typeof buildDirectContextFastPathItems>,
  intent: DirectContextIntent,
) {
  if (intent === 'run-diagnostic') return context.some((item) => item.ref);
  return context.some((item) => item.kind !== 'execution-unit');
}

export function capabilityStatusFastPathPayload(request: GatewayRequest): ToolPayload | undefined {
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
  const contextMessage = context.length
    ? `\n\nCurrent context summary:\n${directContextFastPathMessage(context)}`
    : '';
  const message = capabilityProviderStatusFastPathMessage({
    routes: routeStatus.routes,
    selectedIds,
    contextMessage,
  });
  const routeRef = capabilityProviderStatusRouteRef(id);
  return {
    message,
    confidence: 0.86,
    claimType: 'capability-provider-status',
    evidenceLevel: 'runtime',
    reasoningTrace: capabilityProviderStatusReasoningTrace(),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
    claims: [{
      id: `capability-provider-status-${id}`,
      text: capabilityProviderStatusClaimText(routeStatus.ok),
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
      summary: capabilityProviderStatusRouteSummaryLines(routeStatus.routes).join(' '),
    }],
  };
}

export function policyRequestsDirectContext(request: GatewayRequest, decision: DirectContextDecision) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (uiState.forceAgentServerGeneration === true) return false;
  if (!directContextDecisionAllowsAnswer(decision)) return false;
  if (decision.decisionOwner === 'harness-policy' && boundedArtifactFollowupRequested(request)) return true;
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

export function fallbackDirectContextDecisionForBoundedArtifactFollowup(request: GatewayRequest): DirectContextDecision | undefined {
  if (!boundedArtifactFollowupRequested(request)) return undefined;
  const records = boundedFollowupRecords(request);
  const selectedRefs = selectedReferenceTokens(request);
  const scopedRecords = explicitSelectedOnlyPrompt(request.prompt) && selectedRefs.length
    ? records.filter((record) => directContextRecordMatchesSelectedRef(record, selectedRefs))
    : records;
  const refs = uniqueStrings(scopedRecords.flatMap((artifact) => directContextRefTokensFromRecord(artifact)));
  if (!refs.length) return undefined;
  const forbidsFreshWork = boundedArtifactFollowupForbidsFreshWork(request.prompt);
  const explicitSelectedOnly = explicitSelectedOnlyPrompt(request.prompt);
  return {
    decisionRef: `decision:harness-bounded-artifact-${sha1(JSON.stringify({ prompt: request.prompt, refs })).slice(0, 10)}`,
    decisionOwner: 'harness-policy',
    intent: directContextBoundedArtifactIntent(request.prompt),
    requiredTypedContext: ['current-session-context', 'artifact-index'],
    usedRefs: refs.slice(0, 8),
    allowDirectContext: true,
    transformMode: directContextBoundedArtifactTransformMode(request.prompt),
    sufficiency: 'sufficient',
    semanticSignal: {
      schemaVersion: 'sciforge.direct-context.semantic-signal.v1',
      signal: 'refs-backed-bounded-artifact-followup',
      refsFirstEvidence: true,
      lexicalFeatures: [
        'bounded-artifact-followup',
        ...(forbidsFreshWork ? ['forbids-fresh-work'] : []),
        ...(explicitSelectedOnly ? ['explicit-selected-only'] : []),
      ],
      confidence: forbidsFreshWork || explicitSelectedOnly ? 'medium' : 'low',
    },
  };
}

export function boundedArtifactFollowupRequested(request: GatewayRequest) {
  if (!boundedArtifactFollowupPrompt(request.prompt)) return false;
  const hasArtifact = boundedFollowupRecords(request)
    .some(isBoundedAnswerArtifact);
  return hasArtifact;
}

export function boundedArtifactFollowupPrompt(text: string) {
  if (directContextPromptRequestsFreshExternalWork(text)) return false;
  if (artifactMutationFollowupRequiresBackend(text)) return false;
  const refersToSelectedOrCurrent = /(current|visible|selected|above|artifact|matrix|report|this report|this artifact|reproduction|当前|选中|刚才|刚刚|证据矩阵|报告|产物|这份|这个|该报告|本报告|原报告)/i.test(text);
  const refersToBroadHistory = /(previous|prior|last|existing|上一轮|之前|已有)/i.test(text);
  const forbidsFreshWork = /(based only|only based|use only|only use|using only|do not perform a new search|do not rerun|no new search|without starting|不要重新|不重新|只基于|仅基于|只用|仅用)/i.test(text);
  const asksReadOnlyQuestion = /(what|which|whether|can|does|how|should|would|recommend|tell me|list|audit|check|pass|fail|threshold|support|prove|rerun|command|script|counterfactual|summari[sz]e|conclusions?|bullet|points?|是否|哪些|什么|有没有|能否|如何|怎么|怎样|应该|建议|请列出|回答|审计|核对|检查|验收|门槛|阈值|支持|证明|复跑|命令|脚本|反事实|总结|结论|要点|指出|列出)/i.test(text);
  return (refersToSelectedOrCurrent && (forbidsFreshWork || asksReadOnlyQuestion))
    || (refersToBroadHistory && forbidsFreshWork);
}

export function boundedArtifactFollowupForbidsFreshWork(text: string) {
  return /(based only|only based|use only|only use|using only|do not perform a new search|do not start a new search|do not run a new search|do not rerun|no new search|without starting|without running|不要重新|不重新|不要启动|不启动|不要运行|不运行|只基于|仅基于|只用|仅用)/i.test(text);
}

export function explicitSelectedOnlyPrompt(text: string) {
  return /(?:use only|only use|using only|based only|only based|selected .* only|current .* only|reference .* only|artifact .* only|file .* only|report .* only|只基于|仅基于|只用|仅用|只看|仅看)/i.test(text)
    && /(selected|current|reference|artifact|file|report|chart|plot|figure|image|选中|当前|引用|产物|文件|报告|图表|图片)/i.test(text);
}

export function boundedFollowupRecords(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return [
    ...request.artifacts,
    ...recordRows(uiState.artifacts),
    ...recordRows(request.references),
    ...recordRows(uiState.currentReferences),
    ...recordRows(uiState.currentReferenceDigests),
    ...contextProjectionReferenceRecords(uiState.contextProjection),
  ].filter(isRecord);
}

function contextProjectionReferenceRecords(value: unknown) {
  if (!isRecord(value)) return [];
  const selected = toStringList(value.selectedContextRefs)
    .map((ref) => ({ ref, id: ref, title: ref, artifactType: artifactTypeFromRef(ref) }));
  const contextRefs = recordRows(value.contextRefs).map((entry) => {
    const ref = stringField(entry.ref);
    return {
      ...entry,
      id: stringField(entry.id) ?? ref,
      title: stringField(entry.title) ?? ref,
      artifactType: stringField(entry.artifactType) ?? artifactTypeFromRef(ref),
      type: stringField(entry.type) ?? artifactTypeFromRef(ref),
    };
  });
  return [...selected, ...contextRefs];
}

function artifactTypeFromRef(ref: string | undefined) {
  if (!ref) return undefined;
  if (/evidence[-_\s]?matrix/i.test(ref)) return 'evidence-matrix';
  if (/paper[-_\s]?list/i.test(ref)) return 'paper-list';
  if (/notebook[-_\s]?timeline/i.test(ref)) return 'notebook-timeline';
  if (/research[-_\s]?report|report\.(?:md|markdown|txt)$/i.test(ref)) return 'research-report';
  if (/\.(?:md|markdown|txt)$/i.test(ref)) return 'document';
  if (/\.(?:json|csv|tsv)$/i.test(ref)) return 'dataset';
  return undefined;
}

function directContextRefTokensFromRecord(record: Record<string, unknown>) {
  const payload = isRecord(record.payload) ? record.payload : {};
  const provenance = isRecord(payload.provenance) ? payload.provenance : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const currentProvenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const objectProvenance = isRecord(objectReference.provenance) ? objectReference.provenance : {};
  const id = stringField(record.id) ?? stringField(currentReference.id) ?? stringField(objectReference.id);
  const dataRef = stringField(record.dataRef)
    ?? stringField(record.path)
    ?? stringField(record.sourceRef)
    ?? stringField(record.ref)
    ?? stringField(payload.dataRef)
    ?? stringField(payload.path)
    ?? stringField(provenance.dataRef)
    ?? stringField(provenance.path)
    ?? stringField(currentReference.dataRef)
    ?? stringField(currentReference.path)
    ?? stringField(currentProvenance.dataRef)
    ?? stringField(currentProvenance.path)
    ?? stringField(currentReference.ref)
    ?? stringField(objectReference.dataRef)
    ?? stringField(objectReference.path)
    ?? stringField(objectProvenance.dataRef)
    ?? stringField(objectProvenance.path)
    ?? stringField(objectReference.ref);
  const type = stringField(record.type)
    ?? stringField(record.artifactType)
    ?? stringField(currentReference.type)
    ?? stringField(currentReference.artifactType)
    ?? stringField(objectReference.type)
    ?? stringField(objectReference.artifactType);
  return [
    id ? `artifact:${id.replace(/^artifact:/, '')}` : undefined,
    dataRef,
    type ? `artifact-type:${type}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function directContextRecordMatchesSelectedRef(record: Record<string, unknown>, selectedRefs: string[]) {
  const haystack = directContextRefTokensFromRecord(record)
    .flatMap((token) => selectedReferenceTokenVariants(token))
    .join('\n')
    .toLowerCase();
  if (!haystack) return false;
  return selectedRefs.some((ref) => ref && haystack.includes(ref.toLowerCase()));
}

export function artifactMutationFollowupRequiresBackend(text: string) {
  if (explicitAnswerOnlyNoToolsRequested(text)) return false;
  if (explicitReadOnlyNoMutationRequested(text)) return false;
  if (readOnlyArtifactInfoRequested(text)) return false;
  if (readOnlyHypotheticalArtifactRevisionRequested(text)) return false;
  const refersToExistingContext = /(previous|prior|last|existing|current|visible|selected|above|artifact|matrix|report|deliverable|document|file|workspace|上一轮|之前|已有|当前|选中|证据矩阵|报告|产物|交付物|文档|文件)/i.test(text);
  const asksForMutation = /(update|revise|rewrite|regenerate|edit|modify|refresh|replace|supersede|overwrite|write|persist|save|produce|更新|修订|重写|改写|修改|替换|覆盖|写入|写回|保存|产出|重新生成)/i.test(text);
  const deliverableScope = /(artifact|file|document|deliverable|workspace|path|\.md|decision log|risk register|timeline|budget|scope|success metrics|artifact\/file|产物|交付物|文档|文件|路径|决策日志|风险登记|时间线|预算|成功指标|所有受影响结论)/i.test(text);
  const asksForPaths = /(artifact\/file path|artifact path|file path|workspace file|updated artifact|new file|路径|更新后的 artifact|新的 artifact|新文件|文件路径)/i.test(text);
  return refersToExistingContext && ((asksForMutation && deliverableScope) || asksForPaths);
}

function explicitReadOnlyNoMutationRequested(text: string) {
  return /(?:read[-\s]?only|only read|inspect only|do not (?:rewrite|write|modify|edit|save)|don't (?:rewrite|write|modify|edit|save)|no changes)|只读|只检查|不要(?:重写|写入|写回|覆盖|保存|修改|更新)|不(?:要)?(?:重写|写入|写回|覆盖|保存|修改|更新)/i.test(text);
}

function readOnlyArtifactInfoRequested(text: string) {
  return /(whether|does|what|which|list|audit|check|do not invent|not invent|是否|有没有|哪些|只列出|不要补造|审计|核对|检查|复跑性)/i.test(text)
    && /(rerun command|run command|script path|artifact path|file path|路径|命令|脚本路径)/i.test(text)
    && !/(update|revise|rewrite|regenerate|edit|modify|refresh|replace|overwrite|write|persist|save|produce|更新|修订|重写|改写|修改|替换|覆盖|写入|写回|保存|产出|重新生成)/i.test(text);
}

function readOnlyHypotheticalArtifactRevisionRequested(text: string) {
  const asksRecommendation = /(how should|how would|what should|what would|should (?:we|i)|recommend|recommendation|建议|应该如何|应如何|如何(?:修改|调整|改)|怎么(?:修改|调整|改)|怎样(?:修改|调整|改)|如果|预算降到)/i.test(text);
  const anchorsExistingArtifact = /(current|selected|existing|previous|prior|artifact|report|protocol|当前|选中|已有|之前|产物|报告|方案)/i.test(text);
  const asksAnswerOnly = /(answer|tell me|explain|基于|回答|说明|标明|继续标明|建议)/i.test(text);
  const asksDurableWrite = /(write(?:\s+the)? file|persist|save|overwrite|updated artifact|new artifact|artifact path|file path|生成(?:新的)?(?:报告|文件|产物)|覆盖|写入|写回|保存|产出|文件路径|新的 artifact|更新后的 artifact)/i.test(text);
  return asksRecommendation && anchorsExistingArtifact && asksAnswerOnly && !asksDurableWrite;
}

function explicitAnswerOnlyNoToolsRequested(text: string) {
  if (/(do not only answer|don't only answer|not only answer|not just answer|不要只回答|不要仅回答|不能只回答|不只是回答|不要只给(?:出)?(?:聊天)?(?:摘要|回答)?)/i.test(text)) {
    return false;
  }
  return /(answer-only|no tools|do not run tools|without starting|不要启动新的 workspace task|不要运行工具|不启动工具|只回答|仅回答)/i.test(text);
}

export function isBoundedAnswerArtifact(value: unknown) {
  if (!isRecord(value)) return false;
  const payload = isRecord(value.payload) ? value.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const type = [
    stringField(value.type),
    stringField(value.artifactType),
    stringField(value.id),
    stringField(value.kind),
    stringField(value.ref),
    stringField(value.title),
    stringField(value.dataRef),
    stringField(value.path),
    stringField(currentReference.artifactType),
    stringField(currentReference.ref),
    stringField(currentReference.title),
    stringField(objectReference.artifactType),
    stringField(objectReference.ref),
    stringField(objectReference.title),
  ].filter(Boolean).join(' ');
  if (/runtime-diagnostic|diagnostic|stderr|stdout|log|failure|error/i.test(type)) return false;
  if (!/(evidence[-\s_]?matrix|research-report|report|paper-list|analysis|document|summary|table|dataset|csv|notebook|script|chart|plot|figure|image|png|jpe?g|webp|svg|图表|图片)/i.test(type)) return false;
  return Boolean(
    stringField(value.id)
    || stringField(value.ref)
    || stringField(value.dataRef)
    || stringField(value.path)
    || stringField(value.sourceRef)
    || stringField(currentReference.ref)
    || stringField(objectReference.ref)
    || value.data !== undefined,
  );
}

export function directContextDecisionAllowsAnswer(decision: DirectContextDecision) {
  // Final direct-context allow truth must come from structured decision semantics and refs,
  // not lexical feature detectors that only hint at intent.
  const harnessSemanticSignalOk = decision.decisionOwner !== 'harness-policy'
    || (decision.semanticSignal?.schemaVersion === 'sciforge.direct-context.semantic-signal.v1'
      && decision.semanticSignal.refsFirstEvidence === true);
  return decision.allowDirectContext === true
    && decision.sufficiency === 'sufficient'
    && Boolean(decision.decisionRef)
    && decision.requiredTypedContext.length > 0
    && decision.usedRefs.length > 0
    && harnessSemanticSignalOk;
}

export function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
