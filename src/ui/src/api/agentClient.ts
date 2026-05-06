import type { ScenarioId, ClaimType, EvidenceLevel } from '../data';
import {
  makeId,
  nowIso,
  type AgentServerRunPayload,
  type AgentBackendId,
  type AgentStreamEvent,
  type SciForgeMessage,
  type NormalizedAgentResponse,
  type ObjectAction,
  type ObjectReference,
  type ObjectReferenceKind,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type ScenarioInstanceId,
  type SemanticTurnAcceptance,
  type SendAgentMessageInput,
  type TurnAcceptance,
  type UserGoalSnapshot,
} from '../domain';
import { agentProtocolForPrompt, SCENARIO_SPECS } from '../scenarioSpecs';
import { expectedArtifactsForCurrentTurn } from '../artifactIntent';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from './clientError';
import { promptWithScopeCheck, scopeCheck } from './scopeCheck';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, DEFAULT_AGENT_SERVER_URL } from '../../../shared/agentHandoff';

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_AGENT_REQUEST_TIMEOUT_MS;

const evidenceLevels: EvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];
const claimTypes: ClaimType[] = ['fact', 'inference', 'hypothesis'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function pickEvidence(value: unknown): EvidenceLevel {
  return evidenceLevels.includes(value as EvidenceLevel) ? value as EvidenceLevel : 'prediction';
}

function pickClaimType(value: unknown): ClaimType {
  return claimTypes.includes(value as ClaimType) ? value as ClaimType : 'inference';
}

function agentSystemPrompt(input: SendAgentMessageInput) {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const protocol = agentProtocolForPrompt(builtInScenarioId);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
  const runtimeScenario = input.scenarioOverride;
  return [
    `你运行在 SciForge 的场景工作台中，当前 Scenario 是「${runtimeScenario?.title ?? scenario.title}」，skill domain 是 ${runtimeScenario?.skillDomain ?? scenario.skillDomain}，领域是 ${input.agentDomain}。`,
    '当前用户原始问题是最高优先级；ScenarioSpec、UI 默认组件和历史请求只能作为上下文提示，不能替用户添加没有要求的目标。',
    '请用中文回答生命科学研究问题。',
    '优先使用当前 backend 的 native tools；只有 native tools 不可用时，才把 SciForge/AgentServer tools 当兜底。',
    '只在本轮用户明确需要时输出 artifact/uiManifest；不要因为场景默认值自动生成 paper-list、evidence-matrix、notebook-timeline。',
    '需要执行或产物时，输出可追溯证据、置信度、事实/推断/假设区分，以及可复现 ExecutionUnit 草案。',
    '不要生成 UI 代码；如需驱动前端 UI，请在回答末尾附加一个 JSON 对象。',
    'JSON 字段可包含 message、confidence、claimType、evidenceLevel、reasoningTrace、claims、displayIntent、uiManifest、executionUnits、artifacts、objectReferences。',
    'artifacts 必须优先使用下方协议中的 type/schema；uiManifest 只能引用已注册 componentId 和声明式 View Composition。',
    'objectReferences 用于回答中引用关键对象；ref 必须是 artifact:*、file:*、folder:*、run:*、execution-unit:* 或 url:*，前端点击后再按需展示/打开。',
    '当前 ScenarioSpec / skill domain 协议是兼容提示，不是强制目标:',
    protocol,
    runtimeScenario ? '用户编辑后的 Scenario 设置:' : '',
    runtimeScenario ? JSON.stringify(runtimeScenario, null, 2) : '',
    selectedRuntimeToolInstructions(input),
  ].join('\n');
}

function buildPrompt(input: SendAgentMessageInput) {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const expectedArtifacts = expectedArtifactsForCurrentTurn({
    scenarioId: builtInScenarioId,
    prompt: input.prompt,
  });
  const recentHistory = input.messages.slice(-6).map((message) => ({
    role: message.role,
    content: clipPromptText(message.content, 900),
    references: message.references?.map(compactSciForgeReference),
  }));
  const artifactContext = summarizeArtifacts(input.artifacts ?? []);
  const referenceContext = summarizeSciForgeReferences(input.references ?? []);
  const artifactAccessPolicy = buildArtifactAccessPolicy(input, artifactContext);
  return [
    '用户原始问题（权威）:',
    input.prompt,
    '',
    `当前 SciForge scenario: ${input.scenarioId}`,
    `internal skill domain: ${input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain}`,
    `本轮显式 expected artifacts: ${expectedArtifacts.join(', ') || 'backend-decides'}`,
    `用户勾选的可用 UI 组件白名单: ${(input.availableComponentIds ?? []).join(', ') || 'none'}`,
    input.scenarioOverride ? `用户编辑 Scenario markdown:\n${input.scenarioOverride.scenarioMarkdown}` : '',
    `当前角色视图: ${input.roleView}`,
    '近期对话:',
    JSON.stringify(recentHistory, null, 2),
    artifactContext.length ? '当前可用 artifacts:' : '',
    artifactContext.length ? JSON.stringify(artifactContext, null, 2) : '',
    artifactContext.length ? 'artifact 访问策略（通用成本约束）:' : '',
    artifactContext.length ? JSON.stringify(artifactAccessPolicy, null, 2) : '',
    referenceContext.length ? '用户本轮显式引用对象:' : '',
    referenceContext.length ? JSON.stringify(referenceContext, null, 2) : '',
    selectedRuntimeToolInstructions(input),
    '',
    'Scope check metadata:',
    JSON.stringify(scopeCheck(builtInScenarioId, input.prompt), null, 2),
    '',
  ].filter((line) => line !== '').join('\n');
}

function buildRunPayload(input: SendAgentMessageInput): AgentServerRunPayload {
  const runtime = buildRuntimeConfig(input);
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
  const expectedArtifacts = expectedArtifactsForCurrentTurn({
    scenarioId: builtInScenarioId,
    prompt: input.prompt,
  });
  const artifactSummary = summarizeArtifacts(input.artifacts ?? []);
  return {
    agent: {
      id: scenario.runtimeId,
      name: input.scenarioOverride?.title ?? scenario.title,
      backend: normalizeAgentBackend(input.config.agentBackend),
      workspace: input.config.workspacePath,
      workingDirectory: input.config.workspacePath,
      systemPrompt: agentSystemPrompt(input),
      reconcileExisting: true,
      metadata: {
        sciForgeScenario: input.scenarioId,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        skillDomain: input.scenarioOverride?.skillDomain ?? scenario.skillDomain,
        domain: input.agentDomain,
        nativeTools: scenario.nativeTools,
        fallbackTools: scenario.fallbackTools,
        selectedToolIds: input.scenarioOverride?.selectedToolIds ?? [],
        selectedToolContracts: selectedRuntimeToolContracts(input.scenarioOverride?.selectedToolIds ?? []),
      },
    },
    input: {
      text: buildPrompt(input),
      metadata: {
        rawUserPrompt: input.prompt,
        roleView: input.roleView,
        messageCount: input.messages.length,
        inputContract: scenario.inputContract,
        expectedArtifacts,
        availableComponentIds: input.availableComponentIds ?? [],
        scenarioArtifactHints: scenario.outputArtifacts.map((artifact) => artifact.type),
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        scenarioOverride: input.scenarioOverride,
        selectedToolContracts: selectedRuntimeToolContracts(input.scenarioOverride?.selectedToolIds ?? []),
        artifacts: artifactSummary,
        artifactAccessPolicy: buildArtifactAccessPolicy(input, artifactSummary),
        references: summarizeSciForgeReferences(input.references ?? []),
        scopeCheck: scopeCheck(builtInScenarioId, input.prompt),
      },
    },
    runtime,
    metadata: {
      project: 'SciForge',
      source: 'sciforge-web-ui',
      scenarioId: input.scenarioId,
      runtimeConfig: {
        agentBackend: input.config.agentBackend,
        modelProvider: input.config.modelProvider,
        modelBaseUrl: input.config.modelBaseUrl,
        modelName: input.config.modelName,
        maxContextWindowTokens: input.config.maxContextWindowTokens,
        agentServerBaseUrl: input.config.agentServerBaseUrl,
        workspacePath: input.config.workspacePath,
      },
    },
  };
}

function summarizeSciForgeReferences(references: NonNullable<SendAgentMessageInput['references']>) {
  return references.slice(0, 8).map(compactSciForgeReference);
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
    summary: clipPromptText(reference.summary, 320),
    payload: previewReferencePayload(reference.payload),
  };
}

function previewReferencePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return clipPromptText(payload, 360);
  if (Array.isArray(payload)) return { valueType: 'array', count: payload.length, preview: payload.slice(0, 4).map((item) => previewReferencePayload(item)) };
  if (!isRecord(payload)) return payload;
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 8)) {
    if (typeof value === 'string' && isDataUrl(value)) {
      preview[key] = '[image dataUrl omitted; use file/image refs instead]';
    } else if (typeof value === 'string') {
      preview[key] = clipPromptText(value, 360);
    } else if (Array.isArray(value)) {
      preview[key] = { count: value.length, preview: value.slice(0, 4).map((item) => previewReferencePayload(item)) };
    } else if (isRecord(value)) {
      preview[key] = previewReferencePayload(value);
    } else {
      preview[key] = value;
    }
  }
  return preview;
}

function summarizeArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.slice(-8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    metadata: previewReferencePayload(artifact.metadata),
    dataRef: artifact.dataRef,
    path: artifact.path,
    fileRefs: collectArtifactFileRefs(artifact),
    imageMemoryRefs: collectArtifactImageMemoryRefs(artifact),
    dataPreview: previewArtifactData(artifact.data),
  }));
}

function buildArtifactAccessPolicy(input: SendAgentMessageInput, artifacts: ReturnType<typeof summarizeArtifacts>) {
  const maxArtifactInlineChars = Math.max(800, Math.min(2400, Math.floor((input.config.maxContextWindowTokens || 200_000) * 0.012)));
  const explicitRefs = uniqueStrings((input.references ?? []).map((reference) => reference.ref).filter(Boolean)).slice(0, 12);
  const reusableArtifactRefs = uniqueStrings(artifacts.flatMap((artifact) => [
    artifact.id ? `artifact:${artifact.id}` : undefined,
    artifact.path ? `file:${artifact.path}` : undefined,
    artifact.dataRef ? `file:${artifact.dataRef}` : undefined,
    ...(artifact.fileRefs ?? []).map((ref) => `file:${ref}`),
    ...(artifact.imageMemoryRefs ?? []).map((ref) => `file:${ref}`),
  ]).filter((ref): ref is string => Boolean(ref))).slice(0, 32);
  return {
    mode: 'refs-first-bounded-read',
    purpose: 'reuse prior work without replaying full artifact payloads into model context',
    maxArtifactInlineChars,
    defaultAction: 'Use artifact ids, paths, metadata, and dataPreview before opening files.',
    readPolicy: [
      'Do not cat or paste full JSON/markdown/log artifacts unless the current user explicitly asks for full content.',
      'For verification, prefer bounded reads: file metadata, schema keys, counts, jq-selected fields, head/tail, or concise excerpts.',
      'When comparing large artifacts, read only the fields needed for the current question and cite the artifact/ref path.',
      'For vision/computer-use image memory, use screenshot file refs, thumbnails, hashes, and step summaries; never inline dataUrl/base64 screenshot bytes into model context.',
      'If the summary is enough, answer from refs and dataPreview without reopening the file.',
    ],
    explicitCurrentTurnRefs: explicitRefs,
    reusableArtifactRefs,
  };
}

function previewArtifactData(data: unknown): unknown {
  if (typeof data === 'string') return clipPromptText(data, 600);
  if (Array.isArray(data)) return { valueType: 'array', count: data.length, preview: data.slice(0, 3).map((item) => previewArtifactData(item)) };
  if (!isRecord(data)) return data;
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 8)) {
    if (key === 'dataUrl' && typeof value === 'string' && isDataUrl(value)) {
      preview[key] = '[image dataUrl omitted; use file/image refs instead]';
      continue;
    }
    if (Array.isArray(value)) {
      preview[key] = { count: value.length, preview: value.slice(0, 3).map((item) => previewArtifactData(item)) };
    } else if (typeof value === 'string') {
      preview[key] = clipPromptText(value, 600);
    } else if (isRecord(value)) {
      preview[key] = previewArtifactData(value);
    } else {
      preview[key] = value;
    }
  }
  const imageMemory = summarizeVisionImageMemory(data);
  if (imageMemory) preview.imageMemory = imageMemory;
  return preview;
}

