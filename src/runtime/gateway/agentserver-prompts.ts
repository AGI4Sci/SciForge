import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GatewayRequest, LlmEndpointConfig, SciForgeSkillDomain, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import { expectedArtifactTypesForRequest, normalizeLlmEndpoint, selectedComponentIdsForRequest } from './gateway-request.js';
import { buildContextEnvelope, expectedArtifactSchema, summarizeArtifactRefs, summarizeConversationLedger, summarizeConversationPolicyForAgentServer, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer, workspaceTreeSummary, type AgentServerContextMode } from './context-envelope.js';
import { agentServerAgentId, agentServerContextPolicy, contextWindowMetadata, fetchAgentServerContextSnapshot } from './agentserver-context-window.js';
import { cleanUrl, clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, hashJson, headForAgentServer, isRecord, readTextIfExists, tailForAgentServer, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { normalizeBackendHandoff } from '../workspace-task-input.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import { sha1 } from '../workspace-task-runner.js';
import { parseJsonErrorMessage, redactSecretText, sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { toolPackageManifests } from '../../../packages/skills/tool_skills';
import { uiComponentManifests } from '../../../packages/presentation/components';
import { defaultCapabilitySummaries } from '@sciforge-ui/runtime-contract/capabilities';

export const AGENT_BACKEND_ANSWER_PRINCIPLE = [
  'All normal user-visible answers must be reasoned by the agent backend.',
  'SciForge must not use preset reply templates for user requests; local code may only provide protocol validation, execution recovery, safety-boundary diagnostics, and artifact display.',
].join(' ');

function requestHandoffSource(request: GatewayRequest) {
  return request.handoffSource ?? 'cli';
}

function agentServerBackend(request?: GatewayRequest, llmEndpoint?: LlmEndpointConfig) {
  const requestBackend = request?.agentBackend?.trim();
  if (requestBackend && ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw', 'gemini'].includes(requestBackend)) {
    return requestBackend;
  }
  const requested = process.env.SCIFORGE_AGENTSERVER_BACKEND?.trim();
  if (requested && ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw', 'gemini'].includes(requested)) {
    return requested;
  }
  const endpoint = llmEndpoint ?? request?.llmEndpoint;
  if (endpoint?.baseUrl?.trim()) return 'openteam_agent';
  return 'codex';
}

function currentUserRequestText(prompt: string) {
  const marker = 'Current user request:';
  const index = prompt.lastIndexOf(marker);
  return index >= 0 ? prompt.slice(index + marker.length).trim() : prompt.trim();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function agentServerRunFailure(run: Record<string, unknown>) {
  const status = typeof run.status === 'string' ? run.status : '';
  const output = isRecord(run.output) ? run.output : {};
  const success = typeof output.success === 'boolean' ? output.success : undefined;
  if (status !== 'failed' && success !== false) return undefined;
  const detail = extractAgentServerFailureDetail(run);
  return `AgentServer backend failed: ${detail || 'run failed without a usable generation result.'}`;
}

function extractAgentServerFailureDetail(run: Record<string, unknown>) {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates = [
    output.error,
    output.result,
    output.text,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [result.error, result.finalText, result.outputSummary];
    }),
  ];
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : '';
    if (!text) continue;
    const parsedMessage = parseJsonErrorMessage(text);
    return sanitizeAgentServerError(parsedMessage || text);
  }
  return undefined;
}

function agentServerRequestFailureMessage(operation: 'generation' | 'repair', error: unknown, timeoutMs: number) {
  const message = errorMessage(error);
  if (error instanceof Error && error.name === 'AbortError' || /abort|cancel|timeout/i.test(message)) {
    return `AgentServer ${operation} request timed out or was cancelled after ${timeoutMs}ms. Retry can resume with this repair-needed attempt in priorAttempts.`;
  }
  return `AgentServer ${operation} request failed: ${sanitizeAgentServerError(message)}`;
}

