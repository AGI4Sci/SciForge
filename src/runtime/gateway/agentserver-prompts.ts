import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GatewayRequest, LlmEndpointConfig, SciForgeSkillDomain, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import { extractAgentServerCurrentUserRequest, normalizeConfiguredAgentServerLlmEndpoint } from '@sciforge-ui/runtime-contract/agentserver-prompt-policy';
import { expectedArtifactTypesForRequest, normalizeLlmEndpoint, selectedComponentIdsForRequest } from './gateway-request.js';
import { buildCapabilityBrokerBriefForAgentServer, buildContextEnvelope, expectedArtifactSchema, summarizeArtifactRefs, summarizeConversationLedger, summarizeConversationPolicyForAgentServer, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer, workspaceTreeSummary, type AgentServerContextMode } from './context-envelope.js';
import { agentServerAgentId, agentServerContextPolicy, contextWindowMetadata, fetchAgentServerContextSnapshot } from './agentserver-context-window.js';
import { cleanUrl, clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, hashJson, headForAgentServer, isRecord, readTextIfExists, tailForAgentServer, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { normalizeBackendHandoff } from '../workspace-task-input.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import { sha1 } from '../workspace-task-runner.js';
import { parseJsonErrorMessage, redactSecretText, sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { applyRepairContextPolicyForAgentServer, repairContextPolicySummaryForAgentServer } from './agentserver-repair-context-policy.js';
import { agentServerArtifactSelectionPromptPolicyLines, agentServerBibliographicVerificationPromptPolicyLines, agentServerCurrentReferencePromptPolicyLines, agentServerToolPayloadProtocolContractLines } from '@sciforge-ui/runtime-contract/artifact-policy';
import { agentServerBackendDecisionPromptPolicyLines, agentServerCapabilityRoutingPromptPolicyLines, agentServerContinuationPromptPolicyLines, agentServerCurrentTurnSnapshotPromptPolicyLines, agentServerExecutionModePromptPolicyLines, agentServerExternalIoReliabilityContractLines, agentServerFreshRetrievalPromptPolicyLines, agentServerGeneratedTaskPromptPolicyLines, agentServerGenerationOutputContract, agentServerGenerationOutputContractLines, agentServerLargeFilePromptContractLines, agentServerPriorAttemptsPromptPolicyLines, agentServerRepairPromptPolicyLines, agentServerViewSelectionPromptPolicyLines, agentServerWorkspaceTaskRepairPromptPolicyLines, agentServerWorkspaceTaskRoutingPromptPolicyLines } from '../../../packages/skills/runtime-policy';
import { minimalValidInteractiveToolPayloadExample } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy';

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
  const rawContext = {
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
      currentUserRequest: clipForAgentServerPrompt(extractAgentServerCurrentUserRequest(params.request.prompt), 4000),
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
  const repairContextPolicySummary = repairContextPolicySummaryForAgentServer(params.request, rawContext);
  return applyRepairContextPolicyForAgentServer(rawContext, repairContextPolicySummary) ?? rawContext;
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
    return normalizeConfiguredAgentServerLlmEndpoint(parsed, source);
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
  const repairContextPolicySummary = repairContextPolicySummaryForAgentServer(params.request, params.repairContext);
  const repairContext = applyRepairContextPolicyForAgentServer(params.repairContext, repairContextPolicySummary);
  return [
    ...agentServerWorkspaceTaskRepairPromptPolicyLines('intro'),
    ...agentServerExternalIoReliabilityContractLines(),
    ...agentServerToolPayloadProtocolContractLines(),
    ...agentServerWorkspaceTaskRepairPromptPolicyLines('completion'),
    '',
    JSON.stringify({
      repairContext,
      repairContextPolicySummary,
      expectedPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
      minimalValidToolPayload: minimalValidInteractiveToolPayloadExample(params.request),
    }, null, 2),
    '',
    'Return a concise summary of files changed, tests or commands run, and any remaining blocker.',
  ].join('\n');
}

export function buildAgentServerGenerationPrompt(request: {
  prompt: string;
  skillDomain: SciForgeSkillDomain;
  metadata?: Record<string, unknown>;
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
  const currentUserRequest = stringField(sessionFacts.currentUserRequest) ?? extractAgentServerCurrentUserRequest(request.prompt);
  const executionMode = executionModeDecisionForPrompt(sessionFacts, scenarioFacts);
  const conversationPolicySummary = isRecord(sessionFacts.conversationPolicySummary)
    ? sessionFacts.conversationPolicySummary
    : isRecord(scenarioFacts.conversationPolicySummary)
      ? scenarioFacts.conversationPolicySummary
      : summarizeConversationPolicyForAgentServer(request.uiStateSummary);
  const capabilityBrokerBrief = isRecord(scenarioFacts.capabilityBrokerBrief)
    ? scenarioFacts.capabilityBrokerBrief
    : isRecord(request.availableRuntimeCapabilities) && request.availableRuntimeCapabilities.schemaVersion === 'sciforge.agentserver.capability-broker-brief.v1'
      ? request.availableRuntimeCapabilities
      : undefined;
  const promptRenderPlanSummary = promptRenderPlanSummaryForAgentServer(request, contextEnvelope, sessionFacts);
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
    capabilityBrokerBrief,
    promptRenderPlanSummary,
    currentReferences: Array.isArray(sessionFacts.currentReferences) ? sessionFacts.currentReferences : undefined,
    currentReferenceDigests: Array.isArray(sessionFacts.currentReferenceDigests) ? sessionFacts.currentReferenceDigests : undefined,
    strictTaskFilesReason: request.strictTaskFilesReason,
    outputContract: agentServerGenerationOutputContract(),
  };
  return [
    ...agentServerCurrentTurnSnapshotPromptPolicyLines(),
    JSON.stringify(clipForAgentServerJson(currentTurnSnapshot), null, 2),
    '',
    request.contextEnvelope ? JSON.stringify({
      version: request.contextEnvelope.version,
      workspaceFacts: Boolean(request.contextEnvelope.workspaceFacts),
      longTermRefs: Boolean(request.contextEnvelope.longTermRefs),
    }, null, 2) : '',
    ...agentServerBackendDecisionPromptPolicyLines({ freshCurrentTurn: request.freshCurrentTurn }),
    ...agentServerGenerationOutputContractLines('json-envelope'),
    ...agentServerExecutionModePromptPolicyLines(),
    ...agentServerGeneratedTaskPromptPolicyLines(),
    ...agentServerToolPayloadProtocolContractLines(),
    ...agentServerGenerationOutputContractLines('tool-payload'),
    ...agentServerCurrentReferencePromptPolicyLines(),
    request.strictTaskFilesReason
      ? `Strict retry reason: ${request.strictTaskFilesReason}`
      : '',
    ...agentServerWorkspaceTaskRoutingPromptPolicyLines('prior-task'),
    ...agentServerFreshRetrievalPromptPolicyLines(),
    ...agentServerWorkspaceTaskRoutingPromptPolicyLines('new-task'),
    ...agentServerCapabilityRoutingPromptPolicyLines(),
    ...agentServerLargeFilePromptContractLines(),
    ...agentServerBibliographicVerificationPromptPolicyLines(),
    ...agentServerArtifactSelectionPromptPolicyLines(),
    ...agentServerViewSelectionPromptPolicyLines(),
    ...agentServerContinuationPromptPolicyLines(),
    ...agentServerRepairPromptPolicyLines(),
    ...agentServerGenerationOutputContractLines('missing-input'),
    request.priorAttempts?.length ? [
      ...agentServerPriorAttemptsPromptPolicyLines(),
      JSON.stringify(summarizeTaskAttemptsForAgentServer(request.priorAttempts).slice(0, 4), null, 2),
    ].join('\n') : '',
    ...agentServerExternalIoReliabilityContractLines(),
    '',
    JSON.stringify(clipForAgentServerJson({
      ...compactGenerationRequestForAgentServer(request, capabilityBrokerBrief, promptRenderPlanSummary),
      taskContract: {
        argv: ['inputPath', 'outputPath'],
        outputPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
      },
    }), null, 2),
  ].join('\n');
}

function compactGenerationRequestForAgentServer(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  capabilityBrokerBrief: Record<string, unknown> | undefined,
  promptRenderPlanSummary: Record<string, unknown> | undefined,
) {
  const {
    availableSkills: _availableSkills,
    availableTools: _availableTools,
    availableRuntimeCapabilities: _availableRuntimeCapabilities,
    metadata: _metadata,
    ...rest
  } = request;
  return {
    ...rest,
    capabilityBrokerBrief,
    promptRenderPlanSummary,
    omittedCapabilityCatalog: {
      omitted: true,
      source: 'typescript-capability-broker',
      omittedCategories: ['legacy skill catalog', 'legacy tool catalog', 'legacy component catalog'],
      reason: 'T116 default backend handoff consumes compact broker briefs and keeps full schemas/examples/docs lazy.',
    },
  };
}

function promptRenderPlanSummaryForAgentServer(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  contextEnvelope: Record<string, unknown>,
  sessionFacts: Record<string, unknown>,
) {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const scenarioFacts = isRecord(contextEnvelope.scenarioFacts) ? contextEnvelope.scenarioFacts : {};
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'contextEnvelope.sessionFacts.agentHarnessHandoff', value: sessionFacts.agentHarnessHandoff },
    { source: 'contextEnvelope.sessionFacts.promptRenderPlan', value: sessionFacts.promptRenderPlan },
    { source: 'contextEnvelope.scenarioFacts.agentHarnessHandoff', value: scenarioFacts.agentHarnessHandoff },
    { source: 'contextEnvelope.scenarioFacts.promptRenderPlan', value: scenarioFacts.promptRenderPlan },
    { source: 'contextEnvelope.agentHarnessHandoff', value: contextEnvelope.agentHarnessHandoff },
    { source: 'contextEnvelope.promptRenderPlan', value: contextEnvelope.promptRenderPlan },
    { source: 'request.metadata.agentHarnessHandoff', value: metadata.agentHarnessHandoff },
    { source: 'request.metadata.promptRenderPlan', value: metadata.promptRenderPlan },
  ];
  for (const candidate of candidates) {
    const plan = promptRenderPlanFromCandidate(candidate.value);
    const summary = plan ? promptRenderPlanSummaryFromPlan(plan, candidate.source) : undefined;
    if (summary) return summary;
  }
  return undefined;
}