function clipPromptText(value: unknown, limit: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function selectedRuntimeToolInstructions(input: SendAgentMessageInput) {
  const contracts = selectedRuntimeToolContracts(input.scenarioOverride?.selectedToolIds ?? []);
  if (!contracts.length) return '';
  return [
    '用户激活的可用工具契约:',
    JSON.stringify(contracts, null, 2),
    '如果 local.vision-sense 被激活，按 text + screenshot/image modalities -> text 的 sense-plugin 使用；只输出可审计 Computer Use 文字信号或 vision-trace refs，不读取 DOM/accessibility，不把截图 base64 放入多轮上下文，高风险 GUI 动作必须拒绝或要求上游确认。',
  ].join('\n');
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
      return previewReferencePayload({
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

function looksLikeRef(value: string) {
  return /\.sciforge\/|stdout|stderr|output|input|\.json|\.log|\.py|\.ipynb|\.r|\.png|\.jpe?g|\.gif|\.webp|\.svg$/i.test(value);
}

function isImageMemoryRef(value: string) {
  return !isDataUrl(value) && /(?:^artifact:|^file:|\.sciforge\/|\.bioagent\/|workspace:\/\/|\/).*\.(?:png|jpe?g|gif|webp|svg)$/i.test(value);
}

function isDataUrl(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function selectedRuntimeToolContracts(selectedToolIds: string[]) {
  return uniqueStrings(selectedToolIds).flatMap((toolId) => {
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
        formats: ['application/json', 'application/x-ndjson', 'text/x-computer-use-command'],
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

function buildRuntimeConfig(input: SendAgentMessageInput): NonNullable<AgentServerRunPayload['runtime']> {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const provider = input.config.modelProvider.trim();
  const modelName = input.config.modelName.trim();
  const modelBaseUrl = input.config.modelBaseUrl.trim().replace(/\/+$/, '');
  const useNative = !provider || provider === 'native';
  const runtime: NonNullable<AgentServerRunPayload['runtime']> = {
    backend: normalizeAgentBackend(input.config.agentBackend),
    cwd: input.config.workspacePath,
    metadata: {
      sciForgeScenario: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      skillDomain: input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain,
      nativeToolFirst: true,
      maxContextWindowTokens: input.config.maxContextWindowTokens,
      selectedToolIds: input.scenarioOverride?.selectedToolIds ?? [],
      selectedToolContracts: selectedRuntimeToolContracts(input.scenarioOverride?.selectedToolIds ?? []),
      autoApprove: true,
      sandbox: 'danger-full-access',
    },
  };
  if (!useNative) runtime.modelProvider = provider;
  if (modelName) runtime.modelName = modelName;
  if (!useNative || modelBaseUrl || modelName || input.config.apiKey.trim()) {
    runtime.llmEndpoint = {
      provider: useNative ? 'native' : provider,
      baseUrl: modelBaseUrl || undefined,
      apiKey: input.config.apiKey.trim() || undefined,
      modelName: modelName || undefined,
    };
  }
  return runtime;
}

function normalizeAgentBackend(value: string): AgentBackendId {
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'].includes(value)
    ? value as AgentBackendId
    : 'codex';
}

function normalizeStreamEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const type = asString(record.type) || asString(record.kind) || 'event';
  const usage = normalizeTokenUsage(record.usage)
    ?? normalizeTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextWindowState = normalizeContextWindowState(contextWindowCandidate(record), type, record);
  const contextCompaction = normalizeContextCompaction(record.contextCompaction ?? record.compaction ?? record.context_compaction, type, record);
  const baseDetail = asString(record.message)
    || asString(record.detail)
    || asString(record.status)
    || asString(record.error)
    || (Object.keys(record).length ? JSON.stringify(record) : undefined);
  const usageDetail = formatTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    id: makeId('evt'),
    type,
    label: streamEventLabel(type),
    detail,
    usage,
    contextWindowState,
    contextCompaction,
    createdAt: nowIso(),
    raw,
  };
}

function withConfiguredContextWindowLimit(event: AgentStreamEvent, maxContextWindowTokens: number): AgentStreamEvent {
  const state = event.contextWindowState;
  if (!state || state.windowTokens !== undefined || !maxContextWindowTokens) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / maxContextWindowTokens : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: maxContextWindowTokens,
      windowTokens: maxContextWindowTokens,
      ratio,
      status: normalizeContextWindowStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

function normalizeContextWindowState(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = asNumber(record.input) ?? asNumber(record.inputTokens) ?? asNumber(usage.input) ?? asNumber(usage.promptTokens);
  const output = asNumber(record.output) ?? asNumber(record.outputTokens) ?? asNumber(usage.output) ?? asNumber(usage.completionTokens);
  const cacheRead = asNumber(record.cacheRead) ?? asNumber(record.cacheReadTokens) ?? asNumber(usage.cacheRead);
  const cacheWrite = asNumber(record.cacheWrite) ?? asNumber(record.cacheWriteTokens) ?? asNumber(usage.cacheWrite);
  const cache = asNumber(record.cache) ?? asNumber(record.cacheTokens) ?? asNumber(usage.cache) ?? (
    cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined
  );
  const explicitUsedTokens = asNumber(record.usedTokens) ?? asNumber(record.used) ?? asNumber(record.contextWindowTokens) ?? asNumber(record.currentContextWindowTokens) ?? asNumber(record.context_window_tokens) ?? asNumber(record.current_context_window_tokens);
  const usedTokens = explicitUsedTokens;
  const windowTokens = asNumber(record.windowTokens) ?? asNumber(record.window) ?? asNumber(record.contextWindowLimit) ?? asNumber(record.context_window_limit) ?? asNumber(record.limit) ?? asNumber(record.contextWindow);
  const ratio = clampRatio(asNumber(record.ratio) ?? asNumber(record.contextWindowRatio) ?? (
    usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined
  ));
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || asNumber(usage.total) !== undefined;
  const hasContextTelemetry = explicitUsedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = asString(record.source) ?? asString(record.contextWindowSource) ?? asString(record.context_window_source);
  const source = explicitSource
    ? (normalizeContextWindowSource(explicitSource) === 'unknown' && hasUsage ? 'provider-usage' : normalizeContextWindowSource(explicitSource))
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: asString(record.backend) ?? asString(usage.provider),
    provider: asString(record.provider) ?? asString(usage.provider),
    model: asString(record.model) ?? asString(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeContextWindowStatus(asString(record.status), ratio, clampRatio(asNumber(record.autoCompactThreshold))),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
    budget: normalizeContextBudget(record.budget),
    auditRefs: asStringArray(record.auditRefs),
    autoCompactThreshold: clampRatio(asNumber(record.autoCompactThreshold)),
    watchThreshold: clampRatio(asNumber(record.watchThreshold)),
    nearLimitThreshold: clampRatio(asNumber(record.nearLimitThreshold)),
    lastCompactedAt: asString(record.lastCompactedAt),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry
    ? state
    : undefined;
}

function contextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? (isExplicitContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitContextWindowRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [
    'usedTokens',
    'used_tokens',
    'contextWindowTokens',
    'context_window_tokens',
    'currentContextWindowTokens',
    'current_context_window_tokens',
    'contextLength',
    'context_length',
    'currentContextLength',
    'current_context_length',
    'windowTokens',
    'window_tokens',
    'contextWindowLimit',
    'context_window_limit',
    'modelContextWindow',
    'model_context_window',
    'contextWindowRatio',
    'context_window_ratio',
    'contextWindowSource',
    'context_window_source',
  ].some((key) => key in value);
}

function normalizeContextCompaction(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const isTag = record.kind === 'compaction' || record.kind === 'partial_compaction';
  const completedAt = asString(record.completedAt) ?? (isTag ? asString(record.createdAt) : undefined);
  const lastCompactedAt = asString(record.lastCompactedAt) ?? completedAt;
  const message = asString(record.message) ?? asString(record.userVisibleSummary) ?? asString(record.detail)
    ?? (isTag ? `${record.kind === 'partial_compaction' ? 'partial' : 'full'} compaction tag ${asString(record.id) ?? ''}`.trim() : undefined);
  const status = normalizeCompactionStatus(asString(record.status), {
    ok: asBoolean(record.ok) ?? (isTag ? true : undefined),
    completedAt,
    lastCompactedAt,
    message,
  });
  return {
    status,
    source: normalizeContextWindowSource(asString(record.source)),
    backend: asString(record.backend),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability) ?? (isTag ? 'agentserver' : undefined)),
    before: normalizeContextWindowState(record.before, 'contextWindowState', {}),
    after: normalizeContextWindowState(record.after, 'contextWindowState', {}),
    auditRefs: asStringArray(record.auditRefs) ?? (isTag && asString(record.id) ? [`agentserver-compaction:${asString(record.id)}`] : undefined),
    startedAt: asString(record.startedAt),
    completedAt,
    lastCompactedAt,
    reason: asString(record.reason) ?? (isTag ? 'agentserver-compact' : undefined),
    message,
  };
}

function normalizeContextWindowSource(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['source'] {
  if (value === 'native' || value === 'provider-usage' || value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'backend') return 'native';
  if (value === 'handoff') return 'agentserver-estimate';
  return 'unknown';
}

function normalizeCompactCapability(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (value === 'native' || value === 'agentserver' || value === 'handoff-only' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

function compactCapabilityForBackend(backend: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

function normalizeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<AgentStreamEvent['contextWindowState']>['status'] {
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82) && (!value || value === 'healthy' || value === 'ok' || value === 'normal')) return 'near-limit';
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

function normalizeContextBudget(value: unknown): NonNullable<AgentStreamEvent['contextWindowState']>['budget'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    rawRef: asString(value.rawRef),
    rawSha1: asString(value.rawSha1),
    rawBytes: asNumber(value.rawBytes),
    normalizedBytes: asNumber(value.normalizedBytes),
    maxPayloadBytes: asNumber(value.maxPayloadBytes),
    rawTokens: asNumber(value.rawTokens),
    normalizedTokens: asNumber(value.normalizedTokens),
    savedTokens: asNumber(value.savedTokens),
    normalizedBudgetRatio: clampRatio(asNumber(value.normalizedBudgetRatio)),
    decisions: Array.isArray(value.decisions) ? value.decisions.filter(isRecord) : undefined,
  };
}

function normalizeCompactionStatus(
  value?: string,
  inferred: { ok?: boolean; completedAt?: string; lastCompactedAt?: string; message?: string } = {},
): NonNullable<AgentStreamEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value === 'compacted') return 'completed';
  if (value === 'unsupported') return 'skipped';
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /skip|unsupported|handoff/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compact(ed)?|compressed/i.test(value)) return 'completed';
  if (inferred.ok === true || inferred.completedAt || inferred.lastCompactedAt || (inferred.message && /complete|done|success|compact(ed)?|compressed|完成/i.test(inferred.message))) return 'completed';
  if (inferred.ok === false || (inferred.message && /fail|error|失败|未完成/i.test(inferred.message))) return 'failed';
  return 'pending';
}

function clampRatio(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1.5, value));
}

function normalizeTokenUsage(value: unknown): AgentStreamEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: asNumber(value.input),
    output: asNumber(value.output),
    total: asNumber(value.total),
    cacheRead: asNumber(value.cacheRead),
    cacheWrite: asNumber(value.cacheWrite),
    provider: asString(value.provider),
    model: asString(value.model),
    source: asString(value.source),
  };
  if (
    usage.input === undefined
    && usage.output === undefined
    && usage.total === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) {
    return undefined;
  }
  return usage;
}

function formatTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
  if (!usage) return undefined;
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

function streamEventLabel(type: string) {
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type.includes('start')) return '开始';
  if (type.includes('delta') || type.includes('token')) return '生成中';
  if (type.includes('tool')) return '工具事件';
  if (type.includes('error')) return '错误';
  if (type.includes('complete') || type.includes('done')) return '完成';
  return type;
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Natural-language answers are valid; JSON is optional.
    }
  }
  return undefined;
}