export async function requestAgentServerRepair(params: {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}): Promise<{ ok: true; runId?: string; diffSummary?: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SCIFORGE_AGENTSERVER_REPAIR_TIMEOUT_MS || 900000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let runPayload: unknown;
  try {
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(params.request, params.run.workspace);
    const backend = agentServerBackend(params.request, llmRuntime.llmEndpoint);
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const priorAttempts = await readRecentTaskAttempts(params.run.workspace, params.request.skillDomain, 8, {
      scenarioPackageId: params.request.scenarioPackageRef?.id,
      skillPlanRef: params.request.skillPlanRef,
      prompt: params.request.prompt,
    });
    const agentId = agentServerAgentId(params.request, 'runtime-repair');
    const repairContext: Record<string, unknown> = await buildCompactRepairContext({
      request: params.request,
      workspace: params.run.workspace,
      skill: params.skill,
      run: params.run,
      schemaErrors: params.schemaErrors,
      failureReason: params.failureReason,
      priorAttempts,
    });
    const agentServerSnapshot = await fetchAgentServerContextSnapshot(params.baseUrl, agentId);
    if (agentServerSnapshot) {
      repairContext.agentServerCoreSnapshot = agentServerSnapshot;
    }
    const repairPrompt = buildAgentServerRepairPrompt({ ...params, repairContext });
    const repairContextBytes = Buffer.byteLength(JSON.stringify(repairContext), 'utf8');
    runPayload = {
      agent: {
        id: agentId,
        name: `SciForge ${params.request.skillDomain} Runtime Repair`,
        backend,
        workspace: params.run.workspace,
        workingDirectory: params.run.workspace,
        reconcileExisting: true,
        systemPrompt: [
          AGENT_BACKEND_ANSWER_PRINCIPLE,
          'You repair SciForge workspace-local task code.',
          'Edit the referenced task file or adjacent helper files in the workspace, then stop.',
          'Preserve the task contract: task receives inputPath and outputPath argv values and writes a SciForge ToolPayload JSON object.',
          'Do not create demo/default success artifacts; if the real task cannot be repaired, explain the missing condition.',
        ].join(' '),
      },
      input: {
        text: repairPrompt,
        metadata: {
          project: 'SciForge',
          purpose: 'workspace-task-repair',
          skillDomain: params.request.skillDomain,
          skillId: params.skill.id,
          codeRef: params.run.spec.taskRel,
          stdoutRef: params.run.stdoutRef,
          stderrRef: params.run.stderrRef,
          outputRef: params.run.outputRef,
          schemaErrors: params.schemaErrors,
          repairContextVersion: 'sciforge.repair-context.v1',
          contextMode: 'compact-repair',
          repairContextBytes,
          promptChars: repairPrompt.length,
        },
      },
      contextPolicy: agentServerContextPolicy(params.request),
      runtime: {
        backend,
        cwd: params.run.workspace,
        ...llmRuntime,
        metadata: {
          autoApprove: true,
          sandbox: 'danger-full-access',
          ...agentHandoffSourceMetadata(requestHandoffSource(params.request)),
          source: 'sciforge-workspace-runtime-gateway',
          llmEndpointSource: llmRuntime.llmEndpoint ? llmEndpointSource : undefined,
        },
      },
      metadata: {
        project: 'SciForge',
        ...agentHandoffSourceMetadata(requestHandoffSource(params.request)),
        source: 'workspace-runtime-gateway',
        taskId: params.run.spec.id,
        repairOf: params.run.spec.taskRel,
        workspace: params.run.workspace,
        workingDirectory: params.run.workspace,
        orchestrator: {
          mode: 'multi_stage',
          planKind: 'implement-only',
          failureStrategy: 'retry_stage',
          maxRetries: 1,
        },
        maxContextWindowTokens: params.request.maxContextWindowTokens,
        contextWindowLimit: params.request.maxContextWindowTokens,
        modelContextWindow: params.request.maxContextWindowTokens,
      },
    };
    const normalizedHandoff = await normalizeBackendHandoff(runPayload, {
      workspacePath: params.run.workspace,
      purpose: 'agentserver-repair',
    });
    runPayload = normalizedHandoff.payload;
    const response = await fetch(`${params.baseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(runPayload),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text in the failure message below.
    }
    await writeAgentServerDebugArtifact(params.run.workspace, 'repair', runPayload, response.status, json);
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      return { ok: false, error: sanitizeAgentServerError(detail || `AgentServer repair HTTP ${response.status}: ${String(text).slice(0, 500)}`) };
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    const run = isRecord(data.run) ? data.run : {};
    const runFailure = agentServerRunFailure(run);
    if (runFailure) {
      return { ok: false, error: runFailure };
    }
    const output = isRecord(run.output) ? run.output : {};
    const stageResults = Array.isArray(run.stages)
      ? run.stages.map((stage) => isRecord(stage) && isRecord(stage.result) ? stage.result : undefined).filter(Boolean)
      : [];
    const diffSummary = [
      typeof output.result === 'string' ? output.result : '',
      ...stageResults.map((result) => isRecord(result) ? String(result.diffSummary || result.handoffSummary || '') : ''),
    ].filter(Boolean).join('\n').slice(0, 4000);
    return {
      ok: true,
      runId: typeof run.id === 'string' ? run.id : undefined,
      diffSummary,
    };
  } catch (error) {
    await writeAgentServerDebugArtifact(params.run.workspace, 'repair', runPayload, 0, { error: errorMessage(error) });
    return { ok: false, error: agentServerRequestFailureMessage('repair', error, timeoutMs) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function readConfiguredAgentServerBaseUrl(workspace: string) {
  try {
    const parsed = JSON.parse(await readFile(join(workspace, '.sciforge', 'config.json'), 'utf8'));
    if (isRecord(parsed) && typeof parsed.agentServerBaseUrl === 'string') {
      return cleanUrl(parsed.agentServerBaseUrl);
    }
  } catch {
    // No persisted UI config is available for this workspace yet.
  }
  return undefined;
}

export async function writeAgentServerDebugArtifact(
  workspace: string,
  task: 'generation' | 'repair',
  requestPayload: unknown,
  responseStatus: number,
  responseBody: unknown,
) {
  try {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task}-${sha1(JSON.stringify(requestPayload)).slice(0, 8)}`;
    const rel = join('.sciforge', 'debug', 'agentserver', `${id}.json`);
    await mkdir(dirname(join(workspace, rel)), { recursive: true });
    await writeFile(join(workspace, rel), JSON.stringify({
      createdAt: new Date().toISOString(),
      kind: 'agentserver-run-debug',
      task,
      responseStatus,
      request: redactSecrets(requestPayload),
      response: redactSecrets(responseBody),
    }, null, 2));
  } catch {
    // Debug artifacts are diagnostic-only; never fail the user task because the trace cannot be written.
  }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) {
    if (typeof value === 'string') return redactSecretText(value);
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
      continue;
    }
    out[key] = redactSecrets(entry);
  }
  return out;
}

export async function agentServerLlmRuntime(request: GatewayRequest, workspace: string): Promise<{
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: LlmEndpointConfig;
  llmEndpointSource?: string;
}> {
  const fromRequest = normalizeLlmEndpoint(request.llmEndpoint);
  if (fromRequest) {
    return {
      modelProvider: request.modelProvider?.trim() || fromRequest.provider,
      modelName: request.modelName?.trim() || fromRequest.modelName,
      llmEndpoint: fromRequest,
      llmEndpointSource: 'request',
    };
  }
  if (hasExplicitRequestLlmConfig(request)) {
    return {
      modelProvider: request.modelProvider?.trim(),
      modelName: request.modelName?.trim(),
      llmEndpointSource: 'request-empty',
    };
  }
  const fromLocal = await readConfiguredLlmEndpoint(join(process.cwd(), 'config.local.json'), 'config.local.json');
  if (fromLocal) return fromLocal;
  const fromWorkspace = await readConfiguredLlmEndpoint(join(workspace, '.sciforge', 'config.json'), 'workspace-config');
  if (fromWorkspace) return fromWorkspace;
  return {};
}

export function hasExplicitRequestLlmConfig(request: GatewayRequest) {
  return typeof request.modelProvider === 'string'
    || typeof request.modelName === 'string'
    || request.llmEndpoint !== undefined;
}