function promptRenderPlanFromCandidate(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.promptRenderPlan)) return value.promptRenderPlan;
  if (value.renderDigest !== undefined || value.renderedEntries !== undefined || value.sourceRefs !== undefined) {
    return value;
  }
  return undefined;
}

function promptRenderPlanSummaryFromPlan(plan: Record<string, unknown>, source: string) {
  const renderedEntries = Array.isArray(plan.renderedEntries)
    ? plan.renderedEntries.filter(isRecord).slice(0, 32).map(promptRenderPlanEntrySummary).filter(isRecord)
    : [];
  const sourceRefs = isRecord(plan.sourceRefs) ? clipForAgentServerJson(plan.sourceRefs, 2) : undefined;
  const renderDigest = stringField(plan.renderDigest);
  if (!renderDigest && !sourceRefs && !renderedEntries.length) return undefined;
  return {
    schemaVersion: 'sciforge.agentserver.prompt-render-plan-summary.v1',
    source,
    renderPlanSchemaVersion: stringField(plan.schemaVersion),
    renderMode: stringField(plan.renderMode),
    deterministic: plan.deterministic === true,
    renderDigest,
    sourceRefs,
    renderedEntries,
  };
}

function promptRenderPlanEntrySummary(entry: Record<string, unknown>) {
  const id = stringField(entry.id);
  const sourceCallbackId = stringField(entry.sourceCallbackId);
  if (!id || !sourceCallbackId) return undefined;
  const out: Record<string, unknown> = {
    kind: stringField(entry.kind) ?? 'strategy',
    id,
    sourceCallbackId,
  };
  const text = stringField(entry.text);
  if (text) out.text = clipForAgentServerPrompt(text, 800);
  if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) out.priority = entry.priority;
  return out;
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

