import type { ScenarioId } from '../../data';
import type { AgentBackendId, AgentServerRunPayload, RuntimeArtifact, SendAgentMessageInput } from '../../domain';
import { SCENARIO_SPECS, agentProtocolForPrompt } from '../../scenarioSpecs';
import { expectedArtifactsForCurrentTurn } from '../../artifactIntent';
import { scopeCheck } from '../scopeCheck';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
    targetInstanceInstructions(input),
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
    input.targetInstanceContext ? 'Target Instance context（本轮目标 workspace，用户选择优先于当前实例）:' : '',
    input.targetInstanceContext ? JSON.stringify(compactTargetInstanceContext(input.targetInstanceContext), null, 2) : '',
    selectedRuntimeToolInstructions(input),
    '',
    'Scope check metadata:',
    JSON.stringify(scopeCheck(builtInScenarioId, input.prompt), null, 2),
    '',
  ].filter((line) => line !== '').join('\n');
}

export function buildRunPayload(input: SendAgentMessageInput): AgentServerRunPayload {
  const runtime = buildRuntimeConfig(input);
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
  const expectedArtifacts = expectedArtifactsForCurrentTurn({
    scenarioId: builtInScenarioId,
    prompt: input.prompt,
  });
  const artifactSummary = summarizeArtifacts(input.artifacts ?? []);
  const repairHandoffRunner = buildRepairHandoffRunnerPayload(input);
  const targetInstanceContext = compactTargetInstanceContext(input.targetInstanceContext);
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
        targetInstance: targetInstanceContext,
        targetInstanceContext,
        repairHandoffRunner,
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
        targetInstance: targetInstanceContext,
        targetInstanceContext,
        repairHandoffRunner,
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
        workspaceWriterBaseUrl: input.config.workspaceWriterBaseUrl,
        maxContextWindowTokens: input.config.maxContextWindowTokens,
        agentServerBaseUrl: input.config.agentServerBaseUrl,
        workspacePath: input.config.workspacePath,
        targetInstance: targetInstanceContext,
        targetInstanceContext,
        repairHandoffRunner,
      },
    },
  };
}

function targetInstanceInstructions(input: SendAgentMessageInput) {
  const target = input.targetInstanceContext;
  if (!target || target.mode !== 'peer') return '';
  return [
    'Target Instance policy:',
    '用户已选择 peer target；本轮需要读取并修改目标实例 workspace，而不是当前实例 workspace。',
    `目标实例: ${target.peer?.name ?? 'unknown'}`,
    `目标 workspaceWriterUrl: ${target.peer?.workspaceWriterUrl ?? ''}`,
    `目标 workspacePath: ${target.peer?.workspacePath ?? ''}`,
    target.issueLookup ? `已预取 issue context: ${target.issueLookup.status} ${target.issueLookup.matchedIssueId ?? target.issueLookup.query}` : '',
  ].filter(Boolean).join('\n');
}

function compactTargetInstanceContext(target: SendAgentMessageInput['targetInstanceContext']) {
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
        updatedAt: issue.updatedAt,
        github: issue.github,
        runtime: issue.runtime,
        comment: clipPromptText(issue.comment, 360),
      })),
      bundle: target.issueLookup.bundle ? previewReferencePayload(target.issueLookup.bundle) : undefined,
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

export function summarizeArtifacts(artifacts: RuntimeArtifact[]) {
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

export function normalizeAgentBackend(value: string): AgentBackendId {
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'].includes(value)
    ? value as AgentBackendId
    : 'codex';
}

export function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
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