export function requiresUserLlmEndpoint(agentServerBaseUrl: string) {
  if (process.env.SCIFORGE_ALLOW_AGENTSERVER_DEFAULT_LLM === '1') return false;
  try {
    const url = new URL(agentServerBaseUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && url.port === '18080';
  } catch {
    return false;
  }
}

export function missingUserLlmEndpointMessage() {
  return [
    'User-side model configuration is required before using the default local AgentServer.',
    'Set Model Provider, Model Base URL, Model Name, and API Key in SciForge settings so the request-selected llmEndpoint is forwarded.',
    'SciForge will not fall back to AgentServer openteam.json defaults for this path.',
  ].join(' ');
}

export async function buildCompactRepairContext(params: {
  request: GatewayRequest;
  workspace: string;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}) {
  const taskAbs = join(params.workspace, params.run.spec.taskRel);
  const inputRel = `.sciforge/task-inputs/${params.run.spec.id}.json`;
  const [code, stdout, stderr, output, input] = await Promise.all([
    readTextIfExists(taskAbs),
    readTextIfExists(join(params.workspace, params.run.stdoutRef)),
    readTextIfExists(join(params.workspace, params.run.stderrRef)),
    readTextIfExists(join(params.workspace, params.run.outputRef)),
    readTextIfExists(join(params.workspace, inputRel)),
  ]);
  const outputWorkEvidenceSummary = summarizeWorkEvidenceForHandoff(parseJsonIfPossible(output));
  const failureEvidence = outputWorkEvidenceSummary
    ? params.failureReason
    : `${params.failureReason}\n${stderr}\n${stdout}`;
  return {
    version: 'sciforge.repair-context.v1',
    createdAt: new Date().toISOString(),
    projectFacts: {
      project: 'SciForge',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      taskCodePolicy: 'Generated tasks live in workspace .sciforge/tasks and must be runnable from inputPath/outputPath. They may compose installed/workspace tools when those tools are more reliable than handwritten code.',
      completionPolicy: 'The final user-visible result must come from executing the repaired task and writing a valid ToolPayload, not from code generation alone.',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    },
    currentGoal: {
      currentUserRequest: clipForAgentServerPrompt(currentUserRequestText(params.request.prompt), 4000),
      skillDomain: params.request.skillDomain,
      expectedArtifactTypes: expectedArtifactTypesForRequest(params.request),
      selectedComponentIds: selectedComponentIdsForRequest(params.request),
    },
    workspaceRefs: {
      workspacePath: params.workspace,
      codeRef: params.run.spec.taskRel,
      inputRef: inputRel,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      generatedTaskId: params.run.spec.id,
    },
    selectedSkill: {
      id: params.skill.id,
      kind: params.skill.kind,
      entrypointType: params.skill.manifest.entrypoint.type,
      manifestPath: params.skill.manifestPath,
    },
    failure: {
      exitCode: params.run.exitCode,
      failureReason: clipForAgentServerPrompt(params.failureReason, 4000),
      schemaErrors: params.schemaErrors.slice(0, 16).map((entry) => clipForAgentServerPrompt(entry, 600)).filter(Boolean),
      likelyErrorLine: extractLikelyErrorLine(failureEvidence),
      stderrTail: outputWorkEvidenceSummary ? undefined : tailForAgentServer(stderr, 8000),
      stdoutTail: outputWorkEvidenceSummary ? undefined : tailForAgentServer(stdout, 4000),
      outputHead: outputWorkEvidenceSummary
        ? JSON.stringify({ workEvidenceSummary: outputWorkEvidenceSummary }, null, 2)
        : headForAgentServer(output, 4000),
      workEvidenceSummary: outputWorkEvidenceSummary,
    },
    code: {
      sha1: sha1(code),
      excerpt: excerptAroundFailureLine(code, failureEvidence),
      head: headForAgentServer(code, code.length > 24000 ? 4000 : 8000),
      tail: tailForAgentServer(code, code.length > 24000 ? 4000 : 8000),
      fullTextIncluded: code.length <= 24000,
      fullText: code.length <= 24000 ? code : undefined,
    },
    inputSummary: {
      head: headForAgentServer(input, 4000),
      sha1: input ? sha1(input) : undefined,
    },
    sessionSummary: summarizeUiStateForAgentServer(params.request.uiState, 'delta'),
    artifacts: summarizeArtifactRefs(params.request.artifacts),
    recentExecutionRefs: summarizeExecutionRefs(toRecordList(params.request.uiState?.recentExecutionRefs)),
    priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts).slice(0, 4),
  };
}

function parseJsonIfPossible(value: string) {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export async function readConfiguredLlmEndpoint(path: string, source: string): Promise<{
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: LlmEndpointConfig;
  llmEndpointSource?: string;
} | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(parsed)) return undefined;
    const llm = isRecord(parsed.llm) ? parsed.llm : parsed;
    const provider = typeof llm.provider === 'string' ? llm.provider.trim() : '';
    const baseUrl = typeof llm.baseUrl === 'string' ? cleanUrl(llm.baseUrl) : '';
    const apiKey = typeof llm.apiKey === 'string' ? llm.apiKey.trim() : '';
    const modelName = typeof llm.modelName === 'string'
      ? llm.modelName.trim()
      : typeof llm.model === 'string'
        ? llm.model.trim()
        : '';
    const endpoint = normalizeLlmEndpoint({ provider, baseUrl, apiKey, modelName });
    if (!endpoint) return undefined;
    return {
      modelProvider: provider || endpoint.provider,
      modelName: modelName || endpoint.modelName,
      llmEndpoint: endpoint,
      llmEndpointSource: source,
    };
  } catch {
    return undefined;
  }
}

export function buildAgentServerRepairPrompt(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
  repairContext?: Record<string, unknown>;
}) {
  return [
    'Repair this SciForge workspace task and leave the workspace ready for SciForge to rerun it.',
    'Use the compact repair context below: it contains the current user goal, workspace refs, failure evidence, and relevant code/log excerpts.',
    'Edit the referenced task file or adjacent helper files only as needed. SciForge will rerun the task after you finish.',
    'The repaired task must execute the user goal end-to-end, not merely generate code or report that code was generated.',
    ...externalIoReliabilityContractLines(),
    ...toolPayloadProtocolContractLines(),
    'Preserve failureReason in the next ToolPayload only if the real blocker remains after repair.',
    'Do not fabricate success or replace the user goal with an unrelated demo task.',
    '',
    JSON.stringify({
      repairContext: params.repairContext,
      expectedPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
      minimalValidToolPayload: minimalValidToolPayloadExample(params.request),
    }, null, 2),
    '',
    'Return a concise summary of files changed, tests or commands run, and any remaining blocker.',
  ].join('\n');
}