function readableMessageFromStructured(structured: Record<string, unknown>, fallback: string) {
  const direct = asString(structured.message);
  if (direct && !looksLikeRawJson(direct)) return direct;
  const report = reportMarkdownFromArtifacts(structured.artifacts);
  if (report) return report;
  const markdown = reportMarkdownFromPayload(structured);
  if (markdown) return markdown;
  return direct || fallback;
}

function reportMarkdownFromArtifacts(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'research-report') continue;
    const markdown = reportMarkdownFromPayload(isRecord(item.data) ? item.data : item);
    if (markdown) return markdown;
  }
  return undefined;
}

function reportMarkdownFromPayload(payload: Record<string, unknown>): string | undefined {
  const nested = parseReportPayload(payload) ?? payload;
  const direct = asString(nested.markdown) || asString(nested.report) || asString(nested.summary) || asString(nested.content);
  if (direct && !looksLikeRawJson(direct)) return direct;
  const sections = Array.isArray(nested.sections) ? nested.sections.filter(isRecord) : [];
  if (sections.length) {
    return sections.map((section, index) => {
      const title = asString(section.title) || `Section ${index + 1}`;
      const content = asString(section.content) || asString(section.markdown) || readableRecord(section);
      return `## ${title}\n\n${content}`;
    }).join('\n\n');
  }
  return undefined;
}

function parseReportPayload(payload: Record<string, unknown>) {
  for (const key of ['data', 'content', 'report', 'result']) {
    const value = payload[key];
    if (isRecord(value)) return value;
    if (typeof value !== 'string' || !value.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return isRecord(parsed.data) ? parsed.data : parsed;
    } catch {
      // Keep natural-language report strings unchanged.
    }
  }
  return undefined;
}

function readableRecord(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => {
      if (typeof value === 'string') return `**${key}:** ${value}`;
      if (Array.isArray(value)) return `**${key}:**\n${value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `**${key}:** ${String(value)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function looksLikeRawJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

function extractOutputText(data: unknown): string {
  if (!isRecord(data)) return String(data ?? '');
  const run = isRecord(data.run) ? data.run : undefined;
  const output = isRecord(run?.output) ? run?.output : isRecord(data.output) ? data.output : undefined;
  return (
    asString(output?.result) ||
    asString(output?.text) ||
    asString(output?.message) ||
    asString(output?.error) ||
    asString(data.message) ||
    asString(data.result) ||
    'AgentServer 已返回结果，但响应中没有可展示文本。'
  );
}

function normalizeExecutionUnits(value: unknown, fallback: RuntimeExecutionUnit): RuntimeExecutionUnit[] {
  if (!Array.isArray(value)) return [fallback];
  const units = value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: asString(record.id) || `${fallback.id}-${index + 1}`,
      tool: asString(record.tool) || asString(record.name) || fallback.tool,
      params: asString(record.params) || JSON.stringify(record.params ?? record.input ?? {}),
      status: isExecutionUnitStatus(record.status)
        ? record.status
        : 'failed-with-reason',
      hash: asString(record.hash) || fallback.hash,
      code: asString(record.code) || asString(record.command),
      language: asString(record.language),
      codeRef: asString(record.codeRef),
      entrypoint: asString(record.entrypoint),
      stdoutRef: asString(record.stdoutRef),
      stderrRef: asString(record.stderrRef),
      outputRef: asString(record.outputRef),
      attempt: asNumber(record.attempt),
      parentAttempt: asNumber(record.parentAttempt),
      selfHealReason: asString(record.selfHealReason),
      patchSummary: asString(record.patchSummary),
      diffRef: asString(record.diffRef),
      failureReason: asString(record.failureReason),
      seed: asNumber(record.seed) ?? asNumber(record.randomSeed),
      time: asString(record.time),
      environment: asString(record.environment),
      inputData: asStringArray(record.inputData) ?? asStringArray(record.inputs),
      dataFingerprint: asString(record.dataFingerprint),
      databaseVersions: asStringArray(record.databaseVersions),
      artifacts: asStringArray(record.artifacts),
      outputArtifacts: asStringArray(record.outputArtifacts),
      scenarioPackageRef: isScenarioPackageRef(record.scenarioPackageRef) ? record.scenarioPackageRef : undefined,
      skillPlanRef: asString(record.skillPlanRef),
      uiPlanRef: asString(record.uiPlanRef),
      runtimeProfileId: asString(record.runtimeProfileId),
      routeDecision: normalizeRouteDecision(record.routeDecision),
      requiredInputs: asStringArray(record.requiredInputs),
      recoverActions: asStringArray(record.recoverActions),
      nextStep: asString(record.nextStep),
    } satisfies RuntimeExecutionUnit;
  });
  return units.length ? units : [fallback];
}

