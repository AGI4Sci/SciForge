import type { ScenarioId, ClaimType, EvidenceLevel } from '../data';
import {
  makeId,
  nowIso,
  type AgentServerRunPayload,
  type AgentBackendId,
  type AgentStreamEvent,
  type BioAgentMessage,
  type NormalizedAgentResponse,
  type ObjectAction,
  type ObjectReference,
  type ObjectReferenceKind,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type ScenarioInstanceId,
  type SendAgentMessageInput,
} from '../domain';
import { agentProtocolForPrompt, SCENARIO_SPECS } from '../scenarioSpecs';
import { BioAgentClientError, reasonFromResponseText, recoverActionsForService } from './clientError';
import { promptWithScopeCheck, scopeCheck } from './scopeCheck';

const DEFAULT_AGENT_SERVER_URL = 'http://127.0.0.1:18080';
const DEFAULT_REQUEST_TIMEOUT_MS = 900_000;

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
    `你运行在 BioAgent 的场景工作台中，当前 Scenario 是「${runtimeScenario?.title ?? scenario.title}」，skill domain 是 ${runtimeScenario?.skillDomain ?? scenario.skillDomain}，领域是 ${input.agentDomain}。`,
    '请用中文回答生命科学研究问题。',
    '优先使用当前 backend 的 native tools；只有 native tools 不可用时，才把 BioAgent/AgentServer tools 当兜底。',
    '必须输出可追溯证据、置信度、事实/推断/假设区分，以及可复现 ExecutionUnit 草案。',
    '不要生成 UI 代码；如需驱动前端 UI，请在回答末尾附加一个 JSON 对象。',
    'JSON 字段可包含 message、confidence、claimType、evidenceLevel、reasoningTrace、claims、displayIntent、uiManifest、executionUnits、artifacts、objectReferences。',
    'artifacts 必须优先使用下方协议中的 type/schema；uiManifest 只能引用已注册 componentId 和声明式 View Composition。',
    'objectReferences 用于回答中引用关键对象；ref 必须是 artifact:*、file:*、folder:*、run:*、execution-unit:* 或 url:*，前端点击后再按需展示/打开。',
    '当前 ScenarioSpec / skill domain 协议:',
    protocol,
    runtimeScenario ? '用户编辑后的 Scenario 设置:' : '',
    runtimeScenario ? JSON.stringify(runtimeScenario, null, 2) : '',
  ].join('\n');
}

function buildPrompt(input: SendAgentMessageInput) {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const recentHistory = input.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const artifactContext = summarizeArtifacts(input.artifacts ?? []);
  return [
    `当前 BioAgent scenario: ${input.scenarioId}`,
    `internal skill domain: ${input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain}`,
    input.scenarioOverride ? `用户编辑 Scenario markdown:\n${input.scenarioOverride.scenarioMarkdown}` : '',
    `当前角色视图: ${input.roleView}`,
    '近期对话:',
    JSON.stringify(recentHistory, null, 2),
    artifactContext.length ? '当前可用 artifacts:' : '',
    artifactContext.length ? JSON.stringify(artifactContext, null, 2) : '',
    '',
    'Scope check metadata:',
    JSON.stringify(scopeCheck(builtInScenarioId, input.prompt), null, 2),
    '',
    '用户问题:',
    input.prompt,
  ].filter((line) => line !== '').join('\n');
}

function buildRunPayload(input: SendAgentMessageInput): AgentServerRunPayload {
  const runtime = buildRuntimeConfig(input);
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
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
        bioAgentScenario: input.scenarioId,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        skillDomain: input.scenarioOverride?.skillDomain ?? scenario.skillDomain,
        domain: input.agentDomain,
        nativeTools: scenario.nativeTools,
        fallbackTools: scenario.fallbackTools,
      },
    },
    input: {
      text: buildPrompt(input),
      metadata: {
        rawUserPrompt: input.prompt,
        roleView: input.roleView,
        messageCount: input.messages.length,
        inputContract: scenario.inputContract,
        expectedArtifacts: scenario.outputArtifacts.map((artifact) => artifact.type),
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        scenarioOverride: input.scenarioOverride,
        artifacts: summarizeArtifacts(input.artifacts ?? []),
        scopeCheck: scopeCheck(builtInScenarioId, input.prompt),
      },
    },
    runtime,
    metadata: {
      project: 'BioAgent',
      source: 'bioagent-web-ui',
      scenarioId: input.scenarioId,
      runtimeConfig: {
        agentBackend: input.config.agentBackend,
        modelProvider: input.config.modelProvider,
        modelBaseUrl: input.config.modelBaseUrl,
        modelName: input.config.modelName,
        agentServerBaseUrl: input.config.agentServerBaseUrl,
        workspacePath: input.config.workspacePath,
      },
    },
  };
}

function summarizeArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.slice(0, 8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    path: artifact.path,
    dataPreview: previewArtifactData(artifact.data),
  }));
}

function previewArtifactData(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 8)) {
    if (Array.isArray(value)) {
      preview[key] = value.slice(0, 5);
    } else {
      preview[key] = value;
    }
  }
  return preview;
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
      bioAgentScenario: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      skillDomain: input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain,
      nativeToolFirst: true,
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
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw'].includes(value)
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
    createdAt: nowIso(),
    raw,
  };
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
      throw new BioAgentClientError({
        title: 'AgentServer 请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-http-${response.status}`,
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, json);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new BioAgentClientError({
        title: 'AgentServer 请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new BioAgentClientError({
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
      throw new BioAgentClientError({
        title: 'AgentServer 流式请求失败',
        reason: reasonFromResponseText(text, `HTTP ${response.status}`),
        recoverActions: recoverActionsForService('agentserver'),
        diagnosticRef: `agentserver-stream-http-${response.status}`,
      });
    }
    if (!response.body) {
      throw new BioAgentClientError({
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
        if ('event' in envelope) callbacks.onEvent?.(normalizeStreamEvent(envelope.event));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) {
          callbacks.onEvent?.(normalizeStreamEvent({ type: 'error', error: envelope.error }));
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const envelope = JSON.parse(buffer.trim()) as unknown;
      if (isRecord(envelope)) {
        if ('event' in envelope) callbacks.onEvent?.(normalizeStreamEvent(envelope.event));
        if ('result' in envelope) finalResult = envelope.result;
        if ('error' in envelope) callbacks.onEvent?.(normalizeStreamEvent({ type: 'error', error: envelope.error }));
      }
    }
    if (!finalResult) {
      throw new BioAgentClientError({
        title: 'AgentServer 流式响应不完整',
        reason: '流结束时没有最终 run result。',
        recoverActions: ['查看 AgentServer 日志', '重试当前请求', '改用 workspace/evolved capability 或 workspace runtime'],
        diagnosticRef: 'agentserver-stream-missing-result',
      });
    }
    return normalizeAgentResponse(input.scenarioId, input.prompt, { ok: true, data: finalResult });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new BioAgentClientError({
        title: 'AgentServer 流式请求超时',
        reason: '请求已取消或超过配置的 timeout。',
        recoverActions: ['检查模型后端是否响应', '调大 Timeout ms', '重试当前请求'],
        diagnosticRef: 'agentserver-stream-timeout',
        cause: err,
      });
    }
    if (err instanceof TypeError) {
      throw new BioAgentClientError({
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
