import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GatewayRequest, LlmEndpointConfig, SciForgeSkillDomain, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import { extractAgentServerCurrentUserRequest, normalizeConfiguredAgentServerLlmEndpoint } from '@sciforge-ui/runtime-contract/agentserver-prompt-policy';
import { expectedArtifactTypesForRequest, normalizeLlmEndpoint, selectedComponentIdsForRequest } from './gateway-request.js';
import { buildCapabilityBrokerBriefForAgentServer, buildContextEnvelope, expectedArtifactSchema, summarizeArtifactRefs, summarizeConversationLedger, summarizeConversationPolicyForAgentServer, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer, summarizeVerificationRecordForEnvelope, summarizeVerificationResultRecords, workspaceTreeSummary, type AgentServerContextMode } from './context-envelope.js';
import { agentServerAgentId, agentServerContextPolicy, contextWindowMetadata, fetchAgentServerContextSnapshot } from './agentserver-context-window.js';
import { cleanUrl, clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, extractLikelyErrorLine, hashJson, isRecord, readTextIfExists, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { normalizeBackendHandoff } from '../workspace-task-input.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import { sha1 } from '../workspace-task-runner.js';
import { parseJsonErrorMessage, redactSecretText, sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { ignoredLegacyRepairContextPolicyAuditForAgentServer, repairContextPolicySummaryForAgentServer } from './agentserver-repair-context-policy.js';
import { agentServerArtifactSelectionPromptPolicyLines, agentServerBibliographicVerificationPromptPolicyLines, agentServerCurrentReferencePromptPolicyLines, agentServerShouldIncludeBibliographicVerificationPromptPolicy, agentServerToolPayloadProtocolContractLines } from '@sciforge-ui/runtime-contract/artifact-policy';
import { collectRuntimeRefsFromValue, runtimePayloadKeyLooksLikeBodyCarrier } from '@sciforge-ui/runtime-contract/references';
import { normalizeTurnExecutionConstraints } from '@sciforge-ui/runtime-contract/turn-constraints';
import { agentServerBackendDecisionPromptPolicyLines, agentServerCapabilityRoutingPromptPolicyLines, agentServerContinuationPromptPolicyLines, agentServerCurrentTurnSnapshotPromptPolicyLines, agentServerExecutionModePromptPolicyLines, agentServerExternalIoReliabilityContractLines, agentServerFreshRetrievalPromptPolicyLines, agentServerGeneratedTaskPromptPolicyLines, agentServerGenerationOutputContract, agentServerGenerationOutputContractLines, agentServerLargeFilePromptContractLines, agentServerPriorAttemptsPromptPolicyLines, agentServerRepairPromptPolicyLines, agentServerToolPayloadShapeContract, agentServerViewSelectionPromptPolicyLines, agentServerWorkspaceTaskRepairPromptPolicyLines, agentServerWorkspaceTaskRoutingPromptPolicyLines } from '../../../packages/skills/runtime-policy';
import { minimalValidInteractiveToolPayloadExample } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy';
import {
  AGENTSERVER_BACKEND_HANDOFF_VERSION,
  validateBackendHandoffPacket,
  type BackendHandoffPacket,
} from './agentserver-context-contract.js';
import { summarizeUiStateForAgentServer } from './agentserver-context-summary.js';
import { sanitizePromptHandoffValue } from './agentserver-generation-prompts.js';
import { buildAgentServerRepairPrompt, buildCompactRepairContext } from './agentserver-repair-prompts.js';

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
      sessionBundleRel: sessionBundleRelForRequest(params.request),
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
    await writeAgentServerDebugArtifact(params.run.workspace, 'repair', runPayload, response.status, json, sessionBundleRelForRequest(params.request));
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
    await writeAgentServerDebugArtifact(params.run.workspace, 'repair', runPayload, 0, { error: errorMessage(error) }, sessionBundleRelForRequest(params.request));
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
  sessionBundleRel?: string,
) {
  try {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task}-${sha1(JSON.stringify(requestPayload)).slice(0, 8)}`;
    const rel = sessionBundleRel
      ? join(sessionBundleRel.replace(/\/+$/, ''), 'debug', 'agentserver', `${id}.json`)
      : join('.sciforge', 'debug', 'agentserver', `${id}.json`);
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

export { buildAgentServerGenerationPrompt } from './agentserver-generation-prompts.js';
export { buildAgentServerRepairPrompt, buildCompactRepairContext } from './agentserver-repair-prompts.js';
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

export { summarizeUiStateForAgentServer } from './agentserver-context-summary.js';