function isScenarioPackageRef(value: unknown): value is RuntimeExecutionUnit['scenarioPackageRef'] {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.version === 'string'
    && (value.source === 'built-in' || value.source === 'workspace' || value.source === 'generated');
}

function normalizeRouteDecision(value: unknown): RuntimeExecutionUnit['routeDecision'] {
  if (!isRecord(value)) return undefined;
  return {
    selectedSkill: asString(value.selectedSkill),
    selectedRuntime: asString(value.selectedRuntime),
    fallbackReason: asString(value.fallbackReason),
    selectedAt: asString(value.selectedAt) || nowIso(),
  };
}

function isExecutionUnitStatus(value: unknown) {
  return value === 'done'
    || value === 'running'
    || value === 'failed'
    || value === 'planned'
    || value === 'record-only'
    || value === 'repair-needed'
    || value === 'self-healed'
    || value === 'failed-with-reason';
}

export function normalizeAgentResponse(
  scenarioId: ScenarioInstanceId,
  prompt: string,
  raw: unknown,
): NormalizedAgentResponse {
  const data = isRecord(raw) && raw.ok === true && 'data' in raw ? raw.data : raw;
  const root = isRecord(data) ? data : {};
  const runRecord = isRecord(root.run) ? root.run : {};
  const outputText = extractOutputText(root);
  const structured = extractJsonObject(outputText) ?? payloadLikeRecord(root) ?? {};
  const now = nowIso();
  const runId = asString(runRecord.id) || makeId('run');
  const runStatus = runRecord.status === 'failed' ? 'failed' : 'completed';
  const cleanOutputText = outputText.replace(/```(?:json)?[\s\S]*?```/gi, '').trim() || outputText;
  const hasStructuredOutput = Object.keys(structured).length > 0;
  const messageText = runStatus === 'failed' && !hasStructuredOutput
    ? `AgentServer 后端运行失败：${cleanOutputText}`
    : readableMessageFromStructured(structured, cleanOutputText);
  const confidence = asNumber(structured.confidence) ?? 0.78;
  const claimType = pickClaimType(structured.claimType);
  const evidence = pickEvidence(structured.evidenceLevel ?? structured.evidence);
  const fallbackExecutionUnit: RuntimeExecutionUnit = {
    id: `EU-${runId.slice(-6)}`,
    tool: `${scenarioId}.scenario-server-run`,
    params: `prompt=${prompt.slice(0, 80)}`,
    status: runStatus === 'completed' ? 'done' : 'failed',
    hash: runId.slice(0, 10),
    time: asString(runRecord.completedAt) ? 'archived' : undefined,
  };

  const claims = Array.isArray(structured.claims) ? structured.claims.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: asString(record.id) || makeId('claim'),
      text: asString(record.text) || asString(record.claim) || messageText,
      type: pickClaimType(record.type),
      confidence: asNumber(record.confidence) ?? confidence,
      evidenceLevel: pickEvidence(record.evidenceLevel ?? record.evidence),
      supportingRefs: Array.isArray(record.supportingRefs) ? record.supportingRefs.filter((entry): entry is string => typeof entry === 'string') : [],
      opposingRefs: Array.isArray(record.opposingRefs) ? record.opposingRefs.filter((entry): entry is string => typeof entry === 'string') : [],
      dependencyRefs: asStringArray(record.dependencyRefs),
      updateReason: asString(record.updateReason),
      updatedAt: now,
    };
  }) : [{
    id: makeId('claim'),
    text: messageText.split('\n')[0] || messageText,
    type: claimType,
    confidence,
    evidenceLevel: evidence,
    supportingRefs: [],
    opposingRefs: [],
    updatedAt: now,
  }];
  const artifacts = normalizeRuntimeArtifacts(structured.artifacts, scenarioId);
  const objectReferences = normalizeObjectReferences(structured.objectReferences, artifacts, runId);
  const normalizedRaw = withRuntimePresentationMetadata(raw, structured, objectReferences);

  return {
    message: {
      id: makeId('msg'),
      role: 'scenario',
      content: messageText,
      confidence,
      evidence,
      claimType,
      expandable: asString(structured.reasoningTrace) || asString(structured.reasoning) || `AgentServer run: ${runId}\nStatus: ${asString(runRecord.status) || 'completed'}`,
      createdAt: now,
      status: runStatus,
      objectReferences,
    },
    run: {
      id: runId,
      scenarioId,
      status: runStatus,
      prompt,
      response: messageText,
      createdAt: asString(runRecord.createdAt) || now,
      completedAt: asString(runRecord.completedAt) || now,
      raw: normalizedRaw,
      objectReferences,
    },
    uiManifest: Array.isArray(structured.uiManifest) ? structured.uiManifest.filter(isRecord).map((slot) => ({
      componentId: asString(slot.componentId) || asString(slot.id) || 'paper-card-list',
      title: asString(slot.title),
      props: isRecord(slot.props) ? slot.props : undefined,
      artifactRef: asString(slot.artifactRef),
      priority: asNumber(slot.priority),
      encoding: isRecord(slot.encoding) ? slot.encoding : undefined,
      layout: isRecord(slot.layout) ? slot.layout : undefined,
      selection: isRecord(slot.selection) ? slot.selection : undefined,
      sync: isRecord(slot.sync) ? slot.sync : undefined,
      transform: Array.isArray(slot.transform) ? slot.transform.filter(isViewTransform) : undefined,
      compare: isRecord(slot.compare) ? slot.compare : undefined,
    })) : [],
    claims,
    executionUnits: normalizeExecutionUnits(structured.executionUnits, fallbackExecutionUnit),
    artifacts,
    notebook: normalizeNotebookRecords(structured.notebook, {
      scenarioId,
      prompt,
      messageText,
      claimType,
      confidence,
      now,
      claims,
      artifacts: Array.isArray(structured.artifacts) ? structured.artifacts.filter(isRecord) : [],
      executionUnits: Array.isArray(structured.executionUnits) ? structured.executionUnits.filter(isRecord) : [],
    }),
  };
}

function payloadLikeRecord(value: Record<string, unknown>) {
  if (Array.isArray(value.artifacts) || Array.isArray(value.uiManifest) || Array.isArray(value.objectReferences) || isRecord(value.displayIntent)) return value;
  const output = isRecord(value.output) ? value.output : undefined;
  if (output && (Array.isArray(output.artifacts) || Array.isArray(output.uiManifest) || Array.isArray(output.objectReferences) || isRecord(output.displayIntent))) return output;
  return undefined;
}

function normalizeRuntimeArtifacts(value: unknown, scenarioId: ScenarioInstanceId): RuntimeArtifact[] {
  return Array.isArray(value) ? value.filter(isRecord).map((artifact) => {
    const artifactType = asString(artifact.type) || 'scenario-output';
    return {
      id: asString(artifact.id) || artifactType || makeId('artifact'),
      type: artifactType,
      producerScenario: scenarioId,
      schemaVersion: asString(artifact.schemaVersion) || '1',
      metadata: isRecord(artifact.metadata) ? artifact.metadata : undefined,
      data: normalizeArtifactData(artifactType, artifact),
      dataRef: asString(artifact.dataRef),
      path: asString(artifact.path),
      visibility: asTimelineVisibility(artifact.visibility),
      audience: asStringArray(artifact.audience),
      sensitiveDataFlags: asStringArray(artifact.sensitiveDataFlags),
      exportPolicy: asExportPolicy(artifact.exportPolicy),
    };
  }) : [];
}

