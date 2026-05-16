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

export async function buildCompactRepairContext(params: {
  request: GatewayRequest;
  workspace: string;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}) {
  const inputRel = `.sciforge/task-inputs/${params.run.spec.id}.json`;
  const canExpandRepairOutput = bodyExpansionAllowedForRepairContext(params.request);
  const output = canExpandRepairOutput ? await readTextIfExists(join(params.workspace, params.run.outputRef)) : '';
  const outputWorkEvidenceSummary = canExpandRepairOutput
    ? summarizeWorkEvidenceForHandoff(parseJsonIfPossible(output))
    : undefined;
  const diagnosticText = repairDiagnosticTextForLikelyError(params.failureReason, params.schemaErrors, outputWorkEvidenceSummary);
  const rawContext = {
    version: 'sciforge.repair-context.v1',
    schemaVersion: 'sciforge.agentserver.repair-context.ref-first.v1',
    createdAt: new Date().toISOString(),
    projectFacts: {
      project: 'SciForge',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
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
      likelyErrorLine: extractLikelyErrorLine(diagnosticText),
      workEvidenceSummary: outputWorkEvidenceSummary,
    },
    repairMaterials: repairMaterialRefs(params.run, inputRel),
    sessionSummary: summarizeUiStateForAgentServer(params.request.uiState, 'delta'),
    artifacts: summarizeArtifactRefs(params.request.artifacts),
    recentExecutionRefs: summarizeExecutionRefs(toRecordList(params.request.uiState?.recentExecutionRefs)),
    priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts).slice(0, 4),
  };
  const repairContextPolicySummary = repairContextPolicySummaryForAgentServer(params.request, rawContext);
  const compactRepairContext = applyRefFirstRepairContextPolicyForAgentServer(rawContext, repairContextPolicySummary);
  const refFirstRepairContext = projectRepairContextForAgentServerPrompt(compactRepairContext);
  return withIgnoredLegacyRepairContextPolicyAudit(
    refFirstRepairContext,
    ignoredLegacyRepairContextPolicyAuditForAgentServer(params.request, rawContext),
  ) ?? refFirstRepairContext;
}

function bodyExpansionAllowedForRepairContext(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const constraints = normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
  if (!constraints) return true;
  return !(
    constraints.agentServerForbidden
    || constraints.workspaceExecutionForbidden
    || constraints.codeExecutionForbidden
    || constraints.externalIoForbidden
  );
}

function repairDiagnosticTextForLikelyError(
  failureReason: string,
  schemaErrors: string[],
  workEvidenceSummary: unknown,
) {
  const workEvidenceDiagnostics = toRecordList(isRecord(workEvidenceSummary) ? workEvidenceSummary.items : {})
    .flatMap((item) => [
      stringField(item.failureReason),
      ...toStringList(item.diagnostics),
      ...toStringList(item.recoverActions),
      stringField(item.nextStep),
    ]);
  return [
    failureReason,
    ...schemaErrors,
    ...workEvidenceDiagnostics,
  ].filter(Boolean).join('\n');
}

function repairMaterialRefs(run: WorkspaceTaskRunResult, inputRef: string) {
  return [
    repairMaterialRef('code', run.spec.taskRel, 'task-source'),
    repairMaterialRef('input', inputRef, 'task-input'),
    repairMaterialRef('output', run.outputRef, 'task-output'),
    repairMaterialRef('stdout', run.stdoutRef, 'process-log'),
    repairMaterialRef('stderr', run.stderrRef, 'process-log'),
  ].filter(Boolean);
}

function repairMaterialRef(kind: string, ref: string | undefined, role: string) {
  if (!ref) return undefined;
  return { kind, ref, role };
}

function applyRefFirstRepairContextPolicyForAgentServer(
  repairContext: Record<string, unknown>,
  policy: ReturnType<typeof repairContextPolicySummaryForAgentServer>,
) {
  if (!policy) return repairContext;
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const filtered: Record<string, unknown> = {
    ...repairContext,
    repairContextPolicy: {
      source: policy.source,
      sourceKind: policy.sourceKind,
      contractRef: policy.contractRef,
      traceRef: policy.traceRef,
      deterministicDecisionRef: policy.deterministicDecisionRef,
      kind: policy.kind,
      maxAttempts: policy.maxAttempts,
      includeStdoutSummary: policy.includeStdoutSummary,
      includeStderrSummary: policy.includeStderrSummary,
      includeValidationFindings: policy.includeValidationFindings,
      includePriorAttemptRefs: policy.includePriorAttemptRefs,
      allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
      blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    },
  };
  const audit = refFirstRepairContextPolicyAudit(policy);
  const failure = isRecord(repairContext.failure) ? { ...repairContext.failure } : {};
  applyRefFirstFailureFieldPolicy(failure, 'failureReason', repairPolicyRefs(workspaceRefs.outputRef, 'failureReason', 'failure:reason'), true, policy, audit);
  applyRefFirstFailureFieldPolicy(failure, 'workEvidenceSummary', repairPolicyRefs(workspaceRefs.outputRef, 'output', 'workEvidenceSummary'), true, policy, audit);
  filterRefFirstSchemaErrors(failure, repairPolicyRefs(workspaceRefs.outputRef, 'validation:findings', 'validator:findings', 'schemaErrors'), policy, audit);
  recordRefFirstEvidenceDecision(audit, 'diagnostics.stdoutRef', refFirstRepairEvidenceDecision(repairPolicyRefs(workspaceRefs.stdoutRef, 'stdout', 'stdoutSummary'), policy, policy.includeStdoutSummary));
  recordRefFirstEvidenceDecision(audit, 'diagnostics.stderrRef', refFirstRepairEvidenceDecision(repairPolicyRefs(workspaceRefs.stderrRef, 'stderr', 'stderrSummary'), policy, policy.includeStderrSummary));
  filtered.failure = failure;
  filtered.priorAttempts = policy.includePriorAttemptRefs ? repairContext.priorAttempts : [];
  if (!policy.includePriorAttemptRefs && Array.isArray(repairContext.priorAttempts) && repairContext.priorAttempts.length) {
    recordRefFirstEvidenceDecision(audit, 'priorAttempts', { include: false, reason: 'disabled', refs: ['priorAttempts'] });
  }
  filtered.repairContextPolicyAudit = audit;
  return filtered;
}

