import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../artifactIntent';
import { normalizeAgentResponse } from './agentClient';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, buildSharedAgentHandoffContract } from '../../../shared/agentHandoff';
import { buildAgentHandoffPayload } from '../../../shared/agentHandoffPayload';
import {
  contextWindowTelemetryEvent,
  normalizeWorkspaceRuntimeEvent,
  readWorkspaceToolStream,
  toolEvent,
  withConfiguredContextWindowLimit,
  workspaceResultCompletion,
} from './sciforgeToolsClient/runtimeEvents';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

export async function sendSciForgeToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const rawArtifactSummary = summarizeArtifacts(input);
  const referenceSummary = summarizeSciForgeReferences(input);
  const rawRecentExecutionRefs = summarizeExecutionRefs(input);
  const contextPolicy = currentTurnContextPolicy(input, rawArtifactSummary, rawRecentExecutionRefs);
  const artifactSummary = contextPolicy.isolated ? [] : rawArtifactSummary;
  const recentExecutionRefs = contextPolicy.isolated ? [] : rawRecentExecutionRefs;
  const recentConversation = contextPolicy.isolated
    ? [`user: ${input.prompt}`]
    : currentTurnConversation(input, artifactSummary, recentExecutionRefs);
  const skillDomain = input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain;
  const configuredComponentIds = input.availableComponentIds?.length
    ? input.availableComponentIds
    : (input.scenarioOverride?.defaultComponents?.length
      ? input.scenarioOverride.defaultComponents
      : SCENARIO_SPECS[builtInScenarioId].componentPolicy.defaultComponents);
  const selectedComponentIds = selectedComponentsForCurrentTurn(input.prompt, configuredComponentIds);
  const selectedSkillIds = selectedRuntimeSkillIds(input, skillDomain);
  const selectedToolIds = selectedRuntimeToolIds(input);
  const selectedToolContracts = selectedRuntimeToolContracts(selectedToolIds);
  const expectedArtifactTypes = expectedArtifactsForCurrentTurn({
    scenarioId: builtInScenarioId,
    prompt: input.prompt,
    selectedComponentIds,
  });
  const artifactAccessPolicy = buildArtifactAccessPolicy(input, artifactSummary, recentExecutionRefs);
  const priorFailure = hasPriorFailure(artifactSummary, recentExecutionRefs);
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, input.config.requestTimeoutMs || DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
  const linkedAbort = () => requestController.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  let lastRealEventAt = Date.now();
  const silenceWatchdog = globalThis.setInterval(() => {
    const seconds = Math.round((Date.now() - lastRealEventAt) / 1000);
    if (seconds < 20) return;
    callbacks.onEvent?.(toolEvent('backend-silent', `后端 ${seconds}s 没有输出新事件；HTTP stream 仍在等待 ${input.config.agentBackend || 'codex'} 返回。`));
    lastRealEventAt = Date.now();
  }, 10_000);
  try {
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：发送用户原始请求到 AgentServer/workspace runtime，由后台判断回答、生成、修复或执行；UI 仅附带本轮显式 artifacts=${expectedArtifactTypes.join(', ') || 'backend-decides'}`));
    callbacks.onEvent?.(toolEvent(
      'context-loaded',
      contextPolicy.isolated
        ? `已隔离历史上下文：${contextPolicy.reason}。本轮只发送用户原始请求和显式引用。`
        : artifactSummary.length || recentExecutionRefs.length
        ? `读取上一轮上下文：artifacts=${artifactSummary.length}, refs=${recentExecutionRefs.length}`
        : '当前轮没有可复用 artifact/ref，上下文从场景目标和对话开始。',
    ));
    if (!contextPolicy.isolated && artifactSummary.length) {
      callbacks.onEvent?.(toolEvent(
        'context-access-policy',
        `artifact 访问策略：默认复用 refs/summary；需要核实时只读取 bounded excerpt，不全量回放大 artifact。`,
      ));
    }
    if (priorFailure) {
      callbacks.onEvent?.(toolEvent('repair-start', `正在修复：已发现上一轮 failureReason=${priorFailure}`));
    }
    callbacks.onEvent?.(toolEvent('project-tool-start', `SciForge ${builtInScenarioId} project tool started`));
    const sharedAgentContract = buildSharedAgentHandoffContract('ui-chat');
    const selectedSenseIds = selectedRuntimeSenseIds(input, selectedToolIds);
    const selectedActionIds = selectedRuntimeActionIds(input);
    const selectedVerifierIds = selectedRuntimeVerifierIds(input);
    const verificationPolicy = buildVerificationPolicy(input);
    const humanApprovalPolicy = buildHumanApprovalPolicy(input, selectedActionIds);
    const failureRecoveryPolicy = buildFailureRecoveryPolicy(priorFailure);
    const targetInstanceContext = compactTargetInstanceContext(input);
    const repairHandoffRunner = buildRepairHandoffRunnerPayload(input);
    const requestBody = buildAgentHandoffPayload({
      scenarioId: builtInScenarioId,
      handoffSource: 'ui-chat',
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      skillDomain,
      agentBackend: input.config.agentBackend,
      prompt: input.prompt,
      workspacePath: input.config.workspacePath,
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      modelProvider: input.config.modelProvider,
      modelName: input.config.modelName,
      maxContextWindowTokens: input.config.maxContextWindowTokens,
      llmEndpoint: buildToolLlmEndpoint(input),
      roleView: input.roleView,
      artifacts: artifactSummary,
      references: referenceSummary,
      availableSkills: selectedSkillIds,
      selectedToolIds,
      selectedToolContracts,
      selectedSenseIds,
      selectedActionIds,
      selectedVerifierIds,
      expectedArtifactTypes,
      selectedComponentIds,
      availableComponentIds: configuredComponentIds,
      artifactPolicy: artifactAccessPolicy,
      referencePolicy: buildReferencePolicy(referenceSummary),
      failureRecoveryPolicy,
      verificationPolicy,
      humanApprovalPolicy,
      unverifiedReason: verificationPolicy.mode === 'unverified' ? verificationPolicy.unverifiedReason : undefined,
      verificationResult: input.verificationResult,
      recentVerificationResults: input.recentVerificationResults,
      uiState: {
        sessionId: input.sessionId,
        scopeCheck: {
          source: sharedAgentContract.source,
          decisionOwner: 'AgentServer',
          dispatchPolicy: sharedAgentContract.dispatchPolicy,
          answerPolicy: sharedAgentContract.answerPolicy,
          note: 'SciForge does not route or reject current-turn intent by keyword; AgentServer decides from rawUserPrompt and context.',
        },
        scenarioOverride: input.scenarioOverride,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        currentPrompt: input.prompt,
        maxContextWindowTokens: input.config.maxContextWindowTokens,
        recentConversation,
        conversationLedger: buildConversationLedger(input, contextPolicy.isolated),
        contextReusePolicy: buildContextReusePolicy(input, recentConversation),
        artifactAccessPolicy,
        currentReferences: referenceSummary,
        targetInstance: targetInstanceContext,
        targetInstanceContext,
        repairHandoffRunner,
        recentExecutionRefs,
        recentRuns: contextPolicy.isolated ? [] : summarizeRuns(input),
        workspacePersistence: workspacePersistenceSummary(input),
        artifactExpectationMode: expectedArtifactTypes.length ? 'explicit-current-turn' : 'backend-decides',
        rawUserPrompt: input.prompt,
        contextIsolation: contextPolicy,
        agentDispatchPolicy: 'agentserver-decides',
      },
      agentContext: buildAgentContext(input, recentConversation, artifactSummary, recentExecutionRefs, configuredComponentIds, artifactAccessPolicy, selectedToolContracts, contextPolicy.isolated, repairHandoffRunner),
    });
    const requestBodyText = JSON.stringify(requestBody);
    callbacks.onEvent?.(contextWindowTelemetryEvent(
      input,
      requestBodyText,
      'AgentServer handoff preflight estimate',
    ));
    const response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/sciforge/tools/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBodyText,
      signal: requestController.signal,
    });
  const { result, error } = await readWorkspaceToolStream(response, (event) => {
    lastRealEventAt = Date.now();
    callbacks.onEvent?.(withConfiguredContextWindowLimit(
      normalizeWorkspaceRuntimeEvent(event),
      input.config.maxContextWindowTokens,
    ));
  });
  if (!response.ok || error || !isRecord(result)) {
    throw new Error(error || `SciForge project tool failed: HTTP ${response.status}`);
  }
  const completion = workspaceResultCompletion(result);
  callbacks.onEvent?.(toolEvent('project-tool-done', completion.status === 'failed'
    ? `SciForge ${builtInScenarioId} 未完成：${completion.reason ?? '后台返回 repair-needed/failed-with-reason 诊断，未产出用户要求的最终结果。'}`
    : priorFailure
      ? `SciForge ${builtInScenarioId} 已完成，并保留上一轮修复上下文`
      : `SciForge ${builtInScenarioId} project tool completed`));
  return normalizeAgentResponse(builtInScenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: makeId(`project-${builtInScenarioId}`),
        status: completion.status,
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(result),
        },
      },
    },
  });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timedOut
        ? `SciForge project tool 超时：${input.config.requestTimeoutMs || DEFAULT_AGENT_REQUEST_TIMEOUT_MS}ms 内没有完成。流式面板已显示最后一个真实事件。`
        : 'SciForge project tool 已取消。');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    globalThis.clearInterval(silenceWatchdog);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

function compactTargetInstanceContext(input: SendAgentMessageInput) {
  const target = input.targetInstanceContext;
  if (!target) return undefined;
  return {
    mode: target.mode,
    banner: target.banner,
    selectedAt: target.selectedAt,
    peer: target.peer,
    issueLookup: target.issueLookup ? {
      trigger: target.issueLookup.trigger,
      query: target.issueLookup.query,
      workspaceWriterUrl: target.issueLookup.workspaceWriterUrl,
      workspacePath: target.issueLookup.workspacePath,
      matchedIssueId: target.issueLookup.matchedIssueId,
      githubIssueNumber: target.issueLookup.githubIssueNumber,
      status: target.issueLookup.status,
      error: target.issueLookup.error,
      summaries: target.issueLookup.summaries?.slice(0, 8).map((issue) => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        github: issue.github,
        runtime: issue.runtime,
        comment: issue.comment.slice(0, 360),
      })),
      bundle: target.issueLookup.bundle ? compactReferencePayload(target.issueLookup.bundle) : undefined,
    } : undefined,
    executionBoundary: target.mode === 'peer' ? {
      mode: 'repair-handoff-runner-target-worktree',
      targetWorkspacePath: target.peer?.workspacePath || undefined,
      targetWorkspaceWriterUrl: target.peer?.workspaceWriterUrl || undefined,
      preventExecutorWorkspaceFallback: true,
    } : undefined,
  };
}

function buildRepairHandoffRunnerPayload(input: SendAgentMessageInput) {
  const target = input.targetInstanceContext;
  const peer = target?.peer;
  const bundle = target?.issueLookup?.bundle;
  if (!target || target.mode !== 'peer' || !peer || !bundle || peer.trustLevel === 'readonly') return undefined;
  if (!peer.workspacePath.trim()) return undefined;
  return {
    endpoint: `${input.config.workspaceWriterBaseUrl.replace(/\/+$/, '')}/api/sciforge/repair-handoff/run`,
    method: 'POST',
    contract: {
      executorInstance: {
        id: 'current',
        name: input.agentName,
        workspaceWriterUrl: input.config.workspaceWriterBaseUrl,
        workspacePath: input.config.workspacePath,
      },
      targetInstance: {
        name: peer.name,
        appUrl: peer.appUrl,
        workspaceWriterUrl: peer.workspaceWriterUrl,
        workspacePath: peer.workspacePath,
      },
      targetWorkspacePath: peer.workspacePath,
      targetWorkspaceWriterUrl: peer.workspaceWriterUrl,
      issueBundle: bundle,
      expectedTests: [],
      githubSyncRequired: Boolean(bundle.github?.issueNumber || bundle.github?.issueUrl),
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      executionBoundary: {
        mode: 'target-isolated-worktree',
        targetWorkspacePath: peer.workspacePath,
        targetWorkspaceWriterUrl: peer.workspaceWriterUrl,
        forbidExecutorWorkspace: true,
      },
    },
  };
}

function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  const skillDomain = input.scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  if (skillDomain === 'literature') return 'literature-evidence-review';
  if (input.scenarioId === 'structure-exploration'
    || input.scenarioId === 'omics-differential-exploration'
    || input.scenarioId === 'biomedical-knowledge-graph'
    || input.scenarioId === 'literature-evidence-review') return input.scenarioId as ScenarioId;
  return 'literature-evidence-review';
}

export function currentTurnContextPolicy(
  input: SendAgentMessageInput,
  artifacts: ReturnType<typeof summarizeArtifacts> = summarizeArtifacts(input),
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs> = summarizeExecutionRefs(input),
) {
  const prompt = input.prompt.trim();
  const hasExplicitReferences = (input.references?.length ?? 0) > 0;
  if (hasExplicitReferences && !isPriorContinuationLikePrompt(prompt)) return { isolated: true, reason: 'explicit-current-reference' };
  if (hasExplicitReferences) return { isolated: false, reason: 'explicit-user-reference' };
  if (!artifacts.length && !recentExecutionRefs.length && !(input.runs?.length ?? 0)) {
    return { isolated: false, reason: 'no-prior-context' };
  }
  if (isContinuationLikePrompt(prompt)) return { isolated: false, reason: 'continuation-or-repair-request' };
  if (isFreshRetrievalPrompt(prompt)) return { isolated: true, reason: 'fresh-retrieval-request' };
  if (isPromptFarFromPriorContext(prompt, artifacts, input.runs ?? [])) return { isolated: true, reason: 'current-prompt-drifted-from-prior-context' };
  return { isolated: false, reason: 'context-may-be-relevant' };
}

function isContinuationLikePrompt(prompt: string) {
  return /继续|基于|根据|上面|上述|这个|这个文件|该文件|这些|前面|之前|上一轮|刚才|已有|已上传|上传|PDF|pdf|总结已有|解释上一轮|修复|重试|重新跑|rerun|repair|retry|continue|existing|previous|uploaded/i.test(prompt);
}

function isPriorContinuationLikePrompt(prompt: string) {
  return /继续|上面|上述|前面|之前|上一轮|上次|刚才|已有|已上传|总结已有|解释上一轮|修复|重试|重新跑|rerun|repair|retry|continue|existing|previous|prior|last\s+(round|run|turn)/i.test(prompt);
}

function isFreshRetrievalPrompt(prompt: string) {
  return /今天|今日|最新|新近|刚发布|检索|搜索|查找|arxiv|bioRxiv|medRxiv|PubMed|Semantic Scholar|Google Scholar|latest|today|new|recent|search|retrieve/i.test(prompt);
}

function isPromptFarFromPriorContext(
  prompt: string,
  artifacts: ReturnType<typeof summarizeArtifacts>,
  runs: NonNullable<SendAgentMessageInput['runs']>,
) {
  const promptTokens = keywordTokens(prompt);
  if (!promptTokens.size) return false;
  const priorText = [
    ...artifacts.map((artifact) => JSON.stringify({
      id: artifact.id,
      type: artifact.type,
      metadata: artifact.metadata,
      dataSummary: artifact.dataSummary,
    })),
    ...runs.slice(-4).map((run) => `${run.prompt} ${run.response}`),
  ].join('\n');
  const priorTokens = keywordTokens(priorText);
  if (!priorTokens.size) return false;
  let overlap = 0;
  for (const token of promptTokens) {
    if (priorTokens.has(token)) overlap += 1;
  }
  return overlap / promptTokens.size < 0.18;
}

function keywordTokens(value: string) {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
    const token = match[0];
    if (STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'have', 'has', 'had',
  '请', '帮我', '提供', '一个', '一份', '简要', '总结', '报告', '相关', '论文', '阅读',
]);

function currentTurnConversation(
  input: SendAgentMessageInput,
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const hasCurrentSessionWork = (input.runs?.length ?? 0) > 0
    || artifactSummary.length > 0
    || recentExecutionRefs.length > 0
    || (input.references?.length ?? 0) > 0;
  if (!hasCurrentSessionWork) return [`user: ${input.prompt}`];
  const conversation = stableSessionMessages(input).slice(-16).map((message, index, messages) => {
    const isRecent = index >= Math.max(0, messages.length - 8);
    const references = message.references?.length
      ? `\n  references: ${JSON.stringify(message.references.map(compactSciForgeReference))}`
      : '';
    return `${message.role}: ${compactConversationContent(message.content, isRecent ? 1200 : 480)}${references}`;
  });
  const lastUser = [...stableSessionMessages(input)].reverse().find((message) => message.role === 'user');
  if (!lastUser || normalizePromptText(lastUser.content) !== normalizePromptText(input.prompt)) {
    conversation.push(`user: ${compactConversationContent(input.prompt)}`);
  }
  return conversation;
}

function stableSessionMessages(input: SendAgentMessageInput) {
  return (input.messages ?? []).filter((message) => !message.id.startsWith('seed'));
}

function normalizePromptText(value: string) {
  return value.replace(/^运行中引导：/, '').trim();
}

function compactConversationContent(value: string, maxChars = 1200) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const headChars = Math.max(80, Math.floor(maxChars * 0.66));
  const tailChars = Math.max(40, maxChars - headChars);
  return `${normalized.slice(0, headChars)} ... [${normalized.length - maxChars} chars omitted] ... ${normalized.slice(-tailChars)}`;
}

function summarizeArtifacts(input: SendAgentMessageInput) {
  return (input.artifacts ?? []).slice(-8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    producer: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    dataRef: artifact.dataRef,
    path: artifact.path,
    workspaceArtifactRef: input.sessionId ? `.sciforge/artifacts/${safeWorkspaceName(input.sessionId)}-${safeWorkspaceName(artifact.id || artifact.type || 'artifact')}.json` : undefined,
    runId: artifactRunId(artifact),
    status: artifactStatus(artifact),
    failureReason: artifactFailureReason(artifact),
    fileRefs: collectArtifactFileRefs(artifact),
    imageMemoryRefs: collectArtifactImageMemoryRefs(artifact),
    metadata: compactRecord(artifact.metadata),
    dataSummary: summarizeArtifactData(artifact.data),
  }));
}

function buildArtifactAccessPolicy(
  input: SendAgentMessageInput,
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const maxArtifactInlineChars = Math.max(800, Math.min(2400, Math.floor((input.config.maxContextWindowTokens || 200_000) * 0.012)));
  const explicitRefs = uniqueStrings((input.references ?? []).map((reference) => reference.ref)).slice(0, 12);
  const artifactRefs = uniqueStrings(artifactSummary.flatMap((artifact) => [
    artifact.id ? `artifact:${artifact.id}` : undefined,
    artifact.path ? `file:${artifact.path}` : undefined,
    artifact.dataRef ? `file:${artifact.dataRef}` : undefined,
    ...(artifact.fileRefs ?? []).map((ref) => `file:${ref}`),
    ...(artifact.imageMemoryRefs ?? []).map((ref) => `file:${ref}`),
  ])).slice(0, 32);
  const executionRefs = uniqueStrings(recentExecutionRefs.flatMap((unit) => [
    unit.outputRef ? `file:${unit.outputRef}` : undefined,
    unit.stdoutRef ? `file:${unit.stdoutRef}` : undefined,
    unit.stderrRef ? `file:${unit.stderrRef}` : undefined,
    unit.codeRef ? `file:${unit.codeRef}` : undefined,
  ])).slice(0, 24);
  return {
    mode: 'refs-first-bounded-read',
    purpose: 'reuse prior work without replaying full artifact payloads into model context',
    maxArtifactInlineChars,
    defaultAction: 'Use artifact ids, paths, metadata, dataSummary, recentExecutionRefs, and conversationLedger before opening files.',
    readPolicy: [
      'Do not cat or paste full JSON/markdown/log artifacts unless the current user explicitly asks for full content.',
      'For verification, prefer bounded reads: file metadata, schema keys, counts, jq-selected fields, head/tail, or concise excerpts.',
      'When comparing large artifacts, read only the fields needed for the current question and cite the artifact/ref path.',
      'For vision/computer-use image memory, use screenshot file refs, thumbnails, hashes, and step summaries; never inline dataUrl/base64 screenshot bytes into model context.',
      'If the summary is enough, answer from refs and dataSummary without reopening the file.',
    ],
    explicitCurrentTurnRefs: explicitRefs,
    reusableArtifactRefs: artifactRefs,
    reusableExecutionRefs: executionRefs,
  };
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function selectedRuntimeSkillIds(input: SendAgentMessageInput, skillDomain: string) {
  return uniqueStrings([
    ...(input.scenarioOverride?.selectedSkillIds ?? []),
    `agentserver.generate.${skillDomain}`,
  ]);
}

function selectedRuntimeToolIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedToolIds ?? []);
}

function selectedRuntimeSenseIds(input: SendAgentMessageInput, selectedToolIds = selectedRuntimeToolIds(input)) {
  return uniqueStrings([
    ...(input.scenarioOverride?.selectedSenseIds ?? []),
    ...selectedToolIds.filter((id) => id.includes('sense')),
  ]);
}

function selectedRuntimeActionIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedActionIds ?? []);
}

function selectedRuntimeVerifierIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedVerifierIds ?? []);
}

function selectedRuntimeToolContracts(selectedToolIds: string[]) {
  return selectedToolIds.flatMap((toolId) => {
    if (toolId !== 'local.vision-sense') return [{ id: toolId, selected: true }];
    return [{
      id: 'local.vision-sense',
      selected: true,
      kind: 'sense-plugin',
      modality: 'vision',
      packageRoot: 'packages/senses/vision-sense',
      readmePath: 'packages/tools/local/vision-sense/SKILL.md',
      skillTemplate: 'packages/skills/installed/local/vision-gui-task/SKILL.md',
      inputContract: {
        textField: 'text',
        modalitiesField: 'modalities',
        acceptedModalities: ['screenshot', 'image'],
      },
      outputContract: {
        kind: 'text',
        formats: ['text/plain', 'application/json', 'application/x-ndjson'],
        actions: ['click', 'type_text', 'press_key', 'scroll', 'wait'],
      },
      executionBoundary: 'text-signal-only',
      missingRuntimeBridgePolicy: {
        behavior: 'diagnose-or-fail-closed',
        reason: 'local.vision-sense only emits auditable text signals and trace refs; a browser/desktop executor bridge plus screenshot source must execute real GUI actions.',
        noFallbackRepoScan: true,
        expectedFailureUnit: 'Return failed-with-reason when no GUI executor/screenshot bridge is configured for this run.',
      },
      computerUsePolicy: {
        executorOwnedBy: 'upstream Computer Use provider or browser/desktop adapter',
        noDomOrAccessibilityReads: true,
        highRiskPolicy: 'reject unless explicitly confirmed upstream',
        tracePolicy: 'preserve screenshot refs, planned action, grounding summary, execution status, pixel diff, and failureReason; never inline screenshot base64 into chat context',
      },
    }];
  });
}

function buildReferencePolicy(references: ReturnType<typeof summarizeSciForgeReferences>) {
  return {
    mode: 'explicit-refs-first',
    defaultAction: 'Use current references as explicit user-provided evidence; resolve large payloads by ref and bounded summary.',
    currentReferenceCount: references.length,
  };
}

function buildFailureRecoveryPolicy(priorFailure?: string) {
  return {
    mode: priorFailure ? 'repair-first' : 'preserve-context',
    priorFailureReason: priorFailure,
    recoverActions: priorFailure
      ? ['Preserve prior failureReason/log/code refs and repair before presenting success.']
      : ['Record failureReason, missing inputs, refs, recoverActions, and nextStep if execution cannot complete.'],
  };
}

function buildVerificationPolicy(input: SendAgentMessageInput) {
  const configured = input.scenarioOverride?.verificationPolicy;
  if (configured && isRecord(configured)) {
    const mode = asString(configured.mode) || (input.scenarioOverride?.unverifiedReason ? 'unverified' : 'lightweight');
    return {
      required: asBoolean(configured.required) ?? true,
      mode,
      reason: asString(configured.reason) || 'Scenario provided verification policy.',
      ...configured,
    };
  }
  const unverifiedReason = input.scenarioOverride?.unverifiedReason;
  return {
    required: true,
    mode: unverifiedReason ? 'unverified' : 'lightweight',
    reason: unverifiedReason
      ? '当前 scenario 明确允许本轮暂未验证，但必须把原因带入上下文。'
      : '默认使用轻量验证；高风险 action 或用户显式要求时由 runtime/AgentServer 升级验证强度。',
    riskLevel: 'low',
    unverifiedReason,
  };
}

function buildHumanApprovalPolicy(input: SendAgentMessageInput, selectedActionIds: string[]) {
  const configured = input.scenarioOverride?.humanApprovalPolicy;
  if (configured && isRecord(configured)) return configured;
  return {
    required: selectedActionIds.length > 0,
    mode: selectedActionIds.length > 0 ? 'required-before-action' : 'none',
    reason: selectedActionIds.length > 0
      ? '已选择可能产生副作用的 action，执行前需要上游确认策略。'
      : '本轮没有显式 action 选择。',
  };
}

function summarizeSciForgeReferences(input: SendAgentMessageInput) {
  return (input.references ?? []).slice(0, 8).map(compactSciForgeReference);
}

function compactSciForgeReference(reference: NonNullable<SendAgentMessageInput['references']>[number]) {
  return {
    id: reference.id,
    kind: reference.kind,
    title: reference.title,
    ref: reference.ref,
    sourceId: reference.sourceId,
    runId: reference.runId,
    locator: reference.locator,
    summary: reference.summary,
    payload: compactReferencePayload(reference.payload),
  };
}

function compactReferencePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return payload.slice(0, 1600);
  if (Array.isArray(payload)) return payload.slice(0, 8);
  if (!isRecord(payload)) return payload;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 12)) {
    if (typeof value === 'string') {
      compact[key] = value.slice(0, 1600);
    } else if (Array.isArray(value)) {
      compact[key] = value.slice(0, 8);
    } else if (isRecord(value)) {
      compact[key] = compactRecord(value);
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function summarizeExecutionRefs(input: SendAgentMessageInput) {
  return (input.executionUnits ?? []).slice(-8).map((unit) => ({
    id: unit.id,
    status: unit.status,
    tool: unit.tool,
    attempt: unit.attempt,
    parentAttempt: unit.parentAttempt,
    codeRef: unit.codeRef,
    inputRef: unit.params && looksLikeRef(unit.params) ? unit.params : undefined,
    outputRef: unit.outputRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    failureReason: unit.failureReason,
    selfHealReason: unit.selfHealReason,
    recoverActions: unit.recoverActions,
    nextStep: unit.nextStep,
    routeDecision: unit.routeDecision,
  })).filter((item) => item.codeRef || item.outputRef || item.stdoutRef || item.stderrRef || item.failureReason || item.status === 'repair-needed' || item.status === 'failed-with-reason');
}

function summarizeRuns(input: SendAgentMessageInput) {
  return (input.runs ?? []).slice(-6).map((run) => ({
    id: run.id,
    status: run.status,
    prompt: run.prompt.slice(0, 360),
    responsePreview: run.response.slice(0, 360),
    scenarioPackageRef: run.scenarioPackageRef,
    skillPlanRef: run.skillPlanRef,
    uiPlanRef: run.uiPlanRef,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }));
}

function artifactRunId(artifact: { metadata?: Record<string, unknown> }) {
  const metadata = artifact.metadata ?? {};
  return asString(metadata.runId) || asString(metadata.agentServerRunId) || asString(metadata.producerRunId) || asString(metadata.lastRunId);
}

function artifactStatus(artifact: { metadata?: Record<string, unknown>; data?: unknown }) {
  const metadata = artifact.metadata ?? {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.status) || asString(data.status);
}

function artifactFailureReason(artifact: { metadata?: Record<string, unknown>; data?: unknown }) {
  const metadata = artifact.metadata ?? {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.failureReason) || asString(data.failureReason) || asString(metadata.reason) || asString(data.reason);
}

function summarizeArtifactData(data: unknown) {
  if (typeof data === 'string') {
    return {
      valueType: 'string',
      textPreview: data.slice(0, 1200),
      markdownPreview: data.slice(0, 1200),
    };
  }
  if (!isRecord(data)) return data === undefined ? undefined : { valueType: Array.isArray(data) ? 'array' : typeof data };
  const keys = Object.keys(data).slice(0, 20);
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  const sections = Array.isArray(data.sections) ? data.sections : undefined;
  const collections = summarizeArtifactCollections(data);
  return {
    keys,
    rowCount: rows?.length,
    collections,
    sectionTitles: sections?.slice(0, 8).map((section) => isRecord(section) ? asString(section.title) : undefined).filter(Boolean),
    markdownPreview: typeof data.markdown === 'string' ? data.markdown.slice(0, 500) : undefined,
    refs: compactRecord({
      dataRef: data.dataRef,
      codeRef: data.codeRef,
      outputRef: data.outputRef,
      stdoutRef: data.stdoutRef,
      stderrRef: data.stderrRef,
      logRef: data.logRef,
      reportRef: data.reportRef,
      traceRef: data.traceRef,
      visionTraceRef: data.visionTraceRef,
      screenshotRef: data.screenshotRef,
      beforeScreenshotRef: data.beforeScreenshotRef,
      afterScreenshotRef: data.afterScreenshotRef,
      finalScreenshotRef: data.finalScreenshotRef,
      paperListRef: data.paperListRef,
      pdfDir: data.pdfDir,
      downloadDir: data.downloadDir,
    }),
    imageMemory: summarizeVisionImageMemory(data),
  };
}

function summarizeArtifactCollections(data: Record<string, unknown>) {
  const collections: Record<string, unknown> = {};
  for (const key of ['papers', 'items', 'records', 'rows', 'nodes', 'edges', 'files', 'results']) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    collections[key] = {
      count: value.length,
      refs: summarizeCollectionRefs(value),
    };
  }
  return Object.keys(collections).length ? collections : undefined;
}

function summarizeCollectionRefs(items: unknown[]) {
  return items.slice(0, 8).map((item) => {
    const record = isRecord(item) ? item : {};
    return compactRecord({
      title: record.title,
      name: record.name,
      id: record.id,
      accession: record.accession,
      doi: record.doi,
      url: record.url,
      remoteUrl: record.remoteUrl,
      downloadUrl: record.downloadUrl,
      localPath: record.localPath,
      path: record.path,
      filePath: record.filePath,
      downloadedPath: record.downloadedPath,
      sourcePath: record.sourcePath,
      dataRef: record.dataRef,
    });
  }).filter(Boolean);
}

function collectArtifactFileRefs(value: unknown) {
  const refs = new Set<string>();
  const visit = (entry: unknown, key = '') => {
    if (refs.size >= 24) return;
    if (typeof entry === 'string') {
      if (looksLikeRef(entry) || /path|ref|file|dir|pdf|download|log|stdout|stderr|output|code|screenshot|image|thumb|crosshair/i.test(key)) refs.add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 24)) visit(item, key);
      return;
    }
    if (!isRecord(entry)) return;
    for (const [childKey, childValue] of Object.entries(entry).slice(0, 48)) {
      visit(childValue, childKey);
    }
  };
  visit(value);
  return refs.size ? Array.from(refs) : undefined;
}

function summarizeVisionImageMemory(data: Record<string, unknown>) {
  const refs = collectArtifactImageMemoryRefs(data) ?? [];
  const steps = Array.isArray(data.steps) ? data.steps : Array.isArray(data.trace) ? data.trace : [];
  if (!refs.length && !steps.length) return undefined;
  return {
    policy: 'file-refs-only',
    refs: refs.slice(0, 24),
    stepCount: steps.length || undefined,
    recentSteps: steps.slice(-5).map((step, index) => {
      const record = isRecord(step) ? step : {};
      return compactRecord({
        index: typeof record.index === 'number' ? record.index : steps.length - Math.min(5, steps.length) + index,
        beforeScreenshotRef: record.beforeScreenshotRef ?? record.before_screenshot_ref,
        afterScreenshotRef: record.afterScreenshotRef ?? record.after_screenshot_ref,
        crosshairScreenshotRef: record.crosshairScreenshotRef ?? record.crosshair_screenshot_ref,
        action: record.action ?? record.plannedAction ?? record.planned_action,
        target: record.target ?? record.targetDescription ?? record.target_description,
        grounding: record.grounding,
        pixelDiff: record.pixelDiff ?? record.pixel_diff,
        failureReason: record.failureReason ?? record.failure_reason,
      });
    }).filter(Boolean),
  };
}

function collectArtifactImageMemoryRefs(value: unknown) {
  const refs = new Set<string>();
  const visit = (entry: unknown, key = '') => {
    if (refs.size >= 32) return;
    if (typeof entry === 'string') {
      if (isDataUrl(entry)) return;
      if (isImageMemoryRef(entry) || /screenshot|image|thumb|crosshair/i.test(key)) refs.add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 48)) visit(item, key);
      return;
    }
    if (!isRecord(entry)) return;
    for (const [childKey, childValue] of Object.entries(entry).slice(0, 64)) {
      visit(childValue, childKey);
    }
  };
  visit(value);
  return refs.size ? Array.from(refs) : undefined;
}

function compactRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) {
    if (typeof entry === 'string' && isDataUrl(entry)) out[key] = '[image dataUrl omitted; use file/image refs instead]';
    else if (typeof entry === 'string') out[key] = entry.length > 500 ? `${entry.slice(0, 500)}...` : entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry == null) out[key] = entry;
    else if (Array.isArray(entry)) out[key] = entry.slice(0, 12);
    else if (isRecord(entry)) out[key] = Object.fromEntries(Object.entries(entry).slice(0, 8));
  }
  return Object.keys(out).length ? out : undefined;
}

function looksLikeRef(value: string) {
  return /\.sciforge\/|stdout|stderr|output|input|\.json|\.log|\.py|\.ipynb|\.r|\.png|\.jpe?g|\.gif|\.webp|\.svg$/i.test(value);
}

function isImageMemoryRef(value: string) {
  return !isDataUrl(value) && /(?:^artifact:|^file:|\.sciforge\/|\.bioagent\/|workspace:\/\/|\/).*\.(?:png|jpe?g|gif|webp|svg)$/i.test(value);
}

function isDataUrl(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function safeWorkspaceName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function workspacePersistenceSummary(input: SendAgentMessageInput) {
  const workspacePath = input.config.workspacePath.trim();
  const sessionId = input.sessionId;
  return {
    workspacePath,
    sciforgeDir: workspacePath ? `${workspacePath}/.sciforge` : '.sciforge',
    workspaceStateRef: '.sciforge/workspace-state.json',
    sessionRef: sessionId ? `.sciforge/sessions/${safeWorkspaceName(sessionId)}.json` : undefined,
    artifactDir: '.sciforge/artifacts/',
    taskDir: '.sciforge/tasks/',
    taskResultDir: '.sciforge/task-results/',
    logDir: '.sciforge/logs/',
    note: 'Generated task code, task inputs/results/logs, and UI artifacts are persisted under the workspace .sciforge directory when Workspace Writer is online.',
  };
}

function hasPriorFailure(
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const artifactFailure = artifactSummary
    .map((artifact) => artifact.failureReason || (artifact.status === 'repair-needed' ? 'artifact marked repair-needed' : undefined))
    .find(Boolean);
  if (artifactFailure) return String(artifactFailure).slice(0, 220);
  const executionFailure = recentExecutionRefs
    .map((unit) => unit.failureReason || (unit.status === 'repair-needed' || unit.status === 'failed-with-reason' ? `${unit.id} status=${unit.status}` : undefined))
    .find(Boolean);
  return executionFailure ? String(executionFailure).slice(0, 220) : undefined;
}

function buildToolLlmEndpoint(input: SendAgentMessageInput) {
  const provider = input.config.modelProvider.trim();
  const modelName = input.config.modelName.trim();
  const baseUrl = input.config.modelBaseUrl.trim().replace(/\/+$/, '');
  const apiKey = input.config.apiKey.trim();
  const useNative = !provider || provider === 'native';
  if (!baseUrl && !modelName && !apiKey) return undefined;
  return {
    provider: useNative ? 'native' : provider,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
}

function buildAgentContext(
  input: SendAgentMessageInput,
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
  availableComponentIds: string[],
  artifactAccessPolicy = buildArtifactAccessPolicy(input, artifactSummary, recentExecutionRefs),
  selectedToolContracts = selectedRuntimeToolContracts(selectedRuntimeToolIds(input)),
  isolated = false,
  repairHandoffRunner?: ReturnType<typeof buildRepairHandoffRunnerPayload>,
) {
  const targetInstanceContext = compactTargetInstanceContext(input);
  const scenario = input.scenarioOverride;
  return {
    scenario: scenario ? {
      title: scenario.title,
      goal: scenario.description,
      markdownPreview: compactConversationContent(scenario.scenarioMarkdown),
      markdownChars: scenario.scenarioMarkdown.length,
    } : undefined,
    recentConversation,
    conversationLedger: buildConversationLedger(input, isolated),
    contextReusePolicy: buildContextReusePolicy(input, recentConversation),
    artifactAccessPolicy,
    currentReferences: summarizeSciForgeReferences(input),
    targetInstance: targetInstanceContext,
    targetInstanceContext,
    repairHandoffRunner,
    availableComponentIds,
    selectedToolIds: selectedRuntimeToolIds(input),
    selectedToolContracts,
    artifacts: artifactSummary,
    recentExecutionRefs,
    workspacePersistence: workspacePersistenceSummary(input),
    notes: [
      'User prompt is carried separately as the authoritative request.',
      'Use this context only as supporting evidence for AgentServer-side intent reasoning.',
      'Do not let UI hints, scenario text, or historical requests override the current raw user prompt.',
      'For prior artifacts, prefer refs and bounded excerpts over full file reads unless the user explicitly requests full content.',
      'When local.vision-sense is selected, treat it as an optional vision sense plugin: build text + screenshot/image modality requests, emit text-form Computer Use commands, and keep trace refs compact across follow-up turns.',
    ],
  };
}

function buildConversationLedger(input: SendAgentMessageInput, isolated = false) {
  const messages = isolated
    ? stableSessionMessages(input).filter((message) => normalizePromptText(message.content) === normalizePromptText(input.prompt)).slice(-1)
    : stableSessionMessages(input);
  return messages.map((message, index) => {
    const isRecent = index >= Math.max(0, messages.length - 4);
    return {
      turn: index + 1,
      id: message.id,
      role: message.role,
      createdAt: message.createdAt,
      status: message.status,
      contentChars: message.content.length,
      contentDigest: stableTextDigest(message.content),
      contentPreview: compactConversationContent(message.content, isRecent ? 900 : 360),
      references: message.references?.length ? message.references.map(compactSciForgeReference) : undefined,
    };
  });
}

function buildContextReusePolicy(input: SendAgentMessageInput, recentConversation: string[]) {
  const messages = stableSessionMessages(input);
  return {
    mode: messages.length > recentConversation.length ? 'stable-ledger-plus-recent-window' : 'full-recent-window',
    ordering: 'append-only-session-order',
    longTermFacts: 'workspace-refs-and-conversation-ledger',
    shortTermIntent: 'recentConversation-and-rawUserPrompt',
    messageCount: messages.length,
    recentConversationCount: recentConversation.length,
    note: 'Older turns are retained as a compact append-only ledger while recent turns stay readable for intent continuity.',
  };
}

function stableTextDigest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16)}-${value.length}`;
}
