import type { AgentId, ClaimType, EvidenceLevel } from '../data';
import {
  makeId,
  nowIso,
  type AgentServerRunPayload,
  type AgentStreamEvent,
  type BioAgentMessage,
  type NormalizedAgentResponse,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type SendAgentMessageInput,
} from '../domain';
import { agentProtocolForPrompt, BIOAGENT_PROFILES } from '../agentProfiles';

const DEFAULT_AGENT_SERVER_URL = 'http://127.0.0.1:18080';
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

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
  const protocol = agentProtocolForPrompt(input.agentId);
  return [
    `你是 BioAgent 的${input.agentName}，领域是 ${input.agentDomain}。`,
    '请用中文回答生命科学研究问题。',
    '优先使用当前 backend 的 native tools；只有 native tools 不可用时，才把 BioAgent/AgentServer tools 当兜底。',
    '必须输出可追溯证据、置信度、事实/推断/假设区分，以及可复现 ExecutionUnit 草案。',
    '不要生成 UI 代码；如需驱动前端 UI，请在回答末尾附加一个 JSON 对象。',
    'JSON 字段可包含 message、confidence、claimType、evidenceLevel、reasoningTrace、claims、uiManifest、executionUnits、artifacts。',
    'artifacts 必须优先使用下方协议中的 type/schema；uiManifest 只能引用已注册 componentId。',
    '当前 Agent 协议:',
    protocol,
  ].join('\n');
}

function buildPrompt(input: SendAgentMessageInput) {
  const recentHistory = input.messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const artifactContext = summarizeArtifacts(input.artifacts ?? []);
  return [
    `当前 BioAgent profile: ${input.agentId}`,
    `当前角色视图: ${input.roleView}`,
    '近期对话:',
    JSON.stringify(recentHistory, null, 2),
    artifactContext.length ? '当前可用 artifacts:' : '',
    artifactContext.length ? JSON.stringify(artifactContext, null, 2) : '',
    '',
    '用户问题:',
    input.prompt,
  ].filter((line) => line !== '').join('\n');
}

function buildRunPayload(input: SendAgentMessageInput): AgentServerRunPayload {
  const runtime = buildRuntimeConfig(input);
  return {
    agent: {
      id: BIOAGENT_PROFILES[input.agentId].agentServerId,
      name: input.agentName,
      backend: 'codex',
      workspace: input.config.workspacePath,
      workingDirectory: input.config.workspacePath,
      systemPrompt: agentSystemPrompt(input),
      reconcileExisting: true,
      metadata: {
        bioAgentProfile: input.agentId,
        domain: input.agentDomain,
        nativeTools: BIOAGENT_PROFILES[input.agentId].nativeTools,
        fallbackTools: BIOAGENT_PROFILES[input.agentId].fallbackTools,
      },
    },
    input: {
      text: buildPrompt(input),
      metadata: {
        rawUserPrompt: input.prompt,
        roleView: input.roleView,
        messageCount: input.messages.length,
        inputContract: BIOAGENT_PROFILES[input.agentId].inputContract,
        expectedArtifacts: BIOAGENT_PROFILES[input.agentId].outputArtifacts.map((artifact) => artifact.type),
        artifacts: summarizeArtifacts(input.artifacts ?? []),
      },
    },
    runtime,
    metadata: {
      project: 'BioAgent',
      source: 'bioagent-web-ui',
      agentId: input.agentId,
      runtimeConfig: {
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
    producerAgent: artifact.producerAgent,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
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

function buildRuntimeConfig(input: SendAgentMessageInput): AgentServerRunPayload['runtime'] {
  const provider = input.config.modelProvider.trim();
  const modelName = input.config.modelName.trim();
  const modelBaseUrl = input.config.modelBaseUrl.trim().replace(/\/+$/, '');
  const useNative = !provider || provider === 'native';
  const runtime: AgentServerRunPayload['runtime'] = {
    backend: 'codex',
    cwd: input.config.workspacePath,
    metadata: {
      bioAgentProfile: input.agentId,
      nativeToolFirst: true,
      autoApprove: true,
      sandbox: 'danger-full-access',
    },
  };
  if (!useNative) runtime.modelProvider = provider;
  if (modelName) runtime.modelName = modelName;
  if (!useNative || modelName || input.config.apiKey.trim()) {
    runtime.llmEndpoint = {
      provider: useNative ? 'native' : provider,
      baseUrl: useNative ? undefined : modelBaseUrl || undefined,
      apiKey: input.config.apiKey.trim() || undefined,
      modelName: modelName || undefined,
    };
  }
  return runtime;
}

function normalizeStreamEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const type = asString(record.type) || asString(record.kind) || 'event';
  const detail = asString(record.message)
    || asString(record.detail)
    || asString(record.status)
    || asString(record.error)
    || (Object.keys(record).length ? JSON.stringify(record) : undefined);
  return {
    id: makeId('evt'),
    type,
    label: streamEventLabel(type),
    detail,
    createdAt: nowIso(),
    raw,
  };
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
      status: record.status === 'done' || record.status === 'running' || record.status === 'failed' || record.status === 'planned'
        ? record.status
        : 'record-only',
      hash: asString(record.hash) || fallback.hash,
      code: asString(record.code) || asString(record.command),
      seed: asNumber(record.seed) ?? asNumber(record.randomSeed),
      time: asString(record.time),
      environment: asString(record.environment),
      inputData: asStringArray(record.inputData) ?? asStringArray(record.inputs),
      dataFingerprint: asString(record.dataFingerprint),
      databaseVersions: asStringArray(record.databaseVersions),
      artifacts: asStringArray(record.artifacts),
      outputArtifacts: asStringArray(record.outputArtifacts),
    } satisfies RuntimeExecutionUnit;
  });
  return units.length ? units : [fallback];
}