export function buildAgentServerGenerationPrompt(request: {
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  contextEnvelope?: Record<string, unknown>;
  workspaceTreeSummary: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
  availableSkills: Array<{
    id: string;
    kind: string;
    available: boolean;
    reason: string;
    description?: string;
    entrypointType?: string;
    manifestPath?: string;
    scopeDeclaration?: Record<string, unknown>;
  }>;
  availableTools?: Array<{
    id: string;
    label: string;
    toolType: string;
    description: string;
    producesArtifactTypes: string[];
    selected: boolean;
    docs?: { readmePath?: string; agentSummary?: string };
    packageRoot?: string;
    requiredConfig?: string[];
    tags?: string[];
    sensePlugin?: Record<string, unknown>;
  }>;
  availableRuntimeCapabilities?: Record<string, unknown>;
  artifactSchema: Record<string, unknown>;
  uiManifestContract: Record<string, unknown>;
  uiStateSummary?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  recentExecutionRefs?: Array<Record<string, unknown>>;
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  priorAttempts: unknown[];
  strictTaskFilesReason?: string;
  retryAudit?: unknown;
  freshCurrentTurn?: boolean;
}) {
  const contextEnvelope = isRecord(request.contextEnvelope) ? request.contextEnvelope : {};
  const sessionFacts = isRecord(contextEnvelope.sessionFacts) ? contextEnvelope.sessionFacts : {};
  const scenarioFacts = isRecord(contextEnvelope.scenarioFacts) ? contextEnvelope.scenarioFacts : {};
  const currentUserRequest = stringField(sessionFacts.currentUserRequest) ?? currentUserRequestText(request.prompt);
  const executionMode = executionModeDecisionForPrompt(sessionFacts, scenarioFacts);
  const conversationPolicySummary = isRecord(sessionFacts.conversationPolicySummary)
    ? sessionFacts.conversationPolicySummary
    : isRecord(scenarioFacts.conversationPolicySummary)
      ? scenarioFacts.conversationPolicySummary
      : summarizeConversationPolicyForAgentServer(request.uiStateSummary);
  const currentTurnSnapshot = {
    kind: 'SciForgeCurrentTurnSnapshot',
    prompt: request.prompt,
    currentUserRequest,
    skillDomain: request.skillDomain,
    expectedArtifactTypes: request.expectedArtifactTypes ?? [],
    selectedComponentIds: request.selectedComponentIds ?? [],
    executionModeRecommendation: executionMode.executionModeRecommendation,
    complexityScore: executionMode.complexityScore,
    uncertaintyScore: executionMode.uncertaintyScore,
    reproducibilityLevel: executionMode.reproducibilityLevel,
    stagePlanHint: executionMode.stagePlanHint,
    executionModeReason: executionMode.executionModeReason,
    conversationPolicySummary,
    executionScope: 'backend-decides',
    selectedToolIds: toStringList(scenarioFacts.selectedToolIds),
    selectedSenseIds: toStringList(scenarioFacts.selectedSenseIds),
    currentReferences: Array.isArray(sessionFacts.currentReferences) ? sessionFacts.currentReferences : undefined,
    currentReferenceDigests: Array.isArray(sessionFacts.currentReferenceDigests) ? sessionFacts.currentReferenceDigests : undefined,
    strictTaskFilesReason: request.strictTaskFilesReason,
    outputContract: {
      finalOutput: 'exactly one compact JSON object',
      alternatives: ['AgentServerGenerationResponse', 'SciForge ToolPayload'],
      taskFiles: 'array of { path, language, content? }; omit content only when the file was physically written in workspace',
      entrypoint: 'object { language, path, command?, args? } for executable code path only; report/data files are artifacts, not entrypoints',
      externalIo: 'bounded timeouts, backoff retries for 429/5xx/network timeout/empty-result, and valid failed-with-reason ToolPayload on exhausted retrieval',
      projectGuidanceAdoption: 'If TaskProject userGuidanceQueue is present, include executionUnits[].guidanceDecisions with every queued/deferred item marked adopted, deferred, or rejected with a reason.',
    },
  };
  return [
    'CURRENT TURN SNAPSHOT (authoritative; preserve this even when context is compacted):',
    JSON.stringify(clipForAgentServerJson(currentTurnSnapshot), null, 2),
    '',
    request.contextEnvelope ? JSON.stringify({
      version: request.contextEnvelope.version,
      workspaceFacts: Boolean(request.contextEnvelope.workspaceFacts),
      longTermRefs: Boolean(request.contextEnvelope.longTermRefs),
    }, null, 2) : '',
    'Handle this SciForge request as the agent backend decision-maker.',
    'AgentServer owns orchestration, domain reasoning, tool choice, continuation, and repair strategy. SciForge only validates protocol, runs returned workspace tasks, persists refs/artifacts, and reports contract failures.',
    request.freshCurrentTurn
      ? 'FRESH GENERATION MODE: do not call tools before returning. Do not inspect workspace directories, .sciforge, old task attempts, old artifacts, logs, installed packages, or previous generated code. Return final compact JSON immediately; generated task code can perform runtime inspection/retrieval later using inputPath/outputPath.'
      : 'CONTINUITY MODE: inspect only the concrete prior refs needed for the current continuation/repair/rerun request.',
    'First infer the current-turn intent from the CURRENT TURN SNAPSHOT and recentConversation. Use priorAttempts, artifacts, recentExecutionRefs, and workspace refs only when the current turn explicitly asks to continue, repair, rerun, or inspect a previous task.',
    'Fresh current-turn requests must move directly to either a direct ToolPayload or generated task code. Do not spend generation-stage tool calls browsing historical .sciforge/task-attempts, logs, artifacts, or old generated tasks unless the current turn explicitly asks for that history.',
    'Return exactly one JSON object, with no markdown before or after it.',
    'Do not ask SciForge to decide scientific, topical, retrieval, or domain intent. The executionModeRecommendation fields are advisory handoff metadata; AgentServer must make the actual domain/tool/stage decision.',
    'executionModeRecommendation=direct-context-answer: only use this when the answer can be produced entirely from existing context, current refs/digests, artifacts, or prior execution refs already present in the handoff. Do not use direct-context-answer for fresh search/fetch/current-events, even if the user asks a simple question.',
    'executionModeRecommendation=thin-reproducible-adapter: use this for simple search/fetch/current-events lookups with no explicit report/table/download/batch requirement. Keep it lightweight, but preserve code/input/output/log/evidence refs: return AgentServerGenerationResponse with a minimal bounded adapter task unless the backend already has durable tool/result refs it can expose in a ToolPayload.',
    'executionModeRecommendation=single-stage-task: use this for one bounded local computation, file transform, narrow analysis, or simple artifact generation that can be run and validated in one workspace task. Return one AgentServerGenerationResponse, not a multi-stage project plan.',
    'executionModeRecommendation=multi-stage-project: use this for complex research, durable artifacts, multi-file outputs, local-file processing, code/command execution, batch retrieval, full-document reading, reports/tables/notebooks, or multi-artifact validation. Do not generate a complete end-to-end pipeline in one response; return only the next stage spec/patch/task plus the expected refs/artifacts for that stage.',
    'executionModeRecommendation=repair-or-continue-project: use this when the current turn refers to a previous failure, existing project/stage, user guidance queue, continuation, repair, or rerun. Inspect only the cited project/stage refs and return a minimal repair/continue stage instead of starting unrelated fresh work.',
    'Multi-stage/project guidance: for multi-stage-project, plan the durable project internally but return only the immediately executable next stage; later stages must be represented as bounded stage hints, not as a one-shot generated pipeline.',
    'Project guidance adoption contract: when a TaskProject handoff includes userGuidanceQueue, the next stage plan/result must declare every queued or deferred guidance item as adopted, deferred, or rejected, with a short reason in executionUnits[].guidanceDecisions. Do not silently ignore guidance.',
    'Reproducibility principle: when the answer depends on fresh external retrieval, local files, commands, or generated artifacts, prefer AgentServerGenerationResponse so SciForge can archive runnable code/input/output/log refs.',
    'For lightweight search/news/current-events lookups with no explicit report/table/download/batch requirement, still keep the work reproducible, but use a minimal bounded adapter task: one executable file, small provider list, capped results, short timeouts, no workspace exploration, no full-document download, and no bespoke long research pipeline.',
    'Return a direct ToolPayload for lightweight retrieval only when the backend already has durable tool/result refs and can expose WorkEvidence-style provider/query/status/resultCount/evidenceRefs/failureReason/recoverActions/nextStep in the payload; otherwise generate the minimal adapter task.',
    'For heavy or durable work, return AgentServerGenerationResponse with taskFiles, entrypoint, environmentRequirements, validationCommand, expectedArtifacts, and patchSummary. Heavy work includes local file processing, code/command execution, batch retrieval, full-document download/reading, explicit report/table/notebook deliverables, multi-file outputs, or repair/rerun of a prior task. For multi-stage-project, scope this to the next stage only.',
    'Hard contract: taskFiles MUST be an array of objects with path, language, and non-empty content unless the file was physically written in the workspace before returning. Never return taskFiles as string paths only.',
    'Hard contract: entrypoint.path MUST reference one of the returned taskFiles or a file that was physically written in the workspace before returning.',
    'If you physically write task files into the workspace, prefer a compact path-only taskFiles object (path + language, content may be omitted/empty) and return JSON immediately. Do not cat/read full generated source back into the final response just to inline it.',
    'Entrypoint contract: entrypoint.path must be executable task code supported by the runner (.py/.r/.sh, or language=cli with an explicit command). Do not set a markdown/text/json/pdf/report artifact as entrypoint. For report-only answers, return a direct ToolPayload; for generated tasks, make the executable write report/data artifacts.',
    'Generated task interface contract: executable task code must read the SciForge inputPath argument for prompt/current refs/artifacts and write a valid ToolPayload JSON to the outputPath argument. Do not generate static scripts that merely embed the current answer or a document-specific report in source code.',
    ...toolPayloadProtocolContractLines(),
    'Final output must be only compact JSON: either AgentServerGenerationResponse or SciForge ToolPayload.',
    'When returning a SciForge ToolPayload, use displayIntent to describe the user-visible view need, and objectReferences to cite key artifacts/files/runs that the user can click on demand.',
    'objectReferences refs must use controlled prefixes: artifact:*, file:*, folder:*, run:*, execution-unit:*, scenario-package:*, or url:*.',
    'Current-reference contract: if uiStateSummary.currentReferences or contextEnvelope.sessionFacts.currentReferences is non-empty, treat those refs as explicit current-turn inputs. The final message, claims, or artifact content must reflect that each non-UI ref was actually read/used. Merely echoing it as objectReferences or preserving a file chip is not enough.',
    'If the current refs cannot be read or do not contain enough information to answer, return executionUnits.status="failed-with-reason" with the missing/unreadable refs and a precise nextStep. Do not answer from old session memory, priorAttempts, or broad scenario defaults.',
    'Current-reference digest contract: when uiStateSummary.currentReferenceDigests or contextEnvelope.sessionFacts.currentReferenceDigests exists, use those bounded digests first. Do not run generation-stage shell/browser loops that print full PDFs, long documents, or large logs into context; if more evidence is needed, return taskFiles for a workspace task that reads refs by path and writes bounded artifacts.',
    request.strictTaskFilesReason
      ? `Strict retry reason: ${request.strictTaskFilesReason}`
      : '',
    'If a prior task already exists and the user asks to continue, repair, or rerun it, prefer returning taskFiles that reference that existing workspace task path or a minimal patched task instead of starting an unrelated fresh analysis.',
    'For fresh retrieval/analysis/report requests, do not inspect prior task-attempt files to learn old failures. Generate an inputPath/outputPath task that performs the requested retrieval/analysis at execution time and writes bounded artifacts.',
    'Generate fresh task code only when the current turn truly asks for new work or no prior executable artifact can satisfy the request.',
    'Put generated task paths under .sciforge/tasks when possible. SciForge will archive any returned taskFiles under .sciforge/tasks/<run-id>/ before execution.',
    'Do not force self-contained task code when a better installed/workspace tool exists. Prefer the best available tool, record the tool id/version/command in ExecutionUnit, and write only the adapter/glue needed for reproducibility from inputPath and outputPath.',
    'Runtime capability routing contract: use availableRuntimeCapabilities as the generic modular capability catalog. It lists selected and compatible skills, tools, senses, actions, verifiers, and UI components. Decide from that catalog and the current task; do not rely on scene-specific prompt branches or hard-coded examples.',
    'When availableTools or selectedToolIds includes id="local.vision-sense", treat the current turn as having an optional pure-vision Computer Use sense plugin available: construct text + screenshot/image modality requests, keep the package executor-agnostic, emit text-form click/type_text/press_key/scroll/wait commands or vision-trace artifacts, and preserve only compact screenshot refs/grounding/execution/pixel-diff summaries across turns. Do not read DOM or accessibility tree for that vision path, and fail closed for send/delete/pay/authorize/publish actions unless upstream confirmation is explicit.',
    'If the user explicitly asks to use Computer Use, GUI automation, desktop control, mouse, or keyboard, do not satisfy that request by substituting non-GUI generation code such as python-pptx, scripts, repository edits, or synthetic artifacts unless the user explicitly accepts a non-GUI fallback in the current turn. If the Computer Use path fails, return failed-with-reason with the exact failing provider, endpoint/path when available, trace ref, and recovery action instead of claiming the requested GUI task is complete.',
    'If local.vision-sense is selected but no GUI executor/browser/desktop bridge or screenshot input is configured for the current run, do not scan the repository to compensate. Return a concise ToolPayload diagnosis or failed-with-reason ExecutionUnit that says the vision sense contract was detected but the runtime executor bridge is missing, and include the next expected vision-trace file-ref shape instead of fabricating GUI results.',
    'Large-file contract: uploaded PDFs, images, spreadsheets, binary blobs, extracted full text, and large logs must stay as workspace refs. Do not inline base64, do not print full extracted text to stdout/stderr, and do not paste full document text into final JSON.',
    'For uploaded PDFs or long documents, generated tasks should read the file by path/dataRef, write any full extraction to .sciforge/artifacts or .sciforge/task-results, and return only bounded excerpts, section summaries, page/figure locators, hashes, and clickable file/artifact refs.',
    'Bibliographic verification contract: never mark a PMID, DOI, trial id, citation, or paper record as corrected/verified unless the returned title, year, journal, and identifier correspond to the same work as the source claim.',
    'If an identifier lookup returns a title mismatch, topic mismatch, unrelated journal, or only a broad review when the source claim is a trial/cohort/paper, preserve the original claim and mark it needs-verification with the mismatch reason and search terms. Do not substitute the unrelated record as a correction.',
    'For literature artifacts, keep original_title, verified_title, title_match, identifier_match, verification_status, and verification_notes fields when correcting references so SciForge and users can audit the match.',
    'Only treat expectedArtifactTypes as required when the list is non-empty. If it is empty, infer the minimal output from the raw user prompt and do not add scenario-default artifacts.',
    'If expectedArtifactTypes contains multiple artifacts, generate a coordinated Python task or small Python module set that emits every requested artifact type. A partial package skill result is not enough unless the missing artifact has a clear failed-with-reason ExecutionUnit.',
    'Use selectedComponentIds only when the current user turn explicitly requested those views; do not preserve default UI slots as output requirements.',
    'For continuation requests, continue the scenario goal using recentConversation, artifacts, recentExecutionRefs, and priorAttempts. Do not restart an unrelated analysis.',
    'For repair requests, inspect the failureReason plus stdoutRef/stderrRef/outputRef/codeRef and report whether logs are readable before editing or rerunning.',
    'If a required input, remote file, credential, or executable is missing, write a valid ToolPayload with executionUnits.status="failed-with-reason" and a precise failureReason instead of fabricating outputs.',
    request.priorAttempts?.length ? [
      'RECENT PRIOR ATTEMPTS (authoritative repair/continuation context; preserve failureReason):',
      JSON.stringify(summarizeTaskAttemptsForAgentServer(request.priorAttempts).slice(0, 4), null, 2),
    ].join('\n') : '',
    ...externalIoReliabilityContractLines(),
    '',
    JSON.stringify(clipForAgentServerJson({
      ...request,
      taskContract: {
        argv: ['inputPath', 'outputPath'],
        outputPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
      },
    }), null, 2),
  ].join('\n');
}