function normalizeObjectReferences(value: unknown, artifacts: RuntimeArtifact[], runId: string): ObjectReference[] {
  const explicit = Array.isArray(value)
    ? value.filter(isRecord).flatMap((record) => {
      const normalized = normalizeObjectReference(record, artifacts, runId);
      return normalized ? [normalized] : [];
    })
    : [];
  const autoIndexed = artifacts.map((artifact) => objectReferenceFromArtifact(artifact, runId));
  const byRef = new Map<string, ObjectReference>();
  for (const reference of [...explicit, ...autoIndexed]) {
    const key = reference.ref || reference.id;
    if (!byRef.has(key)) {
      byRef.set(key, reference);
      continue;
    }
    byRef.set(key, {
      ...reference,
      ...byRef.get(key),
      actions: uniqueStringList([...(byRef.get(key)?.actions ?? []), ...(reference.actions ?? [])]) as ObjectAction[],
    });
  }
  return Array.from(byRef.values()).slice(0, 16);
}

function normalizeObjectReference(record: Record<string, unknown>, artifacts: RuntimeArtifact[], runId: string): ObjectReference | undefined {
  const ref = asString(record.ref)
    || objectRefFromRecord(record);
  if (!ref) return undefined;
  const kind = normalizeObjectKind(record.kind) ?? inferObjectKindFromRef(ref);
  if (!kind) return undefined;
  const matchedArtifact = kind === 'artifact' ? findArtifactForObjectRef(ref, artifacts) : undefined;
  const title = asString(record.title)
    || asString(matchedArtifact?.metadata?.title)
    || matchedArtifact?.id
    || ref.replace(/^[a-z-]+:/i, '');
  const actions = normalizeObjectActions(record.actions, kind, matchedArtifact);
  return {
    id: asString(record.id) || stableObjectId(ref),
    title,
    kind,
    ref,
    artifactType: asString(record.artifactType) || matchedArtifact?.type,
    runId: asString(record.runId) || runId,
    executionUnitId: asString(record.executionUnitId),
    preferredView: asString(record.preferredView) || preferredViewForArtifactType(matchedArtifact?.type),
    actions,
    status: normalizeObjectStatus(record.status) || 'available',
    summary: asString(record.summary),
    provenance: normalizeObjectProvenance(record.provenance, matchedArtifact),
  };
}

function objectReferenceFromArtifact(artifact: RuntimeArtifact, runId: string): ObjectReference {
  const path = artifact.path || asString(artifact.metadata?.path) || asString(artifact.metadata?.filePath);
  return {
    id: stableObjectId(`artifact:${artifact.id}`),
    title: asString(artifact.metadata?.title) || artifact.id || artifact.type,
    kind: 'artifact',
    ref: `artifact:${artifact.id}`,
    artifactType: artifact.type,
    runId,
    preferredView: preferredViewForArtifactType(artifact.type),
    actions: objectActionsForArtifact(artifact),
    status: 'available',
    summary: artifactSummary(artifact),
    provenance: {
      dataRef: artifact.dataRef,
      path,
      producer: asString(artifact.metadata?.producer) || asString(artifact.metadata?.executionUnitId),
      version: artifact.schemaVersion,
      hash: asString(artifact.metadata?.hash),
      size: asNumber(artifact.metadata?.size),
    },
  };
}

function objectRefFromRecord(record: Record<string, unknown>) {
  const artifactId = asString(record.artifactId) || asString(record.artifactRef);
  if (artifactId) return artifactId.startsWith('artifact:') ? artifactId : `artifact:${artifactId}`;
  const path = asString(record.path) || asString(record.filePath);
  if (path) return `${record.kind === 'folder' ? 'folder' : 'file'}:${path}`;
  const url = asString(record.url);
  if (url) return `url:${url}`;
  return undefined;
}

function normalizeObjectKind(value: unknown): ObjectReferenceKind | undefined {
  const kind = asString(value);
  if (kind === 'artifact' || kind === 'file' || kind === 'folder' || kind === 'run' || kind === 'execution-unit' || kind === 'url' || kind === 'scenario-package') return kind;
  return undefined;
}