export function summarizeToolsForAgentServer(request: GatewayRequest) {
  const capabilityBrokerBrief = buildCapabilityBrokerBriefForAgentServer(request);
  const briefs = Array.isArray(capabilityBrokerBrief.briefs)
    ? capabilityBrokerBrief.briefs.filter(isRecord)
    : [];
  return briefs.map((brief) => {
    const id = stringField(brief.id) ?? 'unknown-capability';
    return {
      id,
      label: stringField(brief.name) ?? id,
      toolType: stringField(brief.kind) ?? 'capability',
      description: stringField(brief.brief) ?? '',
      producesArtifactTypes: toStringList(brief.routingTags),
      selected: true,
      packageRoot: stringField(brief.ownerPackage),
      requiredConfig: [],
      tags: uniqueStrings([
        ...toStringList(brief.domains),
        ...toStringList(brief.routingTags),
      ]),
      providerIds: toStringList(brief.providerIds),
      score: typeof brief.score === 'number' ? brief.score : undefined,
      budget: isRecord(brief.budget) ? brief.budget : undefined,
      harnessSignals: toStringList(brief.harnessSignals),
    };
  });
}

export function summarizeRuntimeCapabilitiesForAgentServer(request: GatewayRequest) {
  return buildCapabilityBrokerBriefForAgentServer(request);
}

export function buildAgentServerCompactContext(
  request: GatewayRequest,
  params: {
    contextEnvelope: Record<string, unknown>;
    workspaceTree: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
    priorAttempts: unknown[];
    mode: AgentServerContextMode;
  },
) {
  const mode = params.mode;
  return {
    mode,
    workspaceTreeSummary: mode === 'full' ? params.workspaceTree : [],
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