function externalIoReliabilityContractLines() {
  return [
    'External I/O reliability contract: generated or repaired tasks that call remote APIs, web feeds, model endpoints, package registries, databases, or downloadable files must use bounded timeouts, descriptive User-Agent/contact metadata when applicable, limited retries with exponential backoff, and explicit handling for 429/5xx/network timeout/empty-result cases.',
    'For provider-specific APIs, follow the provider query syntax and prefer standard URL encoders/client libraries over handwritten query strings; when a strict query is empty or invalid, record that fact and try a broader/provider-appropriate fallback before concluding no results.',
    'An empty external search is not a successful literature result by itself: record the exact query strings, HTTP statuses/errors, totalResults when available, fallback attempts, and whether the empty result came from rate limiting, invalid query syntax, no matching records, or network failure.',
    'If all external retrieval attempts fail, the task must still write a valid ToolPayload with executionUnits.status="failed-with-reason", concise failureReason, stdoutRef/stderrRef/outputRef evidence refs when available, recoverActions, nextStep, and any partial artifacts that are honest and useful. Do not leave the user with only a traceback, an endless stream wait, or a missing output file.',
    'Prefer installed/workspace client libraries or capability tools for remote retrieval when they provide rate-limit handling, pagination, or caching; otherwise keep custom HTTP code small, auditable, and source-agnostic.',
  ];
}