export function normalizeAgentResponse(
  agentId: AgentId,
  prompt: string,
  raw: unknown,
): NormalizedAgentResponse {
  const data = isRecord(raw) && raw.ok === true && 'data' in raw ? raw.data : raw;
  const root = isRecord(data) ? data : {};
  const runRecord = isRecord(root.run) ? root.run : {};
  const outputText = extractOutputText(root);
  const structured = extractJsonObject(outputText) ?? {};
  const now = nowIso();
  const runId = asString(runRecord.id) || makeId('run');
  const runStatus = runRecord.status === 'failed' ? 'failed' : 'completed';
  const cleanOutputText = outputText.replace(/```(?:json)?[\s\S]*?```/gi, '').trim() || outputText;
  const messageText = runStatus === 'failed'
    ? `AgentServer 后端运行失败：${cleanOutputText}`
    : asString(structured.message) || cleanOutputText;
  const confidence = asNumber(structured.confidence) ?? 0.78;
  const claimType = pickClaimType(structured.claimType);
  const evidence = pickEvidence(structured.evidenceLevel ?? structured.evidence);
  const fallbackExecutionUnit: RuntimeExecutionUnit = {
    id: `EU-${runId.slice(-6)}`,
    tool: `${agentId}.agent-server-run`,
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

  return {
    message: {
      id: makeId('msg'),
      role: 'agent',
      content: messageText,
      confidence,
      evidence,
      claimType,
      expandable: asString(structured.reasoningTrace) || asString(structured.reasoning) || `AgentServer run: ${runId}\nStatus: ${asString(runRecord.status) || 'completed'}`,
      createdAt: now,
      status: runStatus,
    },
    run: {
      id: runId,
      agentId,
      status: runStatus,
      prompt,
      response: messageText,
      createdAt: asString(runRecord.createdAt) || now,
      completedAt: asString(runRecord.completedAt) || now,
      raw,
    },
    uiManifest: Array.isArray(structured.uiManifest) ? structured.uiManifest.filter(isRecord).map((slot) => ({
      componentId: asString(slot.componentId) || asString(slot.id) || 'paper-card-list',
      title: asString(slot.title),
      props: isRecord(slot.props) ? slot.props : undefined,
      artifactRef: asString(slot.artifactRef),
      priority: asNumber(slot.priority),
    })) : [],
    claims,
    executionUnits: normalizeExecutionUnits(structured.executionUnits, fallbackExecutionUnit),
    artifacts: Array.isArray(structured.artifacts) ? structured.artifacts.filter(isRecord).map((artifact) => ({
      id: asString(artifact.id) || asString(artifact.type) || makeId('artifact'),
      type: asString(artifact.type) || 'agent-output',
      producerAgent: agentId,
      schemaVersion: asString(artifact.schemaVersion) || '1',
      metadata: isRecord(artifact.metadata) ? artifact.metadata : undefined,
      data: artifact.data,
      dataRef: asString(artifact.dataRef),
    })) : [],
    notebook: [{
      id: makeId('note'),
      time: new Date(now).toLocaleString('zh-CN', { hour12: false }),
      agent: agentId,
      title: prompt.slice(0, 32) || 'Agent 对话',
      desc: messageText.slice(0, 96),
      claimType,
      confidence,
    }],
  };
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
      const detail = isRecord(json) ? asString(json.error) || asString(json.message) : undefined;
      throw new Error(detail || `AgentServer 请求失败：HTTP ${response.status}`);
    }
    return normalizeAgentResponse(input.agentId, input.prompt, json);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AgentServer 请求已取消或超时。');
    }
    if (err instanceof TypeError) {
      throw new Error(`无法连接 AgentServer，请确认 ${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 正在运行。`);
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
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        // Keep raw text.
      }
      const detail = isRecord(json) ? asString(json.error) || asString(json.message) : undefined;
      throw new Error(detail || `AgentServer 流式请求失败：HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('AgentServer 未返回可读取的流式响应。');
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
      throw new Error('AgentServer 流式响应结束，但没有返回最终 run result。');
    }
    return normalizeAgentResponse(input.agentId, input.prompt, { ok: true, data: finalResult });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AgentServer 流式请求已取消或超时。');
    }
    if (err instanceof TypeError) {
      throw new Error(`无法连接 AgentServer stream，请确认 ${input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL} 正在运行。`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', linkedAbort);
  }
}