function applyRefFirstFailureFieldPolicy(
  failure: Record<string, unknown>,
  field: string,
  refs: string[],
  enabled: boolean,
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  audit: Record<string, unknown>,
) {
  if (failure[field] === undefined) return;
  const decision = refFirstRepairEvidenceDecision(refs, policy, enabled);
  recordRefFirstEvidenceDecision(audit, `failure.${field}`, decision);
  if (!decision.include) delete failure[field];
}

function filterRefFirstSchemaErrors(
  failure: Record<string, unknown>,
  refs: string[],
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  audit: Record<string, unknown>,
) {
  if (!Array.isArray(failure.schemaErrors)) return;
  const decision = refFirstRepairEvidenceDecision(refs, policy, policy.includeValidationFindings);
  recordRefFirstEvidenceDecision(audit, 'failure.schemaErrors', decision);
  if (!decision.include) delete failure.schemaErrors;
}

function refFirstRepairEvidenceDecision(
  refs: string[],
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  enabled = true,
) {
  const normalizedRefs = uniqueStrings(refs);
  if (!enabled) return { include: false, reason: 'disabled', refs: normalizedRefs };
  const blocked = normalizedRefs.filter((ref) => policy.blockedFailureEvidenceRefs.includes(ref));
  if (blocked.length) return { include: false, reason: 'blocked', refs: blocked };
  if (policy.allowedFailureEvidenceRefs.length) {
    const allowed = normalizedRefs.filter((ref) => policy.allowedFailureEvidenceRefs.includes(ref));
    if (!allowed.length) return { include: false, reason: 'not-allowed', refs: normalizedRefs };
    return { include: true, refs: allowed };
  }
  return { include: true, refs: normalizedRefs };
}

function recordRefFirstEvidenceDecision(
  audit: Record<string, unknown>,
  path: string,
  decision: { include: boolean; reason?: string; refs: string[] },
) {
  if (decision.include) {
    audit.includedFailureEvidenceRefs = uniqueStrings([
      ...toStringList(audit.includedFailureEvidenceRefs),
      ...decision.refs,
    ]);
    return;
  }
  audit.omittedFailureEvidenceRefs = uniqueStrings([
    ...toStringList(audit.omittedFailureEvidenceRefs),
    ...decision.refs,
  ]);
  const omittedFields = Array.isArray(audit.omittedFields) ? audit.omittedFields.filter(isRecord) : [];
  omittedFields.push({ path, reason: decision.reason, refs: decision.refs });
  audit.omittedFields = omittedFields;
}

function refFirstRepairContextPolicyAudit(
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
) {
  return {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-audit.v1',
    source: policy.source,
    sourceKind: policy.sourceKind,
    contractRef: policy.contractRef,
    traceRef: policy.traceRef,
    deterministicDecisionRef: policy.deterministicDecisionRef,
    deterministic: true,
    allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
    blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    includeStdoutSummary: policy.includeStdoutSummary,
    includeStderrSummary: policy.includeStderrSummary,
    includeValidationFindings: policy.includeValidationFindings,
    includePriorAttemptRefs: policy.includePriorAttemptRefs,
    ignoredLegacySources: policy.ignoredLegacySources,
    includedFailureEvidenceRefs: [],
    omittedFailureEvidenceRefs: [],
    omittedFields: [],
  };
}

function repairPolicyRefs(...refs: unknown[]) {
  return uniqueStrings(refs.flatMap((ref) => {
    const value = stringField(ref);
    return value ? [value] : [];
  }));
}