function toolPayloadProtocolContractLines() {
  return [
    'ToolPayload schema is strict: uiManifest, claims, executionUnits, and artifacts must be arrays; every uiManifest slot must be an object with componentId and a string artifactRef when present; every artifact must have non-empty id and type. Do not put result rows inside uiManifest; put data in artifacts[].data or artifacts[].dataRef.',
    'Use uiManifest only as view routing metadata. All user-visible result content, tables, lists, reports, raw provider traces, and files must be represented as artifacts with durable dataRef/path or inline data that SciForge can persist.',
    'When repairing schema failures, preserve the task-specific componentId/artifactRef/artifact type from selectedComponentIds, expectedArtifactTypes, incoming uiManifest, or generated artifacts. If none is known, use a generic unknown-artifact-inspector slot bound to a runtime-result artifact; do not force literature/report-specific components into unrelated scenarios.',
  ];
}

function minimalValidToolPayloadExample(request: Pick<GatewayRequest, 'skillDomain' | 'prompt' | 'uiState' | 'selectedComponentIds' | 'expectedArtifactTypes'>) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const selectedComponent = uniqueStrings([
    ...toStringList(request.selectedComponentIds),
    ...toStringList(uiState.selectedComponentIds),
  ]).find(Boolean);
  const expectedArtifact = uniqueStrings([
    ...toStringList(request.expectedArtifactTypes),
    ...toStringList(uiState.expectedArtifactTypes),
  ]).find(Boolean);
  const artifactType = expectedArtifact || `${request.skillDomain}-runtime-result`;
  const artifactId = expectedArtifact || `${request.skillDomain}-runtime-result`;
  return {
    message: 'Concise user-visible result or honest failure summary.',
    confidence: 0.5,
    claimType: 'evidence-summary',
    evidenceLevel: 'workspace-task',
    reasoningTrace: 'Brief audit of sources/tools/retries used by the task.',
    claims: [],
    displayIntent: { primaryView: selectedComponent || 'generic-artifact-inspector' },
    uiManifest: [
      { componentId: selectedComponent || 'unknown-artifact-inspector', artifactRef: artifactId, priority: 1 },
    ],
    executionUnits: [
      { id: `${request.skillDomain}-task`, tool: 'agentserver.generated.task', status: 'done' },
    ],
    artifacts: [
      { id: artifactId, type: artifactType, data: { summary: 'Result content goes here.', rows: [] } },
    ],
    objectReferences: [],
  };
}

