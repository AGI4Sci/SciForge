import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { normalizeAgentResponse } from './agentClient';
import { scopeCheck } from './scopeCheck';
import { recommendScenarioElements } from '../scenarioCompiler/scenarioElementCompiler';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function sendBioAgentToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const artifactSummary = summarizeArtifacts(input);
  const recentExecutionRefs = summarizeExecutionRefs(input);
  const recentConversation = currentTurnConversation(input, artifactSummary, recentExecutionRefs);
  const runtimePrompt = buildRuntimePrompt(input, recentConversation, artifactSummary, recentExecutionRefs);
  const compileText = [
    input.scenarioOverride?.title,
    input.scenarioOverride?.description,
    input.scenarioOverride?.scenarioMarkdown,
    recentConversation.join('\n'),
    input.prompt,
  ].filter(Boolean).join('\n');
  const compileHints = recommendScenarioElements(compileText || input.prompt);
  const expectedArtifactTypes = compileHints.selectedArtifactTypes;
  const selectedComponentIds = input.scenarioOverride?.defaultComponents?.length ? input.scenarioOverride.defaultComponents : compileHints.selectedComponentIds;
  const skillDomain = input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain;
  const explicitLocalSkills = explicitLocalSkillRequest(input.prompt, skillDomain);
  const forceAgentServerGeneration = explicitLocalSkills.length
    ? false
    : shouldForceGeneralAgentWork(input, expectedArtifactTypes, selectedComponentIds, recentConversation, artifactSummary);
  const availableSkills = explicitLocalSkills.length
    ? explicitLocalSkills
    : forceAgentServerGeneration
    ? [`agentserver.generate.${skillDomain}`]
    : compileHints.selectedSkillIds;
  const priorFailure = hasPriorFailure(artifactSummary, recentExecutionRefs);
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, input.config.requestTimeoutMs || 900_000);
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
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：${forceAgentServerGeneration ? '交给 AgentServer 生成/延续 workspace task' : '使用匹配的 workspace skill'}，目标 artifacts=${expectedArtifactTypes.join(', ') || 'default'}`));
  callbacks.onEvent?.(toolEvent(
    'context-loaded',
    artifactSummary.length || recentExecutionRefs.length
      ? `读取上一轮上下文：artifacts=${artifactSummary.length}, refs=${recentExecutionRefs.length}`
      : '当前轮没有可复用 artifact/ref，上下文从场景目标和对话开始。',
  ));
  if (priorFailure) {
    callbacks.onEvent?.(toolEvent('repair-start', `正在修复：已发现上一轮 failureReason=${priorFailure}`));
  }
  callbacks.onEvent?.(toolEvent('project-tool-start', `BioAgent ${builtInScenarioId} project tool started`));
  const response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/bioagent/tools/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: builtInScenarioId,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        skillDomain,
        agentBackend: input.config.agentBackend,
        prompt: runtimePrompt,
        workspacePath: input.config.workspacePath,
        agentServerBaseUrl: input.config.agentServerBaseUrl,
        modelProvider: input.config.modelProvider,
        modelName: input.config.modelName,
        llmEndpoint: buildToolLlmEndpoint(input),
        roleView: input.roleView,
        artifacts: artifactSummary,
        availableSkills,
        expectedArtifactTypes,
        selectedComponentIds,
        uiState: {
          sessionId: input.sessionId,
          scopeCheck: scopeCheck(builtInScenarioId, input.prompt),
          scenarioOverride: input.scenarioOverride,
          scenarioPackageRef: input.scenarioPackageRef,
          skillPlanRef: input.skillPlanRef,
          uiPlanRef: input.uiPlanRef,
          currentPrompt: input.prompt,
          recentConversation,
          recentExecutionRefs,
          recentRuns: summarizeRuns(input),
          workspacePersistence: workspacePersistenceSummary(input),
          expectedArtifactTypes,
          selectedComponentIds,
          freshTaskGeneration: true,
          forceAgentServerGeneration,
        },
      }),
      signal: requestController.signal,
    });
  const { result, error } = await readWorkspaceToolStream(response, (event) => {
    lastRealEventAt = Date.now();
    callbacks.onEvent?.(normalizeWorkspaceRuntimeEvent(event));
  });
  if (!response.ok || error || !isRecord(result)) {
    throw new Error(error || `BioAgent project tool failed: HTTP ${response.status}`);
  }
  callbacks.onEvent?.(toolEvent('project-tool-done', priorFailure
    ? `重跑完成：BioAgent ${builtInScenarioId} 已保留修复结果或 repair-needed 诊断`
    : `重跑完成：BioAgent ${builtInScenarioId} project tool completed`));
  return normalizeAgentResponse(builtInScenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: makeId(`project-${builtInScenarioId}`),
        status: 'completed',
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
        ? `BioAgent project tool 超时：${input.config.requestTimeoutMs || 900_000}ms 内没有完成。流式面板已显示最后一个真实事件。`
        : 'BioAgent project tool 已取消。');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    globalThis.clearInterval(silenceWatchdog);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

async function readWorkspaceToolStream(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    if (isRecord(json) && json.ok === true) return { result: json.result };
    return { error: isRecord(json) ? asString(json.error) || asString(json.message) : text || `HTTP ${response.status}` };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    const envelope = JSON.parse(line) as unknown;
    if (!isRecord(envelope)) return;
    if ('event' in envelope) onEvent(envelope.event);
    if ('result' in envelope) result = envelope.result;
    if ('error' in envelope) error = asString(envelope.error) || JSON.stringify(envelope.error);
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  return { result, error };
}

function normalizeWorkspaceRuntimeEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const type = asString(record.type) || asString(record.kind) || 'workspace-runtime-event';
  const source = asString(record.source);
  const toolName = asString(record.toolName);
  const detail = asString(record.detail)
    || asString(record.message)
    || asString(record.text)
    || asString(record.output)
    || asString(record.status)
    || asString(record.error)
    || (Object.keys(record).length ? JSON.stringify(record) : undefined);
  return {
    id: makeId('evt'),
    type,
    label: streamEventLabel(type, source, toolName),
    detail,
    createdAt: nowIso(),
    raw,
  };
}

function streamEventLabel(type: string, source?: string, toolName?: string) {
  if (type === 'run-plan') return '计划';
  if (type === 'stage-start') return '阶段';
  if (type === 'text-delta') return '思考';
  if (type === 'tool-call') return toolName ? `调用 ${toolName}` : '工具调用';
  if (type === 'tool-result') return toolName ? `结果 ${toolName}` : '工具结果';
  if (type === 'status') return source === 'agentserver' ? 'AgentServer 状态' : '运行状态';
  if (type.includes('error')) return '错误';
  if (type.includes('silent')) return '等待';
  return source === 'agentserver' ? 'AgentServer' : 'Workspace Runtime';
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

function currentTurnConversation(
  input: SendAgentMessageInput,
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const hasCurrentSessionWork = (input.runs?.length ?? 0) > 0
    || artifactSummary.length > 0
    || recentExecutionRefs.length > 0;
  if (!hasCurrentSessionWork) return [`user: ${input.prompt}`];
  const conversation = input.messages.slice(-12).map((message) => `${message.role}: ${message.content}`);
  const lastUser = [...input.messages].reverse().find((message) => message.role === 'user');
  if (!lastUser || normalizePromptText(lastUser.content) !== normalizePromptText(input.prompt)) {
    conversation.push(`user: ${input.prompt}`);
  }
  return conversation;
}

function normalizePromptText(value: string) {
  return value.replace(/^运行中引导：/, '').trim();
}

function summarizeArtifacts(input: SendAgentMessageInput) {
  return (input.artifacts ?? []).slice(0, 8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    producer: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    dataRef: artifact.dataRef,
    workspaceArtifactRef: input.sessionId ? `.bioagent/artifacts/${safeWorkspaceName(input.sessionId)}-${safeWorkspaceName(artifact.id || artifact.type || 'artifact')}.json` : undefined,
    runId: artifactRunId(artifact),
    status: artifactStatus(artifact),
    failureReason: artifactFailureReason(artifact),
    fileRefs: collectArtifactFileRefs(artifact),
    metadata: compactRecord(artifact.metadata),
    dataSummary: summarizeArtifactData(artifact.data),
  }));
}

function summarizeExecutionRefs(input: SendAgentMessageInput) {
  return (input.executionUnits ?? []).slice(0, 8).map((unit) => ({
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
      paperListRef: data.paperListRef,
      pdfDir: data.pdfDir,
      downloadDir: data.downloadDir,
    }),
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
      if (looksLikeRef(entry) || /path|ref|file|dir|pdf|download|log|stdout|stderr|output|code/i.test(key)) refs.add(entry);
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

function compactRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) {
    if (typeof entry === 'string') out[key] = entry.length > 500 ? `${entry.slice(0, 500)}...` : entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry == null) out[key] = entry;
    else if (Array.isArray(entry)) out[key] = entry.slice(0, 12);
    else if (isRecord(entry)) out[key] = Object.fromEntries(Object.entries(entry).slice(0, 8));
  }
  return Object.keys(out).length ? out : undefined;
}

function looksLikeRef(value: string) {
  return /\.bioagent\/|stdout|stderr|output|input|\.json|\.log|\.py|\.ipynb|\.r$/i.test(value);
}

function safeWorkspaceName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function workspacePersistenceSummary(input: SendAgentMessageInput) {
  const workspacePath = input.config.workspacePath.trim();
  const sessionId = input.sessionId;
  return {
    workspacePath,
    bioagentDir: workspacePath ? `${workspacePath}/.bioagent` : '.bioagent',
    workspaceStateRef: '.bioagent/workspace-state.json',
    sessionRef: sessionId ? `.bioagent/sessions/${safeWorkspaceName(sessionId)}.json` : undefined,
    artifactDir: '.bioagent/artifacts/',
    taskDir: '.bioagent/tasks/',
    taskResultDir: '.bioagent/task-results/',
    logDir: '.bioagent/logs/',
    note: 'Generated task code, task inputs/results/logs, and UI artifacts are persisted under the workspace .bioagent directory when Workspace Writer is online.',
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

function buildRuntimePrompt(
  input: SendAgentMessageInput,
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const scenario = input.scenarioOverride;
  return [
    'BioAgent should complete the user task end-to-end like a general coding/research agent, not only run a narrow seed search.',
    scenario ? `Scenario title: ${scenario.title}` : '',
    scenario ? `Scenario goal: ${scenario.description}` : '',
    scenario ? `Scenario markdown:\n${scenario.scenarioMarkdown}` : '',
    recentConversation.length ? 'Recent multi-turn conversation:' : '',
    recentConversation.join('\n'),
    artifactSummary.length ? 'Existing artifacts from previous turns:' : '',
    artifactSummary.length ? JSON.stringify(artifactSummary, null, 2) : '',
    recentExecutionRefs.length ? 'Code/log/output refs from previous turns:' : '',
    recentExecutionRefs.length ? JSON.stringify(recentExecutionRefs, null, 2) : '',
    'Local workspace persistence:',
    JSON.stringify(workspacePersistenceSummary(input), null, 2),
    'Current user request:',
    input.prompt,
    '',
    'Work requirements:',
    '- Infer the full user intent across turns.',
    '- For continuation/repair requests, read prior attempts, existing artifacts, and code/log/output refs before deciding what to do next.',
    '- Do not restart an unrelated task when the current request says continue, repair, based on the previous result, add figures, or add a report.',
    '- If previous runs failed, preserve failureReason and return repair-needed or failed-with-reason unless the rerun truly succeeds.',
    '- If the user asks to read, summarize, compare, or write a report, produce a research-report artifact, not just search metadata.',
    '- Reuse previous artifacts when useful; fetch or compute additional data only when needed.',
    '- If the user asks where downloaded/source files, generated code, reports, logs, or artifacts are stored, answer directly with exact workspace refs from artifacts, executionUnits, and Local workspace persistence. If no local file ref exists for the requested item, say that explicitly and point to the task output/artifact JSON that is actually present.',
    '- Emit BioAgent ToolPayload JSON with message, claims, artifacts, executionUnits, uiManifest, and reasoningTrace.',
  ].filter(Boolean).join('\n');
}

function shouldForceGeneralAgentWork(
  input: SendAgentMessageInput,
  expectedArtifactTypes: string[],
  selectedComponentIds: string[],
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
) {
  const text = [
    input.scenarioOverride?.description,
    input.scenarioOverride?.scenarioMarkdown,
    recentConversation.join('\n'),
    input.prompt,
  ].filter(Boolean).join('\n').toLowerCase();
  const wantsReport = expectedArtifactTypes.includes('research-report')
    || selectedComponentIds.includes('report-viewer')
    || /report|summary|summari[sz]e|systematic|read|reading|review|报告|总结|系统性|阅读|综述/.test(text);
  const wantsFreshExternalResearch = /\barxiv\b|\blatest\b|\btoday\b|\bweb\b|\bbrowser\b|最新|今天|今日|网页|浏览器/.test(text);
  const multiTurnContinuation = artifactSummary.length > 0 && /继续|这些|上述|它们|阅读|总结|报告|不只是|not only|not just|write|draft/.test(text);
  const explicitGeneratedTaskRequest = /agentserver|bioagent\/agentserver|workspace[-\s]?local task|generate workspace|generated? task|自己生成|生成.*任务|生成.*代码|自愈|修复.*重跑|读取上一轮日志|不要伪造成功|不要复用|不要使用.*seed|不要.*seed|故意制造|failure|fail|failed|repair-needed|failureReason|stdoutRef|stderrRef|ExecutionUnit/i.test(text);
  return (wantsReport && (wantsFreshExternalResearch || multiTurnContinuation))
    || explicitGeneratedTaskRequest
    || isComplexCellReproductionTask(text);
}

function explicitLocalSkillRequest(prompt: string, skillDomain: string) {
  const text = prompt.toLowerCase();
  const rejectsLocalOrSeedSkill = /不要使用.*(?:seed|workspace skill|registered|local)|不要.*(?:seed|workspace skill)|do not use.*(?:seed|workspace skill|registered|local)|don't use.*(?:seed|workspace skill|registered|local)|不要复用|不要.*窄.*skill/i.test(text);
  if (rejectsLocalOrSeedSkill) return [];
  const asksForLocalRegisteredSkill = /已注册|registered|local|本地|deterministic|确定性|seed|workspace skill|不要生成新代码|不要写新代码|do not generate new code|don't generate new code/.test(text);
  if (!asksForLocalRegisteredSkill) return [];
  if (skillDomain === 'structure' && /structure\.rcsb_latest_or_entry|rcsb|pdb|alphafold|coordinate|坐标|结构/.test(text)) {
    return ['structure.rcsb_latest_or_entry'];
  }
  if (skillDomain === 'literature' && /literature\.pubmed_search|pubmed|文献/.test(text) && !/web|网页|浏览器/.test(text)) {
    return ['literature.pubmed_search'];
  }
  if (skillDomain === 'knowledge' && /knowledge\.uniprot_chembl_lookup|uniprot|chembl|知识/.test(text)) {
    return ['knowledge.uniprot_chembl_lookup'];
  }
  if (skillDomain === 'omics' && /omics\.differential_expression|差异表达|differential expression/.test(text)) {
    return ['omics.differential_expression'];
  }
  return [];
}

function isComplexCellReproductionTask(text: string) {
  const cellSignals = /single[-\s]?cell|scrna|scatac|cite[-\s]?seq|perturb[-\s]?seq|velocity|scvelo|seurat|scanpy|harmony|scvi|totalvi|wnn|glue|milo|scenic|cellchat|spatial transcriptomics|multi[-\s]?organ|multi[-\s]?omics|多器官|单细胞|细胞图谱|跨数据集|标签迁移|整合|速度|扰动|空间转录组|多组学|轨迹|通讯|调控网络|克隆型|类器官/.test(text);
  const workSignals = /reproduce|replicate|benchmark|workflow|pipeline|atlas|integration|label transfer|mapping|reference mapping|batch mixing|qc|cluster|marker|annotation|latent time|driver genes|velocity stream|spliced|unspliced|embedding|modality|niche|复现|重现|基准|流程|图谱|整合|映射|质控|聚类|标记基因|注释|比较|分析|模型比较|复现重点|联合建模|空间邻域/.test(text);
  return cellSignals && workSignals;
}

function toolEvent(type: string, detail: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail },
  };
}