function projectRepairContextForAgentServerPrompt(repairContext: Record<string, unknown>) {
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const existingRefs = isRecord(repairContext.refs) ? repairContext.refs : {};
  const failure = isRecord(repairContext.failure) ? repairContext.failure : {};
  const existingDiagnostics = isRecord(repairContext.diagnostics) ? repairContext.diagnostics : undefined;
  const projectFacts = isRecord(repairContext.projectFacts) ? repairContext.projectFacts : {};
  const existingTaskContract = isRecord(repairContext.taskContract) ? repairContext.taskContract : {};
  const repairMaterials = toRecordList(repairContext.repairMaterials);
  const existingMaterials = toRecordList(existingRefs.materials);
  const out: Record<string, unknown> = {
    version: repairContext.version,
    schemaVersion: 'sciforge.agentserver.repair-context.ref-first.v1',
    createdAt: repairContext.createdAt,
    promptOrder: 'diagnostic-first/ref-first',
    diagnostics: Object.keys(failure).length
      ? repairDiagnosticsForPrompt(failure, repairContext)
      : existingDiagnostics,
    refs: {
      workspacePath: workspaceRefs.workspacePath ?? existingRefs.workspacePath,
      generatedTaskId: workspaceRefs.generatedTaskId ?? existingRefs.generatedTaskId,
      materials: repairMaterials.length
        ? repairMaterials
        : existingMaterials.length ? existingMaterials : repairMaterialRefsFromWorkspaceRefs(workspaceRefs),
    },
    currentGoal: repairContext.currentGoal,
    selectedSkill: repairContext.selectedSkill,
    taskContract: {
      ...existingTaskContract,
      outputPayloadKeys: toStringList(projectFacts.toolPayloadContract).length
        ? toStringList(projectFacts.toolPayloadContract)
        : existingTaskContract.outputPayloadKeys,
      ...agentServerToolPayloadShapeContract(),
    },
    sessionSummary: repairContext.sessionSummary,
    artifacts: repairContext.artifacts,
    recentExecutionRefs: repairContext.recentExecutionRefs,
    priorAttempts: repairContext.priorAttempts,
    repairContextPolicy: repairContext.repairContextPolicy,
    repairContextPolicyAudit: repairContext.repairContextPolicyAudit,
    repairContextPolicyIgnoredLegacyAudit: repairContext.repairContextPolicyIgnoredLegacyAudit,
    agentServerCoreSnapshot: repairContext.agentServerCoreSnapshot,
  };
  return removeUndefinedFields(sanitizePromptHandoffValue(out, 'repairContext') as Record<string, unknown>);
}

function repairDiagnosticsForPrompt(
  failure: Record<string, unknown>,
  repairContext: Record<string, unknown>,
) {
  return removeUndefinedFields({
    exitCode: failure.exitCode,
    failureReason: failure.failureReason,
    schemaErrors: failure.schemaErrors,
    likelyErrorLine: failure.likelyErrorLine,
    workEvidenceSummary: failure.workEvidenceSummary,
    evidenceRefs: repairDiagnosticEvidenceRefs(repairContext),
    materialBodies: 'omitted-ref-first',
  });
}

function repairDiagnosticEvidenceRefs(repairContext: Record<string, unknown>) {
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const policyAudit = isRecord(repairContext.repairContextPolicyAudit) ? repairContext.repairContextPolicyAudit : {};
  const included = toStringList(policyAudit.includedFailureEvidenceRefs);
  const omitted = toStringList(policyAudit.omittedFailureEvidenceRefs);
  const refs = [
    repairMaterialRef('output', stringField(workspaceRefs.outputRef), omitted.includes('output') ? 'omitted-by-policy' : 'diagnostic-ref'),
    repairMaterialRef('stdout', stringField(workspaceRefs.stdoutRef), included.includes('stdout') ? 'included-by-policy' : omitted.includes('stdout') ? 'omitted-by-policy' : 'diagnostic-ref'),
    repairMaterialRef('stderr', stringField(workspaceRefs.stderrRef), included.includes('stderr') ? 'included-by-policy' : omitted.includes('stderr') ? 'omitted-by-policy' : 'diagnostic-ref'),
  ].filter(Boolean);
  return refs.length ? refs : undefined;
}

function repairMaterialRefsFromWorkspaceRefs(workspaceRefs: Record<string, unknown>) {
  return [
    repairMaterialRef('code', stringField(workspaceRefs.codeRef), 'task-source'),
    repairMaterialRef('input', stringField(workspaceRefs.inputRef), 'task-input'),
    repairMaterialRef('output', stringField(workspaceRefs.outputRef), 'task-output'),
    repairMaterialRef('stdout', stringField(workspaceRefs.stdoutRef), 'process-log'),
    repairMaterialRef('stderr', stringField(workspaceRefs.stderrRef), 'process-log'),
  ].filter(Boolean);
}

function removeUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
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
  const repairContextWithAudit = withIgnoredLegacyRepairContextPolicyAudit(
    params.repairContext,
    ignoredLegacyRepairContextPolicyAuditForAgentServer(params.request, params.repairContext),
  );
  const repairContext = repairContextWithAudit
    ? projectRepairContextForAgentServerPrompt(repairContextWithAudit)
    : undefined;
  return [
    ...agentServerWorkspaceTaskRepairPromptPolicyLines('intro'),
    ...agentServerRepairPromptPolicyLines(),
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

function withIgnoredLegacyRepairContextPolicyAudit(
  repairContext: Record<string, unknown> | undefined,
  audit: Record<string, unknown> | undefined,
) {
  if (!repairContext || !audit) return repairContext;
  return {
    ...repairContext,
    repairContextPolicyIgnoredLegacyAudit: audit,
  };
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
  repairContinuation?: boolean;
  backendHandoffPacket?: BackendHandoffPacket;
  boundedRenderPlan?: Record<string, unknown>;
}) {
  const contextEnvelope = isRecord(request.contextEnvelope) ? request.contextEnvelope : {};
  const sessionFacts = isRecord(contextEnvelope.sessionFacts) ? contextEnvelope.sessionFacts : {};
  const scenarioFacts = isRecord(contextEnvelope.scenarioFacts) ? contextEnvelope.scenarioFacts : {};
  const currentUserRequest = stringField(sessionFacts.currentUserRequest) ?? extractAgentServerCurrentUserRequest(request.prompt);
  const executionMode = executionModeDecisionForPrompt(sessionFacts, scenarioFacts);
  const rawConversationPolicySummary = isRecord(sessionFacts.conversationPolicySummary)
    ? sessionFacts.conversationPolicySummary
    : isRecord(scenarioFacts.conversationPolicySummary)
      ? scenarioFacts.conversationPolicySummary
      : summarizeConversationPolicyForAgentServer(request.uiStateSummary);
  const conversationPolicySummary = isRecord(rawConversationPolicySummary) ? rawConversationPolicySummary : undefined;
  const capabilityBrokerBrief = isRecord(scenarioFacts.capabilityBrokerBrief)
    ? scenarioFacts.capabilityBrokerBrief
    : isRecord(request.availableRuntimeCapabilities) && request.availableRuntimeCapabilities.schemaVersion === 'sciforge.agentserver.capability-broker-brief.v1'
      ? request.availableRuntimeCapabilities
      : undefined;
  const capabilityBrokerRouteSummary = compactCapabilityBrokerRouteSummary(capabilityBrokerBrief);
  const backendHandoffPacket = backendHandoffPacketForPrompt(request, contextEnvelope);
  const promptRenderPlanSummary = promptRenderPlanSummaryForAgentServer(request, contextEnvelope, sessionFacts);
  const projectSessionProjection = isRecord(sessionFacts.handoffMemoryProjection)
    ? compactProjectSessionMemoryProjectionForPrompt(sessionFacts.handoffMemoryProjection)
    : undefined;
  const currentTurnSnapshot = agentServerCurrentTurnSnapshotFromHandoff({
    request,
    currentUserRequest,
    backendHandoffPacket,
    promptRenderPlanSummary,
    conversationPolicySummary,
    executionMode,
    capabilityBrokerRouteSummary,
    projectSessionProjection,
  });
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
    ...agentServerBibliographicPolicyLinesForRequest(request, scenarioFacts),
    ...agentServerArtifactSelectionPromptPolicyLines(),
    ...agentServerViewSelectionPromptPolicyLines(),
    request.repairContinuation ? agentServerRepairContinuationHardStopPromptLines() : '',
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
      ...compactGenerationRequestForAgentServer(request, capabilityBrokerRouteSummary, promptRenderPlanSummary),
      taskContract: {
        argv: ['inputPath', 'outputPath'],
        outputPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
        ...agentServerToolPayloadShapeContract(),
      },
    }), null, 2),
  ].join('\n');
}