function executionModeDecisionForPrompt(
  sessionFacts: Record<string, unknown>,
  scenarioFacts: Record<string, unknown>,
) {
  return {
    executionModeRecommendation: firstStringField([sessionFacts.executionModeRecommendation, scenarioFacts.executionModeRecommendation]) ?? 'unknown',
    complexityScore: firstNumberOrStringField([sessionFacts.complexityScore, scenarioFacts.complexityScore]) ?? 'unknown',
    uncertaintyScore: firstNumberOrStringField([sessionFacts.uncertaintyScore, scenarioFacts.uncertaintyScore]) ?? 'unknown',
    reproducibilityLevel: firstStringField([sessionFacts.reproducibilityLevel, scenarioFacts.reproducibilityLevel]) ?? 'unknown',
    stagePlanHint: firstStagePlanHintField([sessionFacts.stagePlanHint, scenarioFacts.stagePlanHint]) ?? 'backend-decides',
    executionModeReason: firstStringField([sessionFacts.executionModeReason, scenarioFacts.executionModeReason]) ?? 'backend-decides',
  };
}

function firstStringField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumberOrStringField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstStagePlanHintField(values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
      if (items.length) return items;
    }
  }
  return undefined;
}

export function summarizeSkillsForAgentServer(
  skills: SkillAvailability[],
  selectedSkill: SkillAvailability,
  skillDomain: SciForgeSkillDomain,
) {
  const selectedId = selectedSkill.id;
  const domainToken = `.${skillDomain}`;
  const selected = skills.filter((skill) => skill.id === selectedId);
  const sameDomain = skills
    .filter((skill) => skill.id !== selectedId)
    .filter((skill) => skill.id.includes(domainToken) || skill.id.endsWith(`.${skillDomain}`))
    .slice(0, 8);
  const localAvailable = skills
    .filter((skill) => skill.id !== selectedId && !sameDomain.includes(skill))
    .filter((skill) => skill.available)
    .slice(0, 8);
  return [...selected, ...sameDomain, ...localAvailable].map((skill) => ({
    id: skill.id,
    kind: skill.kind,
    available: skill.available,
    reason: clipForAgentServerPrompt(skill.reason, 240) ?? '',
    description: clipForAgentServerPrompt(skill.manifest.description, 480),
    entrypointType: skill.manifest.entrypoint.type,
    manifestPath: skill.manifestPath,
  }));
}

export function summarizeToolsForAgentServer(request: GatewayRequest) {
  const selectedIds = new Set(uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]));
  const selectedTools = toolPackageManifests.filter((tool) => selectedIds.has(tool.id));
  const domainTools = toolPackageManifests
    .filter((tool) => (tool.skillDomains as readonly string[]).includes(request.skillDomain))
    .slice(0, 12);
  return uniqueById([...selectedTools, ...domainTools])
    .slice(0, 16)
    .map((tool) => {
      const sensePlugin = 'sensePlugin' in tool ? tool.sensePlugin : undefined;
      return {
        id: tool.id,
        label: tool.label,
        toolType: tool.toolType,
        description: clipForAgentServerPrompt(tool.description, 420) || '',
        producesArtifactTypes: [...(tool.producesArtifactTypes ?? [])],
        selected: selectedIds.has(tool.id),
        docs: tool.docs,
        packageRoot: tool.packageRoot,
        requiredConfig: [...(tool.requiredConfig ?? [])],
        tags: [...tool.tags],
        sensePlugin: sensePlugin ? clipForAgentServerJson(sensePlugin, 4) as Record<string, unknown> : undefined,
      };
    });
}

export function summarizeRuntimeCapabilitiesForAgentServer(
  request: GatewayRequest,
  availableSkills: ReturnType<typeof summarizeSkillsForAgentServer>,
) {
  const tools = summarizeToolsForAgentServer(request);
  const selectedToolIds = new Set(uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]));
  const selectedSenseIds = new Set(uniqueStrings([
    ...(request.selectedSenseIds ?? []),
    ...toStringList(request.uiState?.selectedSenseIds),
    ...[...selectedToolIds].filter((id) => id.includes('sense')),
  ]));
  const selectedActionIds = new Set(uniqueStrings([
    ...(request.selectedActionIds ?? []),
    ...toStringList(request.uiState?.selectedActionIds),
  ]));
  const selectedVerifierIds = new Set(uniqueStrings([
    ...(request.selectedVerifierIds ?? []),
    ...toStringList(request.uiState?.selectedVerifierIds),
  ]));
  const expectedArtifactTypes = expectedArtifactTypesForRequest(request);
  const selectedComponentIds = selectedComponentIdsForRequest(request);
  return {
    schemaVersion: 'sciforge.runtime-capability-catalog.v1',
    routingPolicy: {
      decisionOwner: 'AgentServer',
      loadContracts: 'lazy-load selected capability docs/contracts only when needed',
      selectionRule: 'Prefer selected capabilities, then compatible domain/artifact capabilities; return failed-with-reason when a required executor/config is missing.',
    },
    selected: {
      skillIds: availableSkills.map((skill) => skill.id),
      toolIds: [...selectedToolIds],
      senseIds: [...selectedSenseIds],
      actionIds: [...selectedActionIds],
      verifierIds: [...selectedVerifierIds],
      componentIds: selectedComponentIds,
    },
    skills: availableSkills,
    tools,
    senses: tools.filter((tool) => tool.toolType === 'sense-plugin' || selectedSenseIds.has(tool.id)),
    actions: summarizeCapabilitySummaries('action', selectedActionIds, request),
    verifiers: summarizeCapabilitySummaries('verifier', selectedVerifierIds, request),
    uiComponents: summarizeUiComponentsForAgentServer(request, expectedArtifactTypes, selectedComponentIds),
  };
}

function summarizeCapabilitySummaries(
  kind: 'action' | 'verifier',
  selectedIds: Set<string>,
  request: GatewayRequest,
) {
  return defaultCapabilitySummaries()
    .filter((summary) => summary.kind === kind)
    .filter((summary) => selectedIds.has(summary.id)
      || summary.domains.includes(request.skillDomain)
      || summary.domains.includes('workspace')
      || summary.domains.includes('gui'))
    .slice(0, 12)
    .map((summary) => ({
      id: summary.id,
      kind: summary.kind,
      category: summary.category,
      oneLine: summary.oneLine,
      selected: selectedIds.has(summary.id),
      domains: summary.domains,
      triggers: summary.triggers.slice(0, 8),
      producesArtifactTypes: summary.producesArtifactTypes,
      riskClass: summary.riskClass,
      reliability: summary.reliability,
      requiredConfig: summary.requiredConfig,
      sideEffects: summary.sideEffects ?? [],
      verifierTypes: summary.verifierTypes ?? [],
      detailRef: summary.detailRef,
    }));
}