function inferObjectKindFromRef(ref: string): ObjectReferenceKind | undefined {
  const prefix = ref.split(':', 1)[0]?.toLowerCase();
  if (prefix === 'artifact' || prefix === 'file' || prefix === 'folder' || prefix === 'run' || prefix === 'execution-unit' || prefix === 'url' || prefix === 'scenario-package') return prefix;
  if (/^https?:\/\//i.test(ref)) return 'url';
  return undefined;
}

function normalizeObjectActions(value: unknown, kind: ObjectReferenceKind, artifact?: RuntimeArtifact): ObjectAction[] {
  const allowed = ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare'];
  const declared = Array.isArray(value) ? value.filter((item): item is ObjectAction => typeof item === 'string' && allowed.includes(item)) : [];
  const defaults: ObjectAction[] = kind === 'artifact'
    ? objectActionsForArtifact(artifact)
    : kind === 'file' || kind === 'folder'
      ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin']
      : kind === 'url'
        ? ['focus-right-pane', 'copy-path', 'pin']
        : ['focus-right-pane', 'pin'];
  return uniqueStringList([...declared, ...defaults]) as ObjectAction[];
}

function objectActionsForArtifact(artifact?: RuntimeArtifact): ObjectAction[] {
  const fileLike = Boolean(artifact?.path || artifact?.metadata?.path || artifact?.metadata?.filePath || artifact?.metadata?.localPath);
  return fileLike
    ? ['focus-right-pane', 'inspect', 'open-external', 'reveal-in-folder', 'copy-path', 'pin', 'compare']
    : ['focus-right-pane', 'inspect', 'pin', 'compare'];
}

function normalizeObjectStatus(value: unknown): ObjectReference['status'] | undefined {
  const status = asString(value);
  if (status === 'available' || status === 'missing' || status === 'expired' || status === 'blocked' || status === 'external') return status;
  return undefined;
}

function normalizeObjectProvenance(value: unknown, artifact?: RuntimeArtifact): ObjectReference['provenance'] {
  const record = isRecord(value) ? value : {};
  const path = asString(record.path) || artifact?.path || asString(artifact?.metadata?.path) || asString(artifact?.metadata?.filePath);
  return {
    dataRef: asString(record.dataRef) || artifact?.dataRef,
    path,
    producer: asString(record.producer) || asString(artifact?.metadata?.producer) || asString(artifact?.metadata?.executionUnitId),
    version: asString(record.version) || artifact?.schemaVersion,
    hash: asString(record.hash) || asString(artifact?.metadata?.hash),
    size: asNumber(record.size) ?? asNumber(artifact?.metadata?.size),
  };
}

function findArtifactForObjectRef(ref: string, artifacts: RuntimeArtifact[]) {
  const id = ref.replace(/^artifact:/i, '');
  return artifacts.find((artifact) => artifact.id === id || artifact.type === id || artifact.dataRef === id || artifact.path === id);
}

function preferredViewForArtifactType(type?: string) {
  if (!type) return undefined;
  if (/structure|pdb|protein|molecule|mmcif|cif|3d/i.test(type)) return 'molecule-viewer';
  if (/report|markdown|document|summary/i.test(type)) return 'report-viewer';
  if (/evidence/i.test(type)) return 'evidence-matrix-panel';
  if (/paper|literature/i.test(type)) return 'literature-paper-cards';
  if (/network|graph|knowledge/i.test(type)) return 'network-graph';
  if (/table|matrix|csv|tsv|dataframe/i.test(type)) return 'generic-data-table';
  return 'generic-artifact-inspector';
}

function artifactSummary(artifact: RuntimeArtifact) {
  const rows = isRecord(artifact.data) ? asNumber(artifact.data.rows) : undefined;
  const count = Array.isArray(artifact.data) ? artifact.data.length : rows;
  return `${artifact.type}${count ? ` · ${count} records` : ''}`;
}

function stableObjectId(ref: string) {
  return `obj-${ref.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || makeId('ref')}`;
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function withRuntimePresentationMetadata(raw: unknown, structured: Record<string, unknown>, objectReferences: ObjectReference[]) {
  const metadata = {
    displayIntent: isRecord(structured.displayIntent) ? structured.displayIntent : undefined,
    objectReferences,
  };
  if (isRecord(raw)) return { ...raw, ...metadata };
  return { raw, ...metadata };
}

function normalizeArtifactData(type: string, artifact: Record<string, unknown>) {
  const data = 'data' in artifact
    ? artifact.data
    : artifact.content ?? artifact.markdown ?? artifact.report ?? artifact.summary;
  const encoding = asString(artifact.encoding) || asString(isRecord(artifact.metadata) ? artifact.metadata.encoding : undefined);
  if (typeof data === 'string' && isTextLikeArtifact(type, encoding)) {
    return {
      markdown: data,
      text: data,
      report: data,
    };
  }
  if (typeof data === 'string' && isJsonLikeArtifact(type, encoding)) {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return {
        text: data,
      };
    }
  }
  return data;
}

function isTextLikeArtifact(type: string, encoding?: string) {
  return /markdown|md|text/i.test(encoding || '')
    || /report|summary|notebook|document|markdown|text|note|protocol|plan|narrative/i.test(type);
}

function isJsonLikeArtifact(type: string, encoding?: string) {
  return /json/i.test(encoding || '')
    || /list|table|matrix|graph|records|items|rows/i.test(type);
}

function normalizeNotebookRecords(
  value: unknown,
    fallback: {
    scenarioId: ScenarioInstanceId;
    prompt: string;
    messageText: string;
    claimType: ClaimType;
    confidence: number;
    now: string;
    claims: Array<{ id: string; dependencyRefs?: string[]; updateReason?: string }>;
    artifacts: Record<string, unknown>[];
    executionUnits: Record<string, unknown>[];
  },
) {
  const defaultRecord = {
    id: makeId('note'),
    time: new Date(fallback.now).toLocaleString('zh-CN', { hour12: false }),
    scenario: fallback.scenarioId,
    title: fallback.prompt.slice(0, 32) || 'Scenario 对话',
    desc: fallback.messageText.slice(0, 96),
    claimType: fallback.claimType,
    confidence: fallback.confidence,
    artifactRefs: fallback.artifacts.map((artifact) => asString(artifact.id) || asString(artifact.type)).filter((item): item is string => Boolean(item)),
    executionUnitRefs: fallback.executionUnits.map((unit) => asString(unit.id) || asString(unit.tool)).filter((item): item is string => Boolean(item)),
    beliefRefs: fallback.claims.map((claim) => claim.id).filter(Boolean),
    dependencyRefs: uniqueStrings(fallback.claims.flatMap((claim) => claim.dependencyRefs ?? [])),
    updateReason: fallback.claims.map((claim) => claim.updateReason).find(Boolean),
  };
  if (!Array.isArray(value)) return [defaultRecord];
  const records = value.filter(isRecord).map((record) => ({
    id: asString(record.id) || makeId('note'),
    time: asString(record.time) || new Date(fallback.now).toLocaleString('zh-CN', { hour12: false }),
    scenario: asString(record.scenario) || fallback.scenarioId,
    title: asString(record.title) || fallback.prompt.slice(0, 32) || 'Scenario 对话',
    desc: asString(record.desc) || asString(record.description) || fallback.messageText.slice(0, 96),
    claimType: pickClaimType(record.claimType),
    confidence: asNumber(record.confidence) ?? fallback.confidence,
    artifactRefs: asStringArray(record.artifactRefs),
    executionUnitRefs: asStringArray(record.executionUnitRefs),
    beliefRefs: asStringArray(record.beliefRefs),
    dependencyRefs: asStringArray(record.dependencyRefs),
    updateReason: asString(record.updateReason),
  }));
  return records.length ? records : [defaultRecord];
}

function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  if (isScenarioId(input.scenarioId)) return input.scenarioId;
  const skillDomain = input.scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  return 'literature-evidence-review';
}

function isScenarioId(value: unknown): value is ScenarioId {
  return value === 'literature-evidence-review'
    || value === 'structure-exploration'
    || value === 'omics-differential-exploration'
    || value === 'biomedical-knowledge-graph';
}

function uniqueStrings(values: string[] | undefined) {
  return [...new Set(values ?? [])];
}

function asTimelineVisibility(value: unknown) {
  return value === 'private-draft'
    || value === 'team-visible'
    || value === 'project-record'
    || value === 'restricted-sensitive'
    ? value
    : undefined;
}

function asExportPolicy(value: unknown) {
  return value === 'allowed' || value === 'restricted' || value === 'blocked'
    ? value
    : undefined;
}

function isViewTransform(value: unknown) {
  if (!isRecord(value)) return false;
  return value.type === 'filter'
    || value.type === 'sort'
    || value.type === 'limit'
    || value.type === 'group'
    || value.type === 'derive';
}