function agentServerCurrentTurnSnapshotFromHandoff(params: {
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0];
  currentUserRequest: string;
  backendHandoffPacket: BackendHandoffPacket | undefined;
  promptRenderPlanSummary: Record<string, unknown> | undefined;
  conversationPolicySummary: Record<string, unknown> | undefined;
  executionMode: ReturnType<typeof executionModeDecisionForPrompt>;
  capabilityBrokerRouteSummary: Record<string, unknown> | undefined;
  projectSessionProjection: Record<string, unknown> | undefined;
}) {
  const packet = params.backendHandoffPacket;
  return {
    kind: 'SciForgeCurrentTurnSnapshot',
    snapshotSource: packet ? 'BackendHandoffPacket' : 'bounded-render-plan',
    currentUserRequest: params.currentUserRequest,
    skillDomain: params.request.skillDomain,
    expectedArtifactTypes: params.request.expectedArtifactTypes ?? [],
    selectedComponentIds: params.request.selectedComponentIds ?? [],
    executionModeRecommendation: params.executionMode.executionModeRecommendation,
    complexityScore: params.executionMode.complexityScore,
    uncertaintyScore: params.executionMode.uncertaintyScore,
    reproducibilityLevel: params.executionMode.reproducibilityLevel,
    stagePlanHint: params.executionMode.stagePlanHint,
    executionModeReason: params.executionMode.executionModeReason,
    conversationPolicySummary: params.conversationPolicySummary,
    executionScope: 'backend-decides',
    backendHandoffPacket: packet ? {
      contractVersion: packet._contractVersion,
      sessionId: packet.sessionId,
      turnId: packet.turnId,
      currentTurnRef: packet.currentTurnRef,
      contextRefs: packet.contextRefs.slice(0, 24),
      retrievalTools: packet.retrievalTools,
      contextSnapshotRef: packet.contextSnapshotRef,
      compactionAuditRefs: packet.compactionAuditRefs?.slice(0, 8),
      retrievalAuditRefs: packet.retrievalAuditRefs?.slice(0, 8),
      syntheticAuditMeta: packet.syntheticAuditMeta ? {
        synthetic: true,
        source: packet.syntheticAuditMeta.source,
        upstream: packet.syntheticAuditMeta.upstream,
        reason: packet.syntheticAuditMeta.reason,
        confidence: packet.syntheticAuditMeta.confidence,
        sourceRefs: packet.syntheticAuditMeta.sourceRefs.slice(0, 8),
      } : undefined,
    } : undefined,
    capabilityBrokerBrief: params.capabilityBrokerRouteSummary,
    promptRenderPlanSummary: params.promptRenderPlanSummary,
    projectSessionMemoryProjection: params.projectSessionProjection ? {
      schemaVersion: params.projectSessionProjection.schemaVersion,
      stablePrefixHash: params.projectSessionProjection.stablePrefixHash,
      selectedContextRefs: params.projectSessionProjection.selectedContextRefs,
      contextRefs: params.projectSessionProjection.contextRefs,
      retrievalTools: params.projectSessionProjection.retrievalTools,
    } : undefined,
    strictTaskFilesReason: params.request.strictTaskFilesReason,
    repairContinuation: params.request.repairContinuation ? {
      mode: 'minimal-single-stage-repair-continuation',
      terminalPayloadContract: [
        'Return only one terminal compact JSON object.',
        'Allowed success shape: AgentServerGenerationResponse containing a minimal provider-route adapter task for the existing failed unit.',
        'Allowed blocked shape: SciForge ToolPayload with executionUnits.status="failed-with-reason", failureReason, recoverActions, nextStep, and refs/digests-only follow-up.',
        'No broad repair loop, full pipeline regeneration, or exploratory history scan.',
      ],
    } : undefined,
    outputContract: agentServerGenerationOutputContract(),
  };
}