function summarizeUiComponentsForAgentServer(
  request: GatewayRequest,
  expectedArtifactTypes: string[],
  selectedComponentIds: string[],
) {
  const selected = new Set(selectedComponentIds);
  const expected = new Set(expectedArtifactTypes);
  return uiComponentManifests
    .map((component) => {
      const artifactMatch = component.acceptsArtifactTypes.some((type) => expected.has(type))
        || (component.outputArtifactTypes ?? []).some((type) => expected.has(type));
      const isSelected = selected.has(component.componentId);
      return { component, score: (isSelected ? 100 : 0) + (artifactMatch ? 30 : 0) + (component.priority ?? 0) };
    })
    .filter((item) => item.score > 0 || item.component.lifecycle === 'published')
    .sort((left, right) => right.score - left.score || left.component.componentId.localeCompare(right.component.componentId))
    .slice(0, 24)
    .map(({ component }) => ({
      id: component.componentId,
      componentId: component.componentId,
      title: component.title,
      description: clipForAgentServerPrompt(component.description, 320),
      selected: selected.has(component.componentId),
      lifecycle: component.lifecycle,
      acceptsArtifactTypes: component.acceptsArtifactTypes,
      outputArtifactTypes: component.outputArtifactTypes ?? [],
      requiredFields: component.requiredFields ?? [],
      requiredAnyFields: component.requiredAnyFields ?? [],
      viewParams: component.viewParams ?? [],
      interactionEvents: component.interactionEvents ?? [],
      safety: component.safety,
      docs: component.docs,
    }));
}

export function uniqueById<T extends { id: string }>(values: readonly T[]) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    out.push(value);
  }
  return out;
}

export function buildAgentServerCompactContext(
  request: GatewayRequest,
  params: {
    contextEnvelope: Record<string, unknown>;
    workspaceTree: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
    priorAttempts: unknown[];
    selectedSkill: SkillAvailability;
    skills: SkillAvailability[];
    mode: AgentServerContextMode;
  },
) {
  const mode = params.mode;
  const selectedOnly = mode === 'delta';
  return {
    mode,
    workspaceTreeSummary: mode === 'full' ? params.workspaceTree : [],
    availableSkills: selectedOnly
      ? summarizeSkillsForAgentServer([params.selectedSkill], params.selectedSkill, request.skillDomain)
      : summarizeSkillsForAgentServer(params.skills, params.selectedSkill, request.skillDomain),
    uiStateSummary: summarizeUiStateForAgentServer(request.uiState, mode),
    artifacts: summarizeArtifactRefs(request.artifacts),
    recentExecutionRefs: summarizeExecutionRefs(toRecordList(request.uiState?.recentExecutionRefs)),
    priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts).slice(0, mode === 'full' ? 4 : 2),
  };
}

export function contextEnvelopeMode(
  request: GatewayRequest,
  options: { agentServerCoreAvailable?: boolean; forceSlimHandoff?: boolean } = {},
): AgentServerContextMode {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const hasSession = typeof uiState.sessionId === 'string' && uiState.sessionId.trim().length > 0;
  const hasPriorRefs = request.artifacts.length > 0
    || toRecordList(uiState.recentExecutionRefs).length > 0
    || toStringList(uiState.recentConversation).length > 1;
  const backend = String(request.agentBackend || '').toLowerCase();
  const codexNativeSession = backend === 'codex' && hasSession && hasPriorRefs;
  if (options.forceSlimHandoff && hasSession && hasPriorRefs) return 'delta';
  if (codexNativeSession) return 'delta';
  return hasSession && hasPriorRefs && options.agentServerCoreAvailable === true ? 'delta' : 'full';
}

export function summarizeUiStateForAgentServer(uiState: unknown, mode: AgentServerContextMode) {
  if (!isRecord(uiState)) return undefined;
  const ledger = toRecordList(uiState.conversationLedger);
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined;
  return {
    sessionId: typeof uiState.sessionId === 'string' ? uiState.sessionId : undefined,
    currentPrompt: clipForAgentServerPrompt(uiState.currentPrompt, mode === 'full' ? 1600 : 1200),
    rawUserPrompt: clipForAgentServerPrompt(uiState.rawUserPrompt, mode === 'full' ? 1600 : 1200),
    recentConversation: toStringList(uiState.recentConversation)
      .slice(mode === 'full' ? -6 : -4)
      .map((entry) => clipForAgentServerPrompt(entry, mode === 'full' ? 900 : 700))
      .filter(Boolean),
    currentReferences: Array.isArray(uiState.currentReferences)
      ? uiState.currentReferences.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 2))
      : undefined,
    currentReferenceDigests: Array.isArray(uiState.currentReferenceDigests)
      ? uiState.currentReferenceDigests.slice(0, 8).map((entry) => clipForAgentServerJson(entry, 4))
      : undefined,
    scopeCheck: isRecord(uiState.scopeCheck) ? clipForAgentServerJson(uiState.scopeCheck, 3) : undefined,
    selectedComponentIds: toStringList(uiState.selectedComponentIds),
    selectedSkillIds: toStringList(uiState.selectedSkillIds),
    selectedToolIds: toStringList(uiState.selectedToolIds),
    selectedSenseIds: toStringList(uiState.selectedSenseIds),
    selectedActionIds: toStringList(uiState.selectedActionIds),
    selectedVerifierIds: toStringList(uiState.selectedVerifierIds),
    verificationPolicy: isRecord(uiState.verificationPolicy) ? clipForAgentServerJson(uiState.verificationPolicy, 2) : undefined,
    verificationResult: isRecord(uiState.verificationResult) ? clipForAgentServerJson(uiState.verificationResult, 2) : undefined,
    conversationPolicySummary: summarizeConversationPolicyForAgentServer(uiState.conversationPolicy ?? uiState),
    recentRuns: Array.isArray(uiState.recentRuns)
      ? uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2))
      : undefined,
    conversationLedger: summarizeConversationLedger(ledger, mode),
    contextReusePolicy: contextReusePolicy ? clipForAgentServerJson(contextReusePolicy, 3) : undefined,
    contextMode: mode,
  };
}