export async function sendAgentMessage(input: SendAgentMessageInput, signal?: AbortSignal): Promise<NormalizedAgentResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  const linkedAbort = () => controller.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  try {
    const baseUrl = input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL;
    const response = await fetch(`${baseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRunPayload(input)),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep the raw text for diagnostics.
    }
    if (!response.ok) {
      throw new SciForgeClientError({
        title: 'AgentServer 请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-http-${response.status}`,
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, json);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SciForgeClientError({
        title: 'AgentServer 请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new SciForgeClientError({
        title: '无法连接 AgentServer',
        reason: `${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 未响应。`,
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-connection',
        cause: err,
      });
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

export async function sendAgentMessageStream(
  input: SendAgentMessageInput,
  callbacks: {
    onEvent?: (event: AgentStreamEvent) => void;
  } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  const linkedAbort = () => controller.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  try {
    const baseUrl = input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL;
    const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRunPayload(input)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SciForgeClientError({
        title: 'AgentServer 流式请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-stream-http-${response.status}`,
      });
    }
    if (!response.body) {
      throw new SciForgeClientError({
        title: 'AgentServer 流式响应不可读',
        reason: '服务返回了成功状态，但没有可读取的响应体。',
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-stream-body',
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: unknown;
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const envelope = JSON.parse(trimmed) as unknown;
        if (!isRecord(envelope)) continue;
        if ('event' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent(envelope.event),
          input.config.maxContextWindowTokens,
        ));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) {
          callbacks.onEvent?.(withConfiguredContextWindowLimit(
            normalizeStreamEvent({ type: 'error', error: envelope.error }),
            input.config.maxContextWindowTokens,
          ));
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const envelope = JSON.parse(buffer.trim()) as unknown;
      if (isRecord(envelope)) {
        if ('event' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent(envelope.event),
          input.config.maxContextWindowTokens,
        ));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) callbacks.onEvent?.(withConfiguredContextWindowLimit(
          normalizeStreamEvent({ type: 'error', error: envelope.error }),
          input.config.maxContextWindowTokens,
        ));
      }
    }
    if (!finalResult) {
      throw new SciForgeClientError({
        title: 'AgentServer 流式响应不完整',
        reason: '流结束时没有最终 run result。',
        recoverActions: ['查看 AgentServer 日志', '重试当前请求', '改用 workspace/evolved capability 或 workspace runtime'],
        diagnosticRef: 'agentserver-stream-missing-result',
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, { ok: true, data: finalResult });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SciForgeClientError({
        title: 'AgentServer 流式请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-stream-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new SciForgeClientError({
        title: '无法连接 AgentServer stream',
        reason: `${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 未响应。`,
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: 'agentserver-stream-connection',
        cause: err,
      });
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

export async function validateSemanticTurnAcceptance(
  input: SendAgentMessageInput,
  args: {
    snapshot: UserGoalSnapshot;
    response: NormalizedAgentResponse;
    deterministicAcceptance: TurnAcceptance;
  },
  signal?: AbortSignal,
): Promise<SemanticTurnAcceptance | undefined> {
  const controller = new AbortController();
  let abortedByCaller = false;
  const linkedAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  signal?.addEventListener('abort', linkedAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), Math.min(input.config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS, 12_000));
  const baseUrl = (input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL).replace(/\/+$/, '');
  const payload = buildSemanticAcceptancePayload(input, args);
  const endpoints = [
    `${baseUrl}/api/agent-server/turn-acceptance/semantic`,
    `${baseUrl}/api/agent-server/acceptance/semantic`,
  ];
  try {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) continue;
        let json: unknown = text;
        try {
          json = text ? JSON.parse(text) as unknown : {};
        } catch {
          json = { message: text };
        }
        const semantic = normalizeSemanticTurnAcceptance(json);
        if (semantic) return semantic;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError' && abortedByCaller) throw err;
      }
    }
    return undefined;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

function buildSemanticAcceptancePayload(
  input: SendAgentMessageInput,
  args: {
    snapshot: UserGoalSnapshot;
    response: NormalizedAgentResponse;
    deterministicAcceptance: TurnAcceptance;
  },
) {
  return {
    contract: 'sciforge.semantic-turn-acceptance.v1',
    instruction: 'Return only an acceptance judgment. Do not write or rewrite the user-facing final answer.',
    userGoalSnapshot: args.snapshot,
    finalResponse: args.response.message.content,
    objectReferences: args.response.message.objectReferences ?? args.response.run.objectReferences ?? [],
    artifacts: summarizeArtifacts(args.response.artifacts),
    acceptanceFailures: args.deterministicAcceptance.failures,
    deterministicAcceptance: args.deterministicAcceptance,
    runRef: `run:${args.response.run.id}`,
    metadata: {
      project: 'SciForge',
      source: 'sciforge-web-ui',
      sessionId: input.sessionId,
      scenarioId: input.scenarioId,
      agentBackend: input.config.agentBackend,
      workspacePath: input.config.workspacePath,
    },
  };
}

function normalizeSemanticTurnAcceptance(value: unknown): SemanticTurnAcceptance | undefined {
  const root = isRecord(value) && isRecord(value.data) ? value.data : value;
  const record = isRecord(root) && isRecord(root.semanticTurnAcceptance)
    ? root.semanticTurnAcceptance
    : isRecord(root) && isRecord(root.acceptance)
      ? root.acceptance
      : root;
  if (!isRecord(record)) return undefined;
  const pass = asBoolean(record.pass);
  if (pass === undefined) return undefined;
  return {
    pass,
    confidence: Math.max(0, Math.min(1, asNumber(record.confidence) ?? (pass ? 0.75 : 0.5))),
    unmetCriteria: asStringArray(record.unmetCriteria) ?? [],
    missingArtifacts: asStringArray(record.missingArtifacts) ?? [],
    referencedEvidence: asStringArray(record.referencedEvidence) ?? [],
    repairPrompt: asString(record.repairPrompt),
    backendRunRef: asString(record.backendRunRef) ?? asString(record.runRef),
  };
}

export async function compactAgentContext(input: SendAgentMessageInput, reason: string, signal?: AbortSignal): Promise<NonNullable<AgentStreamEvent['contextCompaction']>> {
  const baseUrl = (input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL).replace(/\/+$/, '');
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
  const payload = {
    reason,
    project: 'SciForge',
    source: 'sciforge-web-ui',
    agent: {
      id: scenario.runtimeId,
      backend: normalizeAgentBackend(input.config.agentBackend),
      workspace: input.config.workspacePath,
    },
    contextPolicy: {
      includeCurrentWork: Boolean(input.sessionId),
      includeRecentTurns: Boolean(input.sessionId),
      persistRunSummary: true,
    },
    mode: 'auto',
    decisionBy: 'agent',
    metadata: {
      sessionId: input.sessionId,
      scenarioId: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      modelProvider: input.config.modelProvider,
      modelName: input.config.modelName,
    },
  };
  const endpoints = [
    `${baseUrl}/api/agent-server/compact`,
    `${baseUrl}/api/agent-server/context/compact`,
    `${baseUrl}/api/agent-server/agents/${encodeURIComponent(scenario.runtimeId)}/compact`,
  ];
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${response.status} ${endpoint}`);
        continue;
      }
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) as unknown : {};
      } catch {
        json = { message: text };
      }
      if (isRecord(json) && 'data' in json && json.data === null) {
        return {
          status: 'skipped',
          source: 'agentserver',
          backend: input.config.agentBackend,
          compactCapability: compactCapabilityForBackend(input.config.agentBackend),
          completedAt: nowIso(),
          reason,
          message: 'AgentServer compact returned no compaction tag; current backend/session did not find compressible work.',
          auditRefs: [`agentserver-compact:no-op:${input.sessionId ?? 'no-session'}:${reason}`],
        };
      }
      const data = isRecord(json) && isRecord(json.data) ? json.data : json;
      const event = normalizeContextCompaction(isRecord(data) ? data.contextCompaction ?? data.compaction ?? data : data, 'contextCompaction', isRecord(data) ? data : {});
      return event ?? {
        status: 'completed',
        source: 'agentserver',
        backend: input.config.agentBackend,
        compactCapability: 'agentserver',
        completedAt: nowIso(),
        lastCompactedAt: nowIso(),
        reason,
        auditRefs: [`agentserver-compact:${input.sessionId ?? 'no-session'}:${reason}`],
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    status: 'skipped',
    source: 'unknown',
    backend: input.config.agentBackend,
    compactCapability: 'unknown',
    reason,
    message: `AgentServer compact API unavailable: ${errors.slice(0, 2).join('; ') || 'no endpoint responded'}`,
    auditRefs: [`agentserver-compact-unavailable:${input.sessionId ?? 'no-session'}:${reason}`],
  };
}