function agentServerRepairContinuationHardStopPromptLines() {
  return [
    'Repair-continuation hard stop:',
    '- This is not a fresh research, planning, or full pipeline generation turn.',
    '- Perform one minimal stage only: continue or repair the existing failed task using the compact diagnostic refs already supplied.',
    '- Do not explore broad history, enumerate prior task attempts, regenerate a complete pipeline, or deliberate through repeated tool loops.',
    '- Read at most the specific code/stdout/stderr/output refs needed for the failed execution unit; prefer digests and refs over raw bodies.',
    '- Terminal contract: return exactly one compact JSON object in one of two shapes only.',
    '- Success shape: a runnable AgentServerGenerationResponse whose taskFiles implement a minimal provider-route adapter task for the existing failed execution unit; the adapter must use the supplied capability/provider route refs and must not rebuild the whole pipeline.',
    '- Blocked shape: a valid SciForge ToolPayload with executionUnits.status="failed-with-reason", concise failureReason, recoverActions, nextStep, and evidence refs that request refs/digests-only follow-up.',
    '- Stop after the terminal JSON. Do not start another repair pass, broad loop, or exploratory provider/status investigation.',
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
    contextEnvelope,
    boundedRenderPlan: _boundedRenderPlan,
    metadata: _metadata,
    ...rest
  } = request;
  const artifacts = toRecordList(rest.artifacts);
  const recentExecutionRefs = toRecordList(rest.recentExecutionRefs);
  const sanitizedRest = sanitizePromptHandoffValue(rest, 'generationRequest');
  return {
    ...(isRecord(sanitizedRest) ? sanitizedRest : {}),
    artifacts: artifacts.length ? summarizeArtifactRefs(artifacts) : undefined,
    recentExecutionRefs: recentExecutionRefs.length ? summarizeExecutionRefs(recentExecutionRefs) : undefined,
    uiStateSummary: sanitizeUiStateSummaryForPrompt(rest.uiStateSummary),
    contextEnvelope: compactContextEnvelopeForAgentServer(contextEnvelope),
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

function agentServerBibliographicPolicyLinesForRequest(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  scenarioFacts: Record<string, unknown>,
) {
  const include = agentServerShouldIncludeBibliographicVerificationPromptPolicy({
    skillDomain: request.skillDomain,
    expectedArtifactTypes: request.expectedArtifactTypes,
    selectedComponentIds: request.selectedComponentIds,
    selectedCapabilityIds: [
      ...toStringList(scenarioFacts.selectedToolIds),
      ...toStringList(scenarioFacts.selectedSenseIds),
      ...toStringList(scenarioFacts.selectedVerifierIds),
    ],
  });
  return include ? agentServerBibliographicVerificationPromptPolicyLines() : [];
}

function compactCapabilityBrokerRouteSummary(value: Record<string, unknown> | undefined) {
  if (!isRecord(value)) return undefined;
  const briefs = toRecordList(value.briefs);
  const maxBriefs = 6;
  return {
    schemaVersion: stringField(value.schemaVersion),
    source: stringField(value.source),
    contract: stringField(value.contract),
    routingPolicy: isRecord(value.routingPolicy) ? {
      decisionOwner: stringField(value.routingPolicy.decisionOwner),
      contractExpansion: stringField(value.routingPolicy.contractExpansion),
      defaultPayload: stringField(value.routingPolicy.defaultPayload),
    } : undefined,
    briefs: briefs.slice(0, maxBriefs).map(compactCapabilityBriefForPrompt),
    omittedBriefCount: Math.max(0, briefs.length - maxBriefs),
    harnessInputAudit: compactHarnessInputAuditForPrompt(value.harnessInputAudit),
    inputSummary: isRecord(value.inputSummary) ? {
      objectRefs: value.inputSummary.objectRefs,
      artifactIndexEntries: value.inputSummary.artifactIndexEntries,
      failureHistoryEntries: value.inputSummary.failureHistoryEntries,
      toolBudgetKeys: toStringList(value.inputSummary.toolBudgetKeys).slice(0, 16),
    } : undefined,
  };
}

function compactHarnessInputAuditForPrompt(value: unknown) {
  if (!isRecord(value)) return undefined;
  const consumed = isRecord(value.consumed) ? value.consumed : {};
  return {
    schemaVersion: stringField(value.schemaVersion),
    status: stringField(value.status),
    source: stringField(value.source),
    enablement: stringField(value.enablement),
    contractRef: stringField(value.contractRef),
    traceRef: stringField(value.traceRef),
    profileId: stringField(value.profileId),
    consumed: {
      skillHints: value.consumed && typeof consumed.skillHints === 'number' ? consumed.skillHints : undefined,
      blockedCapabilities: value.consumed && typeof consumed.blockedCapabilities === 'number' ? consumed.blockedCapabilities : undefined,
      preferredCapabilityIds: value.consumed && typeof consumed.preferredCapabilityIds === 'number' ? consumed.preferredCapabilityIds : undefined,
      providerAvailability: value.consumed && typeof consumed.providerAvailability === 'number' ? consumed.providerAvailability : undefined,
      toolBudgetKeys: toStringList(consumed.toolBudgetKeys).slice(0, 16),
      verificationPolicyKeys: toStringList(consumed.verificationPolicyKeys).slice(0, 16),
      verificationPolicyMode: stringField(consumed.verificationPolicyMode),
    },
    sources: toRecordList(value.sources).slice(0, 8).map((source) => ({
      source: stringField(source.source),
      contractRef: stringField(source.contractRef),
      traceRef: stringField(source.traceRef),
      profileId: stringField(source.profileId),
    })),
  };
}

function compactCapabilityBriefForPrompt(brief: Record<string, unknown>) {
  const budget = isRecord(brief.budget) ? brief.budget : {};
  return {
    id: stringField(brief.id),
    name: stringField(brief.name),
    kind: stringField(brief.kind),
    ownerPackage: stringField(brief.ownerPackage),
    brief: clipForAgentServerPrompt(brief.brief, 260),
    score: typeof brief.score === 'number' && Number.isFinite(brief.score) ? brief.score : undefined,
    costClass: stringField(brief.costClass),
    latencyClass: stringField(brief.latencyClass),
    sideEffectClass: stringField(brief.sideEffectClass),
    routingTags: toStringList(brief.routingTags).slice(0, 8),
    domains: toStringList(brief.domains).slice(0, 6),
    providerIds: toStringList(brief.providerIds).slice(0, 6),
    budget: {
      status: stringField(budget.status),
      limits: clipForAgentServerPrompt(budget.limits, 120),
    },
    excluded: clipForAgentServerPrompt(brief.excluded, 180),
  };
}

function compactProjectSessionMemoryProjectionForPrompt(value: Record<string, unknown>) {
  const projectSessionMemory = isRecord(value.projectSessionMemory) ? value.projectSessionMemory : {};
  return {
    schemaVersion: stringField(value.schemaVersion),
    authority: stringField(value.authority),
    mode: stringField(value.mode),
    projectSessionMemory: {
      schemaVersion: stringField(projectSessionMemory.schemaVersion),
      sessionId: stringField(projectSessionMemory.sessionId),
      eventCount: typeof projectSessionMemory.eventCount === 'number' ? projectSessionMemory.eventCount : undefined,
      refCount: typeof projectSessionMemory.refCount === 'number' ? projectSessionMemory.refCount : undefined,
      eventIndex: toRecordList(projectSessionMemory.eventIndex).slice(-16).map((entry) => ({
        eventId: stringField(entry.eventId),
        kind: stringField(entry.kind),
        runId: stringField(entry.runId),
        summary: clipForAgentServerPrompt(entry.summary, 220),
        refs: toStringList(entry.refs).slice(0, 6),
      })),
      refIndex: toRecordList(projectSessionMemory.refIndex).slice(-24).map((entry) => ({
        ref: stringField(entry.ref),
        kind: stringField(entry.kind),
        digest: stringField(entry.digest),
        sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : undefined,
        producerRunId: stringField(entry.producerRunId),
      })),
      failureIndex: toRecordList(projectSessionMemory.failureIndex).slice(-8).map((entry) => ({
        eventId: stringField(entry.eventId),
        runId: stringField(entry.runId),
        summary: clipForAgentServerPrompt(entry.summary, 220),
        refs: toStringList(entry.refs).slice(0, 6),
      })),
    },
    stablePrefixHash: stringField(value.stablePrefixHash),
    contextProjectionBlocks: toRecordList(value.contextProjectionBlocks).slice(0, 8).map((block) => ({
      blockId: stringField(block.blockId),
      kind: stringField(block.kind),
      sha256: stringField(block.sha256),
      cacheTier: stringField(block.cacheTier),
      tokenEstimate: typeof block.tokenEstimate === 'number' ? block.tokenEstimate : undefined,
      sourceEventIds: toStringList(block.sourceEventIds).slice(0, 12),
    })),
    selectedContextRefs: toStringList(value.selectedContextRefs).slice(0, 24),
    contextRefs: toStringList(value.contextRefs).slice(0, 48),
    retrievalTools: toStringList(value.retrievalTools).slice(0, 8),
  };
}

function compactContextEnvelopeForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'continuityRules' || key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (key === 'agentServerCoreSnapshot') {
      const snapshot = compactAgentServerCoreSnapshotForPrompt(entry);
      if (snapshot) out.agentServerCoreSnapshot = snapshot;
      continue;
    }
    if (key === 'projectFacts') {
      const projectFacts = compactProjectFactsForAgentServer(entry);
      if (projectFacts) out.projectFacts = projectFacts;
      continue;
    }
    if (key === 'orchestrationBoundary') {
      const boundary = compactOrchestrationBoundaryForAgentServer(entry);
      if (boundary) out.orchestrationBoundary = boundary;
      continue;
    }
    if (key === 'sessionFacts' || key === 'scenarioFacts') {
      const facts = sanitizeContextFactsForPrompt(entry, key);
      if (facts) out[key] = facts;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, key);
  }
  return out;
}

function compactAgentServerCoreSnapshotForPrompt(value: unknown) {
  if (!isRecord(value)) return undefined;
  const session = isRecord(value.session) ? value.session : {};
  const currentWork = isRecord(value.currentWork) ? value.currentWork : {};
  const recentTurnRefs = toRecordList(value.recentTurnRefs);
  const legacyRecentTurns = toRecordList(value.recentTurns);
  const boundedTurnRefs = recentTurnRefs.length ? recentTurnRefs : legacyRecentTurns;
  const compactionTags = toRecordList(currentWork.compactionTags);
  return {
    source: stringField(value.source) ?? 'AgentServer Core /context',
    session: {
      id: stringField(session.id),
      status: stringField(session.status),
      updatedAt: stringField(session.updatedAt),
    },
    recentTurnRefs: boundedTurnRefs.slice(-6).map((turn) => ({
      turnNumber: typeof turn.turnNumber === 'number' ? turn.turnNumber : undefined,
      role: stringField(turn.role),
      runId: stringField(turn.runId),
      contentRef: stringField(turn.contentRef),
      contentOmitted: true,
      contentDigest: stringField(turn.contentDigest) ?? stringField(turn.digest) ?? (typeof turn.content === 'string' ? hashJson(turn.content) : undefined),
      contentChars: typeof turn.contentChars === 'number' && Number.isFinite(turn.contentChars)
        ? turn.contentChars
        : typeof turn.content === 'string' ? turn.content.length : undefined,
      createdAt: stringField(turn.createdAt),
    })),
    currentWork: {
      entryCount: typeof currentWork.entryCount === 'number' ? currentWork.entryCount : undefined,
      rawTurnCount: typeof currentWork.rawTurnCount === 'number' ? currentWork.rawTurnCount : undefined,
      compactionTags: compactionTags.slice(-8).map((entry) => ({
        kind: stringField(entry.kind),
        id: stringField(entry.id),
        turns: stringField(entry.turns),
        archived: entry.archived === true ? true : undefined,
        summaryDigest: hashJson(entry.summary),
        summaryItems: Array.isArray(entry.summary) ? entry.summary.length : undefined,
      })),
    },
  };
}

function compactProjectFactsForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    project: stringField(value.project),
    toolPayloadContract: Array.isArray(value.toolPayloadContract) ? value.toolPayloadContract : undefined,
    taskCodePolicyRef: stringField(value.taskCodePolicyRef),
    toolPayloadContractRef: stringField(value.toolPayloadContractRef),
  };
}

function compactOrchestrationBoundaryForAgentServer(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    decisionOwner: stringField(value.decisionOwner),
    currentUserRequestIsAuthoritative: value.currentUserRequestIsAuthoritative === true ? true : undefined,
    agentId: stringField(value.agentId),
    agentServerCoreSnapshotAvailable: value.agentServerCoreSnapshotAvailable === true ? true : undefined,
  };
}

function omitRawPromptRenderPlanCarriers(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    out[key] = entry;
  }
  return out;
}

function sanitizeContextFactsForPrompt(value: unknown, source: string) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (key === 'verificationResult') {
      const summary = summarizeVerificationRecordForEnvelope(entry, `${source}.${key}`);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'recentVerificationResults' || key === 'verificationResults') {
      const summary = summarizeVerificationResultRecords(toRecordList(entry), `${source}.${key}`);
      if (summary.length) out[key] = summary;
      continue;
    }
    if (key === 'artifacts') {
      const artifacts = summarizeArtifactRefs(toRecordList(entry));
      if (artifacts.length) out[key] = artifacts;
      continue;
    }
    if (key === 'recentExecutionRefs' || key === 'executionUnits') {
      const refs = summarizeExecutionRefs(toRecordList(entry));
      if (refs.length) out[key] = refs;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, `${source}.${key}`);
  }
  return out;
}

function sanitizeUiStateSummaryForPrompt(value: unknown) {
  if (!isRecord(value)) return sanitizePromptHandoffValue(value, 'uiStateSummary');
  return sanitizeContextFactsForPrompt(value, 'uiStateSummary');
}

function sanitizePromptHandoffValue(value: unknown, path = ''): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return clipForAgentServerPrompt(value, 1800);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const limit = path.endsWith('.messages') || path.endsWith('.recentConversation') ? 12 : 16;
    return value.slice(-limit).map((entry, index) => sanitizePromptHandoffValue(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'agentHarnessHandoff' || key === 'promptRenderPlan') continue;
    if (isBodyCarrierKey(key)) {
      const summary = promptBodyCarrierSummary(key, entry);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'verificationResult') {
      const summary = summarizeVerificationRecordForEnvelope(entry, `${path}.${key}`);
      if (summary) out[key] = summary;
      continue;
    }
    if (key === 'verificationResults' || key === 'recentVerificationResults') {
      const summary = summarizeVerificationResultRecords(toRecordList(entry), `${path}.${key}`);
      if (summary.length) out[key] = summary;
      continue;
    }
    out[key] = sanitizePromptHandoffValue(entry, path ? `${path}.${key}` : key);
  }
  return out;
}

function isBodyCarrierKey(key: string) {
  if (runtimePayloadKeyLooksLikeBodyCarrier(key)) return true;
  const lower = key.toLowerCase();
  if ([
    'code',
    'sourcecode',
    'tasksource',
    'generatedsource',
    'generatedtasksource',
    'filecontent',
    'filecontents',
    'taskfiles',
    'output',
    'result',
    'finaltext',
  ].includes(lower)) return true;
  return /(?:generated|task|file|agentserver).*?(?:code|source|content|output|result|text)$/i.test(key);
}

function promptBodyCarrierSummary(key: string, value: unknown) {
  if (value === undefined) return undefined;
  return {
    omitted: `prompt-handoff-${key}-body`,
    shape: promptValueShape(value),
    refs: collectRuntimeRefsFromValue(value, { maxRefs: 16 }),
    hash: hashJson(value),
  };
}

function promptValueShape(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { kind: 'string', chars: value.length };
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: typeof value };
  if (Array.isArray(value)) return { kind: 'array', count: value.length };
  if (isRecord(value)) return { kind: 'object', keys: Object.keys(value).slice(0, 16) };
  return { kind: value === null ? 'null' : typeof value };
}

function promptRenderPlanSummaryForAgentServer(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  contextEnvelope: Record<string, unknown>,
  sessionFacts: Record<string, unknown>,
) {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'request.boundedRenderPlan', value: request.boundedRenderPlan },
    { source: 'contextEnvelope.boundedRenderPlan', value: contextEnvelope.boundedRenderPlan },
    { source: 'contextEnvelope.sessionFacts.boundedRenderPlan', value: sessionFacts.boundedRenderPlan },
    { source: 'request.metadata.boundedRenderPlan', value: metadata.boundedRenderPlan },
  ];
  for (const candidate of candidates) {
    const plan = promptRenderPlanFromCandidate(candidate.value);
    const summary = plan ? promptRenderPlanSummaryFromPlan(plan, candidate.source) : undefined;
    if (summary) return summary;
  }
  return undefined;
}

function backendHandoffPacketForPrompt(
  request: Parameters<typeof buildAgentServerGenerationPrompt>[0],
  contextEnvelope: Record<string, unknown>,
): BackendHandoffPacket | undefined {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const candidates = [
    request.backendHandoffPacket,
    contextEnvelope.backendHandoffPacket,
    metadata.backendHandoffPacket,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const result = validateBackendHandoffPacket(candidate);
    if (result.ok && candidate._contractVersion === AGENTSERVER_BACKEND_HANDOFF_VERSION) {
      return candidate as unknown as BackendHandoffPacket;
    }
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
