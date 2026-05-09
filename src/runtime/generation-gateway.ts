import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { agentServerGenerationSkill, loadSkillRegistry } from './skill-registry.js';
import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { AgentBackendAdapter, AgentBackendCapabilities, AgentServerGenerationResponse, BackendContextCompactionResult, BackendContextWindowState, SciForgeSkillDomain, GatewayRequest, LlmEndpointConfig, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeContextBudget, WorkspaceRuntimeContextCompaction, WorkspaceRuntimeContextWindowSource, WorkspaceRuntimeEvent, WorkspaceTaskRunResult } from './runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from './workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';
import { emitWorkspaceRuntimeEvent, throwIfRuntimeAborted } from './workspace-runtime-events.js';
import { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
import { cleanUrl, clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, generatedTaskArchiveRel, hashJson, headForAgentServer, isRecord, isTaskInputRel, readTextIfExists, safeWorkspaceRel, summarizeTextChange, tailForAgentServer, toRecordList, toStringList, uniqueStrings } from './gateway-utils.js';
import { normalizeBackendHandoff } from './workspace-task-input.js';
import {
  expectedArtifactTypesForRequest,
  normalizeGatewayRequest as normalizeGatewayRequestFromModule,
  normalizeLlmEndpoint,
  selectedComponentIdsForRequest,
} from './gateway/gateway-request.js';
import {
  buildContextEnvelope,
  expectedArtifactSchema,
  summarizeArtifactRefs,
  summarizeConversationLedger,
  summarizeExecutionRefs,
  summarizeTaskAttemptsForAgentServer,
  workspaceTreeSummary,
  type AgentServerContextMode,
} from './gateway/context-envelope.js';
import { applyRuntimeVerificationPolicy } from './gateway/verification-policy.js';
import { repairNeededPayload as buildRepairNeededPayload, type RepairPolicyRefs } from './gateway/repair-policy.js';
import {
  normalizeAgentServerWorkspaceEvent as normalizeAgentServerWorkspaceEventFromModule,
  withRequestContextWindowLimit as withRequestContextWindowLimitFromModule,
} from './gateway/workspace-event-normalizer.js';
import { runAgentServerGeneratedTask as runAgentServerGeneratedTaskFromModule } from './gateway/generated-task-runner.js';
import {
  agentServerAgentId,
  agentServerContextPolicy,
  compactCapabilityForBackend,
  compactBackendContext,
  contextCompactionMetadata,
  contextWindowMetadata,
  estimateWorkspaceContextWindowState,
  fetchAgentServerContextSnapshot,
  formatContextWindowState,
  currentTurnReferences,
  handoffBudgetDecisionRecords,
  handoffContextWindowState,
  preflightAgentServerContextWindow,
  readBackendContextWindowState,
  requestNeedsAgentServerContinuity,
  workspaceContextWindowStateFromBackend,
} from './gateway/agentserver-context-window.js';
import {
  coerceAgentServerToolPayload,
  coerceWorkspaceTaskPayload,
  configureDirectAnswerArtifactContext,
  ensureDirectAnswerReportArtifact,
  extractJson,
  extractStandaloneJson,
  mergeReusableContextArtifactsForDirectPayload,
  normalizeToolPayloadShape,
  toolPayloadFromPlainAgentOutput,
} from './gateway/direct-answer-payload.js';
import { directContextFastPathPayload } from './gateway/direct-context-fast-path.js';
import {
  agentServerLlmRuntime,
  buildAgentServerCompactContext,
  buildAgentServerGenerationPrompt,
  buildAgentServerRepairPrompt,
  buildCompactRepairContext,
  contextEnvelopeMode,
  hasExplicitRequestLlmConfig,
  missingUserLlmEndpointMessage,
  readConfiguredAgentServerBaseUrl,
  readConfiguredLlmEndpoint,
  redactSecrets,
  requestAgentServerRepair,
  requiresUserLlmEndpoint,
  summarizeSkillsForAgentServer,
  summarizeRuntimeCapabilitiesForAgentServer,
  summarizeToolsForAgentServer,
  writeAgentServerDebugArtifact,
} from './gateway/agentserver-prompts.js';
import {
  agentServerRequestFailureMessage,
  agentServerRunFailure,
  agentServerSessionRef,
  extractAgentServerOutputText,
  parseGenerationResponse,
  parseToolPayloadResponse,
} from './gateway/agentserver-run-output.js';
import { evaluateToolPayloadEvidence } from './gateway/work-evidence-guard.js';
import { evaluateGuidanceAdoption } from './gateway/guidance-adoption-guard.js';
import { collectWorkEvidenceFromBackendEvent, summarizeWorkEvidenceForHandoff, type WorkEvidence } from './gateway/work-evidence-types.js';
import { createLatencyTelemetry } from './gateway/latency-telemetry.js';
import {
  agentServerFailurePayloadRefs,
  agentServerGenerationFailureReason,
  configurePayloadValidationContext,
  failedTaskPayload,
  repairNeededPayload,
  schemaErrors,
  validateAndNormalizePayload,
} from './gateway/payload-validation.js';
import { collectArtifactReferenceContext } from './gateway/artifact-reference-context.js';
import {
  boundedRateLimitBackoffMs,
  classifyAgentServerBackendFailure,
  isContextWindowExceededError,
  parseJsonErrorMessage,
  providerRateLimitDiagnosticMessage,
  rateLimitRecoverActions,
  redactSecretText,
  retryAfterMsFromText,
  sanitizeAgentServerError,
  type AgentServerBackendFailureDiagnostic,
  type AgentServerBackendFailureKind,
} from './gateway/backend-failure-diagnostics.js';
import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';
import { applyConversationPolicy } from './conversation-policy/apply.js';
import { toolPackageManifests } from '../../packages/tools';
import { agentHandoffSourceMetadata } from '../shared/agentHandoff.js';

const AGENT_BACKEND_ANSWER_PRINCIPLE = [
  'All normal user-visible answers must be reasoned by the agent backend.',
  'SciForge must not use preset reply templates for user requests; local code may only provide protocol validation, execution recovery, safety-boundary diagnostics, and artifact display.',
].join(' ');

configureDirectAnswerArtifactContext(collectArtifactReferenceContext);
configurePayloadValidationContext(attemptPlanRefs);

function requestHandoffSource(request: GatewayRequest) {
  return request.handoffSource ?? 'cli';
}

interface AgentServerGenerationRetryAudit {
  schemaVersion: 'sciforge.agentserver-generation-retry.v1';
  attempt: 2;
  maxAttempts: 2;
  trigger: AgentServerBackendFailureDiagnostic;
  firstFailedAt: string;
  backoffMs: number;
  recoveryActions: string[];
  contextPolicy: {
    mode: 'delta';
    handoff: 'slimmed';
    compactBeforeRetry: true;
    maxRetryCount: 1;
  };
  compaction?: ReturnType<typeof contextCompactionMetadata>;
  priorHandoff?: {
    rawRef: string;
    rawBytes: number;
    normalizedBytes: number;
  };
}
type AgentServerGenerationFailureDiagnostics = {
  kind: 'contextWindowExceeded' | 'rateLimit' | 'agentserver';
  categories?: AgentServerBackendFailureKind[];
  retryAfterMs?: number;
  resetAt?: string;
  retryAudit?: AgentServerGenerationRetryAudit;
  backend?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionRef?: string;
  originalErrorSummary: string;
  compaction?: BackendContextCompactionResult;
  priorHandoff?: AgentServerGenerationRetryAudit['priorHandoff'];
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
};
type AgentServerGenerationResult =
  | { ok: true; runId?: string; response: AgentServerGenerationResponse }
  | { ok: true; runId?: string; directPayload: ToolPayload }
  | { ok: false; error: string; diagnostics?: AgentServerGenerationFailureDiagnostics };

export async function runWorkspaceRuntimeGateway(body: Record<string, unknown>, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  const normalizedRequest = normalizeGatewayRequestFromModule(body);
  const telemetry = createLatencyTelemetry(normalizedRequest, callbacks);
  try {
    const policyApplication = await applyConversationPolicy(normalizedRequest, telemetry.callbacks, { workspace: normalizedRequest.workspacePath });
    telemetry.markPolicyApplication(policyApplication);
    const request = policyApplication.request;
    const directContextPayload = directContextFastPathPayload(request);
    if (directContextPayload) {
      emitWorkspaceRuntimeEvent(telemetry.callbacks, {
        type: 'direct-context-fast-path',
        source: 'workspace-runtime',
        status: 'completed',
        message: 'Python policy selected direct-context-answer; answered from existing session context without starting a workspace task.',
        raw: {
          executionModePlan: request.uiState?.executionModePlan,
          responsePlan: request.uiState?.responsePlan,
          latencyPolicy: request.uiState?.latencyPolicy,
        },
      });
      telemetry.markVerificationStart();
      const verified = await applyRuntimeVerificationPolicy(directContextPayload, request);
      telemetry.markVerificationEnd();
      return telemetry.emitFinal(verified) ?? verified;
    }
    const visionSensePayload = await tryRunVisionSenseRuntime(request, telemetry.callbacks);
    if (visionSensePayload) {
      telemetry.markVerificationStart();
      const verified = await applyRuntimeVerificationPolicy(visionSensePayload, request);
      telemetry.markVerificationEnd();
      return telemetry.emitFinal(verified) ?? verified;
    }
    const skills = await loadSkillRegistry(request);
    const skill = agentServerGenerationSkill(request.skillDomain);
    emitWorkspaceRuntimeEvent(telemetry.callbacks, {
      type: 'workspace-skill-selected',
      source: 'workspace-runtime',
      message: `Selected skill ${skill.id} for ${request.skillDomain}`,
      detail: skill.manifest.entrypoint.type,
    });
    const payload = await runAgentServerGeneratedTask(request, skill, skills, telemetry.callbacks)
      ?? repairNeededPayload(request, skill, 'AgentServer task generation did not produce a runnable task.');
    telemetry.markVerificationStart();
    const verified = await applyRuntimeVerificationPolicy(payload, request);
    telemetry.markVerificationEnd();
    return telemetry.emitFinal(verified) ?? verified;
  } catch (error) {
    telemetry.markFallback(errorMessage(error));
    telemetry.emitFinal();
    throw error;
  }
}

async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: { allowSupplement?: boolean } = {},
): Promise<ToolPayload | undefined> {
  return runAgentServerGeneratedTaskFromModule(request, skill, skills, callbacks, {
    agentServerFailurePayloadRefs,
    agentServerGenerationFailureReason,
    attemptPlanRefs,
    coerceWorkspaceTaskPayload,
    failedTaskPayload,
    firstPayloadFailureReason,
    mergeReusableContextArtifactsForDirectPayload,
    payloadHasFailureStatus,
    readConfiguredAgentServerBaseUrl,
    repairNeededPayload,
    requestAgentServerGeneration,
    schemaErrors,
    tryAgentServerRepairAndRerun,
    validateAndNormalizePayload,
    ensureDirectAnswerReportArtifact,
  }, options);
}

function isBlockingAgentServerConfigurationFailure(reason: string) {
  return /User-side model configuration|llmEndpoint|openteam\.json defaults|Model Provider|Model Base URL|Model Name/i.test(reason);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  return values.map(finiteNumber).find((value): value is number => value !== undefined);
}

function providerForBackend(backend: string) {
  if (backend === 'openteam_agent') return 'self-hosted';
  if (backend === 'hermes-agent') return 'hermes';
  return backend || undefined;
}

function attemptPlanRefs(request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) {
  return {
    scenarioPackageRef: request.scenarioPackageRef,
    skillPlanRef: request.skillPlanRef,
    uiPlanRef: request.uiPlanRef,
    runtimeProfileId: runtimeProfileIdForRequest(request, skill),
    routeDecision: {
      selectedSkill: skill?.id,
      selectedRuntime: selectedRuntimeForSkill(skill),
      fallbackReason,
      selectedAt: new Date().toISOString(),
    },
  };
}

function runtimeProfileIdForRequest(request: GatewayRequest, skill?: SkillAvailability) {
  if (skill?.manifest.entrypoint.type === 'agentserver-generation') return `agentserver-${agentServerBackend(request, request.llmEndpoint)}`;
  if (skill?.manifest.entrypoint.type === 'markdown-skill') return `agentserver-${agentServerBackend(request, request.llmEndpoint)}`;
  if (skill?.manifest.entrypoint.type === 'workspace-task') return 'workspace-python';
  return request.scenarioPackageRef?.source === 'built-in' ? 'package-skill' : undefined;
}

function selectedRuntimeForSkill(skill?: SkillAvailability) {
  if (!skill) return undefined;
  if (skill.manifest.entrypoint.type === 'agentserver-generation') return 'agentserver-generation';
  if (skill.manifest.entrypoint.type === 'markdown-skill') return 'agentserver-markdown-skill';
  if (skill.manifest.entrypoint.type === 'workspace-task') return 'workspace-python';
  return skill.manifest.entrypoint.type;
}

function executionPromptForWorkspaceSkill(request: GatewayRequest) {
  const currentPrompt = request.uiState && typeof request.uiState.currentPrompt === 'string'
    ? request.uiState.currentPrompt.trim()
    : '';
  return currentPrompt || request.prompt;
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

function agentBackendAdapter(backend: string): AgentBackendAdapter {
  const capabilities = agentBackendCapabilities(backend);
  return {
    backend,
    capabilities,
    readContextWindowState: async (sessionRef) => readBackendContextWindowState(sessionRef, backend, capabilities),
    compactContext: async (sessionRef, reason) => compactBackendContext(sessionRef, backend, capabilities, reason),
  };
}

function agentBackendCapabilities(backend: string): AgentBackendCapabilities {
  if (backend === 'codex') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: true,
      compactionDuringTurn: true,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'hermes-agent') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: true,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'gemini') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'openteam_agent') {
    return {
      contextWindowTelemetry: true,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  if (backend === 'claude-code') {
    return {
      contextWindowTelemetry: false,
      nativeCompaction: false,
      compactionDuringTurn: false,
      rateLimitTelemetry: true,
      sessionRotationSafe: true,
    };
  }
  return {
    contextWindowTelemetry: false,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: false,
    sessionRotationSafe: true,
  };
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
}

function payloadHasFailureStatus(payload: ToolPayload) {
  if (String(payload.claimType || '').toLowerCase().includes('error')) return true;
  return (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /failed|error/i.test(String(unit.status || '')));
}

function normalizeExecutionUnitStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'completed' || status === 'complete' || status === 'success' || status === 'succeeded') return 'done';
  if (status === 'failure' || status === 'errored' || status === 'error') return 'failed-with-reason';
  if (status === 'needs-repair' || status === 'repair_needed') return 'repair-needed';
  if (status === 'self_healed' || status === 'self-heal') return 'self-healed';
  if (['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(status)) return status;
  return 'done';
}

function firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  const unit = units.find((entry) => isRecord(entry) && /failed|error/i.test(String(entry.status || '')));
  const unitReason = isRecord(unit) ? stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message) : undefined;
  return unitReason
    ?? (typeof run?.exitCode === 'number' && run.exitCode !== 0 ? stringField(run?.stderr) ?? `Task exited ${run.exitCode}.` : undefined);
}

async function tryAgentServerRepairAndRerun(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskPrefix: string;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}): Promise<ToolPayload | undefined> {
  const baseUrl = params.request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(params.run.workspace);
  if (!baseUrl || process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR === '0') return undefined;
  throwIfRuntimeAborted(params.callbacks);
  const workspace = params.run.workspace;
  const taskPath = join(workspace, params.run.spec.taskRel);
  const beforeCode = await readTextIfExists(taskPath);
  const priorAttempts = await readTaskAttempts(workspace, params.taskId);
  const maxAttempts = agentServerRepairMaxAttempts();
  const attempt = Math.max(2, priorAttempts.length + 1);
  const parentAttempt = attempt - 1;
  if (attempt > maxAttempts) return undefined;
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: 'repair-attempt-start',
    source: 'workspace-runtime',
    status: 'running',
    message: `AgentServer repair attempt ${attempt}/${maxAttempts}`,
    detail: params.failureReason,
  });
  const repair = await requestAgentServerRepair({
    baseUrl,
    request: params.request,
    skill: params.skill,
    run: params.run,
    schemaErrors: params.schemaErrors,
    failureReason: params.failureReason,
    priorAttempts,
  });
  throwIfRuntimeAborted(params.callbacks);
  const afterCode = await readTextIfExists(taskPath);
  const diffSummary = repair.ok
    ? summarizeTextChange(beforeCode, afterCode, repair.diffSummary)
    : repair.error;
  const diffRel = `.sciforge/task-diffs/${params.taskId}-attempt-${attempt}.diff.txt`;
  await mkdir(dirname(join(workspace, diffRel)), { recursive: true });
  await writeFile(join(workspace, diffRel), diffSummary || 'AgentServer repair produced no diff summary.');

  if (!repair.ok) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: repair.error,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      failureReason: repair.error,
      createdAt: new Date().toISOString(),
    });
    return undefined;
  }

  const outputRel = `.sciforge/task-results/${params.taskId}-attempt-${attempt}.json`;
  const stdoutRel = `.sciforge/logs/${params.taskId}-attempt-${attempt}.stdout.log`;
  const stderrRel = `.sciforge/logs/${params.taskId}-attempt-${attempt}.stderr.log`;
  const rerun = await runWorkspaceTask(workspace, {
    id: `${params.taskId}-attempt-${attempt}`,
    language: params.run.spec.language,
    entrypoint: params.run.spec.entrypoint,
    entrypointArgs: params.run.spec.entrypointArgs,
    taskRel: params.run.spec.taskRel,
    input: {
      prompt: params.request.prompt,
      attempt,
      parentAttempt,
      skillId: params.skill.id,
      selfHealReason: params.failureReason,
      agentServerRunId: repair.runId,
      artifacts: params.request.artifacts,
      uiStateSummary: params.request.uiState,
      taskProjectHandoff: isRecord(params.request.uiState?.taskProjectHandoff) ? params.request.uiState.taskProjectHandoff : undefined,
      userGuidanceQueue: activeGuidanceQueueForTaskInput(params.request),
      recentExecutionRefs: toRecordList(params.request.uiState?.recentExecutionRefs),
      priorAttempts,
    },
    outputRel,
    stdoutRel,
    stderrRel,
  });
  throwIfRuntimeAborted(params.callbacks);
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: 'repair-attempt-result',
    source: 'workspace-runtime',
    status: rerun.exitCode === 0 ? 'completed' : 'failed',
    message: `AgentServer repair attempt ${attempt}/${maxAttempts} rerun exited ${rerun.exitCode}`,
    detail: [rerun.stdout?.slice(0, 1000), rerun.stderr?.slice(0, 1000)].filter(Boolean).join('\n'),
  });

  if (rerun.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: rerun.stderr || 'AgentServer repair rerun failed before writing output.',
      createdAt: new Date().toISOString(),
    });
    if (attempt < maxAttempts) {
      return tryAgentServerRepairAndRerun({
        ...params,
        run: rerun,
        schemaErrors: [],
        failureReason: rerun.stderr || 'AgentServer repair rerun failed before writing output.',
        callbacks: params.callbacks,
      });
    }
    return undefined;
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const payload = coerceWorkspaceTaskPayload(rawPayload) ?? rawPayload;
    const errors = schemaErrors(payload);
    const normalized = await validateAndNormalizePayload(payload, params.request, params.skill, {
      taskRel: params.run.spec.taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: rerun.runtimeFingerprint,
    });
    const evidenceFinding = evaluateToolPayloadEvidence(payload, params.request);
    const guidanceFinding = evaluateGuidanceAdoption(payload, params.request);
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(payload);
    const payloadFailureReason = firstPayloadFailureReason(payload, rerun);
    const payloadFailureStatus = payloadHasFailureStatus(payload);
    const evidenceFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
    const failureReason = payloadFailureReason ?? evidenceFailureReason;
    const shouldRepairExecutionFailure = errors.length === 0 && Boolean(failureReason)
      && (rerun.exitCode !== 0 || Boolean(evidenceFailureReason));
    const attemptStatus = errors.length
      ? 'repair-needed'
      : shouldRepairExecutionFailure
        ? guidanceFinding?.severity ?? evidenceFinding?.severity ?? 'repair-needed'
        : payloadFailureStatus || rerun.exitCode !== 0
          ? 'failed-with-reason'
          : 'done';
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: attemptStatus,
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      schemaErrors: errors,
      workEvidenceSummary,
      failureReason: errors.length ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}` : failureReason,
      createdAt: new Date().toISOString(),
    });
    if (errors.length || shouldRepairExecutionFailure || payloadFailureStatus || rerun.exitCode !== 0) {
      if (attempt < maxAttempts) {
        const nextFailureReason = errors.length
          ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}`
          : evidenceFailureReason
            ? evidenceFailureReason
          : failureReason ?? `AgentServer repair rerun exited ${rerun.exitCode}.`;
        return tryAgentServerRepairAndRerun({
          ...params,
          run: rerun,
          schemaErrors: errors,
          failureReason: nextFailureReason,
          callbacks: params.callbacks,
        });
      }
      return undefined;
    }
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request: params.request,
      skill: params.skill,
      taskId: params.taskId,
      taskRel: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      payload: normalized,
      selfHealed: true,
      patchSummary: diffSummary,
    });
    return {
      ...normalized,
      reasoningTrace: [
        normalized.reasoningTrace,
        `AgentServer repair run: ${repair.runId || 'unknown'} (attempt ${attempt}/${maxAttempts})`,
        `Self-heal reason: ${params.failureReason}`,
        `Diff ref: ${diffRel}`,
        proposal ? `Skill promotion proposal: .sciforge/skill-proposals/${proposal.id}` : '',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(params.request, params.skill, params.failureReason),
        status: 'self-healed',
        attempt,
        parentAttempt,
        selfHealReason: params.failureReason,
        patchSummary: diffSummary,
        diffRef: diffRel,
        agentServerRunId: repair.runId,
      } : unit),
      logs: [
        ...(normalized.logs ?? []),
        { kind: 'agentserver-repair-diff', ref: diffRel },
      ],
    };
  } catch (error) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`,
      createdAt: new Date().toISOString(),
    });
    if (attempt < maxAttempts) {
      return tryAgentServerRepairAndRerun({
        ...params,
        run: rerun,
        schemaErrors: [],
        failureReason: `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`,
        callbacks: params.callbacks,
      });
    }
    return undefined;
  }
}

function agentServerRepairMaxAttempts() {
  const value = Number(process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS || 12);
  return Number.isFinite(value) ? Math.max(2, Math.min(50, Math.floor(value))) : 12;
}

function activeGuidanceQueueForTaskInput(request: GatewayRequest) {
  const handoff = isRecord(request.uiState?.taskProjectHandoff) ? request.uiState.taskProjectHandoff : undefined;
  const queue = Array.isArray(handoff?.userGuidanceQueue)
    ? handoff.userGuidanceQueue
    : Array.isArray(request.uiState?.userGuidanceQueue)
      ? request.uiState.userGuidanceQueue
      : Array.isArray(request.uiState?.guidanceQueue)
        ? request.uiState.guidanceQueue
        : [];
  return queue.filter((entry): entry is Record<string, unknown> => isRecord(entry)
    && typeof entry.id === 'string'
    && (entry.status === 'queued' || entry.status === 'deferred'));
}

async function requestAgentServerGeneration(params: {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  strictTaskFilesReason?: string;
}): Promise<AgentServerGenerationResult> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS || 900000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let runPayload: unknown;
  let contextRecovery: AgentServerGenerationFailureDiagnostics | undefined;
  try {
    const request = params.request;
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(request, params.workspace);
    const backend = agentServerBackend(request, llmRuntime.llmEndpoint);
    const needsContinuity = requestNeedsAgentServerContinuity(request);
    const generationPurpose = needsContinuity ? 'workspace-task-generation' : 'workspace-task-generation-inline';
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const adapter = agentBackendAdapter(backend);
    const agentId = agentServerAgentId(request, 'task-generation');
    for (let dispatchAttempt = 1; dispatchAttempt <= 2; dispatchAttempt += 1) {
    const preflight = await preflightAgentServerContextWindow({
      adapter,
      baseUrl: params.baseUrl,
      workspace: params.workspace,
      agentId,
      callbacks: params.callbacks,
    });
    const workspaceTree = await workspaceTreeSummary(params.workspace);
    const attachPriorAttempts = needsContinuity;
    const priorAttempts = currentTurnReferences(request).length || !attachPriorAttempts
      ? []
      : summarizeTaskAttemptsForAgentServer(await readRecentTaskAttempts(params.workspace, request.skillDomain, 8, {
        scenarioPackageId: request.scenarioPackageRef?.id,
        skillPlanRef: request.skillPlanRef,
        prompt: request.prompt,
      }));
    const agentServerSnapshot = preflight.state?.snapshot ?? await fetchAgentServerContextSnapshot(params.baseUrl, agentId);
    const contextMode = contextEnvelopeMode(request, {
      agentServerCoreAvailable: Boolean(agentServerSnapshot),
      forceSlimHandoff: preflight.forceSlimHandoff || Boolean(contextRecovery),
    });
    const contextEnvelope: Record<string, unknown> = buildContextEnvelope(request, {
      workspace: params.workspace,
      workspaceTreeSummary: workspaceTree,
      priorAttempts,
      selectedSkill: params.skill,
      mode: contextMode,
      agentId,
      agentServerCoreSnapshotAvailable: Boolean(agentServerSnapshot),
    });
    if (agentServerSnapshot) {
      contextEnvelope.agentServerCoreSnapshot = agentServerSnapshot;
    }
    if (contextRecovery?.retryAudit) {
      contextEnvelope.backendRetryAudit = contextRecovery.retryAudit;
      contextEnvelope.retryReason = 'Previous AgentServer generation attempt hit provider/rate-limit or retry-budget pressure; this is the only compact retry.';
    }
    const compactContext = buildAgentServerCompactContext(request, {
      contextEnvelope,
      workspaceTree,
      priorAttempts,
      selectedSkill: params.skill,
      skills: params.skills,
      mode: contextMode,
    });
    const generationRequest = {
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      contextEnvelope,
      workspaceTreeSummary: compactContext.workspaceTreeSummary,
      availableSkills: compactContext.availableSkills,
      availableTools: summarizeToolsForAgentServer(request),
      availableRuntimeCapabilities: summarizeRuntimeCapabilitiesForAgentServer(request, compactContext.availableSkills),
      artifactSchema: expectedArtifactSchema(request),
      uiManifestContract: { expectedKeys: ['componentId', 'artifactRef', 'encoding', 'layout', 'compare'] },
      uiStateSummary: compactContext.uiStateSummary,
      artifacts: compactContext.artifacts,
      recentExecutionRefs: compactContext.recentExecutionRefs,
      expectedArtifactTypes: expectedArtifactTypesForRequest(request),
      selectedComponentIds: request.selectedComponentIds ?? toStringList(request.uiState?.selectedComponentIds),
      priorAttempts: compactContext.priorAttempts,
      strictTaskFilesReason: params.strictTaskFilesReason,
      retryAudit: contextRecovery?.retryAudit,
      freshCurrentTurn: !needsContinuity,
    };
    const generationPrompt = buildAgentServerGenerationPrompt(generationRequest);
    const contextEnvelopeBytes = Buffer.byteLength(JSON.stringify(contextEnvelope), 'utf8');
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextWindowState',
      source: 'workspace-runtime',
      message: 'Estimated context window before AgentServer dispatch',
      contextWindowState: estimateWorkspaceContextWindowState({
        backend,
        modelName: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        maxContextWindowTokens: request.maxContextWindowTokens,
        usedTokens: Math.ceil((contextEnvelopeBytes + generationPrompt.length) / 4),
        source: 'estimate',
      }),
    });
    runPayload = {
      agent: {
        id: agentId,
        name: `SciForge ${request.skillDomain} Task Generation`,
        backend,
        workspace: params.workspace,
        workingDirectory: params.workspace,
        reconcileExisting: needsContinuity,
        systemPrompt: [
          AGENT_BACKEND_ANSWER_PRINCIPLE,
          'You generate SciForge workspace-local task code.',
          !needsContinuity
            ? 'Fresh-generation hard rule: do not call shell/filesystem/browser tools to inspect the workspace, .sciforge, old task attempts, logs, artifacts, installed packages, or prior generated code before returning. Your first substantive assistant output must be the final compact JSON for a direct ToolPayload or a runnable AgentServerGenerationResponse.'
            : 'Continuity-generation mode: inspect only the specific prior refs needed for the user-requested continuation, repair, or rerun.',
          'Write task files that accept inputPath and outputPath argv values and write a SciForge ToolPayload JSON object.',
          'For current-reference document requests, use uiStateSummary.currentReferenceDigests/contextEnvelope.sessionFacts.currentReferenceDigests first; do not spend generation-stage tool calls dumping long files into model context.',
          'For fresh current-turn requests, do not browse old .sciforge task attempts, logs, artifacts, or generated tasks for diagnostics; generate the requested runnable task or direct ToolPayload from the current turn.',
          'Do not create demo/default success artifacts; if the real task cannot be generated, explain the missing condition.',
        ].join(' '),
      },
      input: {
        text: generationPrompt,
        metadata: {
          project: 'SciForge',
          purpose: generationPurpose,
          skillDomain: request.skillDomain,
          skillId: params.skill.id,
          expectedArtifactTypes: generationRequest.expectedArtifactTypes,
          selectedComponentIds: generationRequest.selectedComponentIds,
          priorAttemptCount: generationRequest.priorAttempts.length,
          contextEnvelopeVersion: 'sciforge.context-envelope.v1',
          contextMode: compactContext.mode,
          retryAudit: contextRecovery?.retryAudit,
          contextEnvelopeBytes,
          promptChars: generationPrompt.length,
          maxContextWindowTokens: request.maxContextWindowTokens,
          contextWindowLimit: request.maxContextWindowTokens,
          modelContextWindow: request.maxContextWindowTokens,
          workspaceTreeEntryCount: workspaceTree.length,
          contextWindow: preflight.state ? contextWindowMetadata(preflight.state) : undefined,
          contextCompaction: preflight.compaction ? contextCompactionMetadata(preflight.compaction) : undefined,
          backendCapabilities: adapter.capabilities,
        },
      },
      contextPolicy: agentServerContextPolicy(request),
      runtime: {
        backend,
        cwd: params.workspace,
        ...llmRuntime,
        metadata: {
          autoApprove: true,
          sandbox: 'danger-full-access',
          ...agentHandoffSourceMetadata(requestHandoffSource(request)),
          source: 'sciforge-workspace-runtime-gateway',
          purpose: 'workspace-task-generation',
          maxContextWindowTokens: request.maxContextWindowTokens,
          contextWindowLimit: request.maxContextWindowTokens,
          modelContextWindow: request.maxContextWindowTokens,
          requiresNativeWorkspaceCapabilities: needsContinuity,
          nativeToolFirst: needsContinuity,
          llmEndpointSource: llmRuntime.llmEndpoint ? llmEndpointSource : undefined,
          retryAudit: contextRecovery?.retryAudit,
        },
      },
      metadata: {
        project: 'SciForge',
        ...agentHandoffSourceMetadata(requestHandoffSource(request)),
        source: 'workspace-runtime-gateway',
        task: 'generation',
        purpose: generationPurpose,
        workspace: params.workspace,
        workingDirectory: params.workspace,
        maxContextWindowTokens: request.maxContextWindowTokens,
        contextWindowLimit: request.maxContextWindowTokens,
        modelContextWindow: request.maxContextWindowTokens,
        orchestrator: {
          mode: 'multi_stage',
          planKind: 'implement-only',
          failureStrategy: 'retry_stage',
          maxRetries: 1,
        },
        retryAudit: contextRecovery?.retryAudit,
      },
    };
    const normalizedHandoff = await normalizeBackendHandoff(runPayload, {
      workspacePath: params.workspace,
      purpose: contextRecovery ? 'agentserver-generation-rate-limit-retry' : 'agentserver-generation',
      budget: contextRecovery ? {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 6_000,
        maxInlineJsonBytes: 18_000,
        maxArrayItems: 10,
        maxObjectKeys: 48,
        maxDepth: 5,
        headChars: 1_200,
        tailChars: 1_200,
        maxPriorAttempts: 1,
      } : {
        maxInlineStringChars: 24_000,
        headChars: 4_000,
        tailChars: 4_000,
      },
    });
    runPayload = normalizedHandoff.payload;
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextWindowState',
      source: 'workspace-runtime',
      message: 'Estimated context window after handoff slimming',
      contextWindowState: handoffContextWindowState({
        backend,
        modelName: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        maxContextWindowTokens: request.maxContextWindowTokens,
        rawRef: normalizedHandoff.rawRef,
        rawSha1: normalizedHandoff.rawSha1,
        rawBytes: normalizedHandoff.rawBytes,
        normalizedBytes: normalizedHandoff.normalizedBytes,
        maxPayloadBytes: normalizedHandoff.budget.maxPayloadBytes,
        rawTokens: normalizedHandoff.contextEstimate.rawTokens,
        normalizedTokens: normalizedHandoff.contextEstimate.normalizedTokens,
        savedTokens: normalizedHandoff.contextEstimate.savedTokens,
        decisions: handoffBudgetDecisionRecords(normalizedHandoff.decisions),
        auditRefs: normalizedHandoff.auditRefs,
      }),
      raw: {
        handoffBudget: normalizedHandoff.budget,
        handoffDecisions: normalizedHandoff.decisions,
        auditRefs: normalizedHandoff.auditRefs,
      },
    });
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-dispatch',
      source: 'workspace-runtime',
      message: `Dispatching to AgentServer ${backend}`,
      detail: `${params.baseUrl} · handoff ${normalizedHandoff.normalizedBytes}/${normalizedHandoff.budget.maxPayloadBytes} bytes · raw ${normalizedHandoff.rawRef}`,
    });
    const response = await fetch(`${params.baseUrl}/api/agent-server/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(runPayload),
    });
    const { json, run, error, streamText, workEvidence } = await readAgentServerRunStream(response, (event) => {
      emitWorkspaceRuntimeEvent(params.callbacks, withRequestContextWindowLimit(
        normalizeAgentServerWorkspaceEvent(event),
        request,
      ));
    }, {
      maxTotalUsage: currentReferenceDigestGuardLimit(request),
      maxSilentMs: currentReferenceDigestSilentGuardMs(request),
      onGuardTrip: (message) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, {
          type: 'agentserver-convergence-guard',
          source: 'workspace-runtime',
          status: 'failed-with-reason',
          message,
          detail: 'Current-reference digests are already available; SciForge will recover from bounded refs instead of letting the backend replay large files indefinitely.',
        });
      },
      onSilentTimeout: (message) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, {
          type: 'agentserver-silent-stream-guard',
          source: 'workspace-runtime',
          status: 'failed-with-reason',
          message,
          detail: 'Current-reference digests are already available; SciForge will recover from bounded refs instead of waiting on a silent backend stream indefinitely.',
        });
      },
    });
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, response.status, json);
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      const failure = await recoverOrReturnAgentServerGenerationFailure({
        error: detail || error || `AgentServer generation HTTP ${response.status}`,
        sanitizedError: sanitizeAgentServerError(detail || error || `AgentServer generation HTTP ${response.status}`),
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        httpStatus: response.status,
        headers: response.headers,
        priorHandoff: normalizedHandoff,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    if (error) {
      const failure = await recoverOrReturnAgentServerGenerationFailure({
        error,
        sanitizedError: sanitizeAgentServerError(error),
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        priorHandoff: normalizedHandoff,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    const runFailure = agentServerRunFailure(run);
    if (runFailure) {
      const failure = await recoverOrReturnAgentServerGenerationFailure({
        error: runFailure,
        sanitizedError: runFailure,
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        priorHandoff: normalizedHandoff,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    const directPayload = parseToolPayloadResponse(run);
    if (directPayload) {
      const payload = mergeBackendStreamWorkEvidence(directPayload, workEvidence);
      return await finalizeAgentServerGenerationSuccess({
        result: {
        ok: true,
        runId: typeof run.id === 'string' ? run.id : undefined,
        directPayload: payload,
        },
        contextRecovery,
        workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
    }
    const directText = extractAgentServerOutputText(run) || streamText || '';
    const parsedRaw = parseGenerationResponse(run.output) ?? parseGenerationResponse(run) ?? parseGenerationResponse(streamText);
    const parsed = parsedRaw && directText ? hydrateGeneratedTaskResponseFromText(parsedRaw, directText) : parsedRaw;
    if (!parsed) {
      if (directText) {
        const parsedTextGeneration = parseGenerationResponseFromStandaloneText(directText);
        if (parsedTextGeneration) {
          return await finalizeAgentServerGenerationSuccess({
            result: {
            ok: true,
            runId: typeof run.id === 'string' ? run.id : undefined,
            response: parsedTextGeneration,
            },
            contextRecovery,
            workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
        }
        return await finalizeAgentServerGenerationSuccess({
          result: {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload: toolPayloadFromPlainAgentOutput(directText, request),
          },
          contextRecovery,
          workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
      }
      return { ok: false, error: 'AgentServer generation response did not include taskFiles and entrypoint or a SciForge ToolPayload.' };
    }
    return await finalizeAgentServerGenerationSuccess({
      result: {
      ok: true,
      runId: typeof run.id === 'string' ? run.id : undefined,
      response: parsed,
      },
      contextRecovery,
      workspace: params.workspace,
      request,
      skill: params.skill,
      callbacks: params.callbacks,
    });
    }
    return {
      ok: false,
      error: contextRecovery?.originalErrorSummary ?? 'AgentServer generation failed after context recovery.',
      diagnostics: contextRecovery,
    };
  } catch (error) {
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, 0, { error: errorMessage(error) });
    return { ok: false, error: agentServerRequestFailureMessage('generation', error, timeoutMs) };
  } finally {
    clearTimeout(timeout);
  }
}

async function appendContextRecoveryAuditAttempt(params: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  diagnostics: AgentServerGenerationFailureDiagnostics;
  status: 'repair-needed' | 'self-healed';
  failureReason: string;
}) {
  const id = `agentserver-context-recovery-${params.request.skillDomain}-${sha1(`${params.request.prompt}:${params.status}:${Date.now()}`).slice(0, 12)}`;
  await appendTaskAttempt(params.workspace, {
    id,
    prompt: params.request.prompt,
    skillDomain: params.request.skillDomain,
    ...attemptPlanRefs(params.request, params.skill, params.failureReason),
    skillId: params.skill.id,
    attempt: 1,
    status: params.status,
    failureReason: params.failureReason,
    contextRecovery: {
      kind: 'contextWindowExceeded',
      backend: params.diagnostics.backend,
      provider: params.diagnostics.provider,
      agentId: params.diagnostics.agentId,
      sessionRef: params.diagnostics.sessionRef,
      originalErrorSummary: params.diagnostics.originalErrorSummary,
      compaction: params.diagnostics.compaction,
      retryAttempted: params.diagnostics.retryAttempted,
      retrySucceeded: params.diagnostics.retrySucceeded,
    },
    createdAt: new Date().toISOString(),
  });
}

function parseGenerationResponseFromStandaloneText(text: string) {
  const parsed = extractStandaloneJson(text);
  const response = parseGenerationResponse(parsed);
  if (!response) return undefined;
  return hydrateGeneratedTaskResponseFromText(response, text);
}

function hydrateGeneratedTaskResponseFromText(response: AgentServerGenerationResponse, text: string): AgentServerGenerationResponse {
  return {
    ...response,
    taskFiles: response.taskFiles.map((file) => file.content ? file : {
      ...file,
      content: fencedTaskFileContentForPath(text, file.path) ?? file.content,
    }),
  };
}

function fencedTaskFileContentForPath(text: string, path: string) {
  const normalizedPath = safeWorkspaceRel(path);
  for (const match of text.matchAll(/```([a-zA-Z0-9_+.-]*)\s*\n([\s\S]*?)```/g)) {
    const language = match[1]?.trim().toLowerCase() || '';
    if (language === 'json') continue;
    const body = match[2] ?? '';
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0);
    const firstMeaningful = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex].trim() : '';
    const declaredPath = firstMeaningful.match(/^#\s+(.+)$/)?.[1]?.trim();
    if (declaredPath && safeWorkspaceRel(declaredPath) !== normalizedPath) continue;
    if (!declaredPath && !languageLooksCompatibleWithPath(language, normalizedPath)) continue;
    const content = declaredPath ? lines.slice(firstMeaningfulIndex + 1).join('\n').trimStart() : body.trimStart();
    if (content.trim()) return content;
  }
  return undefined;
}

function languageLooksCompatibleWithPath(language: string, path: string) {
  if (!language) return false;
  if (path.endsWith('.py')) return /python|py/.test(language);
  if (path.endsWith('.js') || path.endsWith('.mjs')) return /javascript|js|node/.test(language);
  if (path.endsWith('.ts')) return /typescript|ts/.test(language);
  if (path.endsWith('.r') || path.endsWith('.R')) return /^r$|rscript/.test(language);
  if (path.endsWith('.sh')) return /bash|shell|sh|zsh/.test(language);
  return false;
}

async function readAgentServerRunStream(
  response: Response,
  onEvent: (event: unknown) => void,
  options: {
    maxTotalUsage?: number;
    onGuardTrip?: (message: string) => void;
    maxSilentMs?: number;
    onSilentTimeout?: (message: string) => void;
  } = {},
): Promise<{ json: unknown; run: Record<string, unknown>; error?: string; streamText?: string; workEvidence: WorkEvidence[] }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    return {
      json,
      run: isRecord(data.run) ? data.run : {},
      error: isRecord(json) ? String(json.error || '') : String(text).slice(0, 500),
      workEvidence: collectWorkEvidenceFromBackendEvent(json),
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const envelopes: unknown[] = [];
  let buffer = '';
  let finalResult: unknown;
  let streamError = '';
  let lastEnvelopeAt = Date.now();
  const streamTextParts: string[] = [];
  const workEvidence: WorkEvidence[] = [];
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    lastEnvelopeAt = Date.now();
    const envelope = JSON.parse(line) as unknown;
    envelopes.push(envelope);
    if (!isRecord(envelope)) return;
    if ('event' in envelope) {
      const event = envelope.event;
      workEvidence.push(...collectWorkEvidenceFromBackendEvent(event));
      if (isRecord(event) && typeof event.text === 'string') streamTextParts.push(event.text);
      onEvent(event);
      const totalUsage = agentServerEventTotalUsage(event);
      if (options.maxTotalUsage && totalUsage && totalUsage > options.maxTotalUsage) {
        const message = `AgentServer generation stopped by convergence guard after ${totalUsage} total tokens; bounded current-reference digests should be used instead of repeated full-file reads.`;
        options.onGuardTrip?.(message);
        throw new Error(message);
      }
    }
    if ('result' in envelope) finalResult = envelope.result;
    if ('error' in envelope) streamError = String(envelope.error || '');
  }
  for (;;) {
    const readResult = options.maxSilentMs
      ? await Promise.race([
        reader.read(),
        new Promise<{ silentTimeout: true }>((resolve) => {
          setTimeout(() => resolve({ silentTimeout: true }), options.maxSilentMs);
        }),
      ])
      : await reader.read();
    if ('silentTimeout' in readResult) {
      const silentMs = Date.now() - lastEnvelopeAt;
      const message = `AgentServer generation stopped by silent stream guard after ${silentMs}ms without stream events; bounded current-reference digests should be used instead of waiting indefinitely.`;
      options.onSilentTimeout?.(message);
      throw new Error(message);
    }
    const { value, done } = readResult;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  const data = isRecord(finalResult) && isRecord(finalResult.data) ? finalResult.data : isRecord(finalResult) ? finalResult : {};
  return {
    json: finalResult ?? { envelopes, error: streamError },
    run: isRecord(data.run) ? data.run : {},
    error: streamError || undefined,
    streamText: streamTextParts.join(''),
    workEvidence: dedupeWorkEvidence(workEvidence),
  };
}

function mergeBackendStreamWorkEvidence(payload: ToolPayload, workEvidence: WorkEvidence[]) {
  if (!workEvidence.length) return payload;
  const existing = Array.isArray(payload.workEvidence) ? payload.workEvidence : [];
  return {
    ...payload,
    workEvidence: dedupeWorkEvidence([...existing, ...workEvidence]),
  };
}

function dedupeWorkEvidence(items: WorkEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify({
      kind: item.kind,
      status: item.status,
      provider: item.provider,
      input: item.input,
      resultCount: item.resultCount,
      failureReason: item.failureReason,
      rawRef: item.rawRef,
      evidenceRefs: item.evidenceRefs,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentReferenceDigestGuardLimit(request: GatewayRequest) {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  if (!digests.length) return undefined;
  const configured = typeof request.maxContextWindowTokens === 'number' && Number.isFinite(request.maxContextWindowTokens)
    ? request.maxContextWindowTokens
    : 200_000;
  return Math.max(40_000, Math.min(80_000, Math.floor(configured * 0.4)));
}

function currentReferenceDigestSilentGuardMs(request: GatewayRequest) {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  if (!digests.length) return undefined;
  return 45_000;
}

function agentServerEventTotalUsage(event: unknown) {
  if (!isRecord(event)) return undefined;
  const usage = isRecord(event.usage) ? event.usage : isRecord(event.output) && isRecord(event.output.usage) ? event.output.usage : undefined;
  const candidates = [
    event.total,
    event.totalTokens,
    event.tokens,
    usage?.total,
    usage?.totalTokens,
    usage?.input && usage?.output ? Number(usage.input) + Number(usage.output) : undefined,
    usage?.inputTokens && usage?.outputTokens ? Number(usage.inputTokens) + Number(usage.outputTokens) : undefined,
    usage?.promptTokens && usage?.completionTokens ? Number(usage.promptTokens) + Number(usage.completionTokens) : undefined,
  ];
  return candidates
    .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN)
    .find((value) => Number.isFinite(value) && value > 0);
}

async function recoverOrReturnAgentServerGenerationFailure(params: {
  error: string;
  sanitizedError: string;
  dispatchAttempt: number;
  contextRecovery?: AgentServerGenerationFailureDiagnostics;
  adapter: AgentBackendAdapter;
  baseUrl: string;
  workspace: string;
  agentId: string;
  provider?: string;
  model?: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  callbacks?: WorkspaceRuntimeCallbacks;
  httpStatus?: number;
  headers?: Headers;
  priorHandoff: {
    rawRef: string;
    rawBytes: number;
    normalizedBytes: number;
  };
}): Promise<
  | { retry: true; diagnostics: AgentServerGenerationFailureDiagnostics }
  | { retry: false; result: AgentServerGenerationResult }
> {
  const originalErrorSummary = sanitizeAgentServerError(params.error || params.sanitizedError);
  const contextSessionRef = agentServerSessionRef(params.baseUrl, params.agentId);
  const diagnosticProvider = params.provider ?? providerForBackend(params.adapter.backend);
  if (isContextWindowExceededError(`${params.error}\n${params.sanitizedError}`)) {
    if (params.dispatchAttempt >= 2 || params.contextRecovery?.retryAttempted) {
      return {
        retry: false,
        result: {
          ok: false,
          error: params.sanitizedError,
          diagnostics: {
            ...(params.contextRecovery ?? {}),
            kind: 'contextWindowExceeded',
            backend: params.contextRecovery?.backend ?? params.adapter.backend,
            provider: params.contextRecovery?.provider ?? diagnosticProvider,
            model: params.contextRecovery?.model ?? params.model,
            agentId: params.contextRecovery?.agentId ?? params.agentId,
            sessionRef: params.contextRecovery?.sessionRef ?? contextSessionRef,
            originalErrorSummary: params.contextRecovery?.originalErrorSummary ?? originalErrorSummary,
            priorHandoff: params.contextRecovery?.priorHandoff ?? params.priorHandoff,
            retryAttempted: true,
            retrySucceeded: false,
          },
        },
      };
    }
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-context-window-recovery',
      source: 'workspace-runtime',
      status: 'running',
      message: 'AgentServer reported context window exceeded; compacting context before one retry.',
      detail: originalErrorSummary,
      raw: {
        backend: params.adapter.backend,
        provider: diagnosticProvider,
        model: params.model,
        agentId: params.agentId,
        sessionRef: contextSessionRef,
        priorHandoff: params.priorHandoff,
      },
    });
    const compaction = await params.adapter.compactContext?.(
      { agentId: params.agentId, workspace: params.workspace, baseUrl: params.baseUrl },
      `contextWindowExceeded:${originalErrorSummary}`,
    ) ?? {
      ok: false,
      backend: params.adapter.backend,
      agentId: params.agentId,
      strategy: 'none' as const,
      reason: `contextWindowExceeded:${originalErrorSummary}`,
      message: 'Backend adapter did not provide compactContext.',
    };
    const compactionStatus = compaction.status === 'unsupported' || compaction.status === 'skipped'
      ? 'skipped'
      : compaction.ok ? 'completed' : 'failed';
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextCompaction',
      source: 'workspace-runtime',
      status: compactionStatus,
      message: compaction.ok
        ? 'Context compaction completed; retrying AgentServer generation once.'
        : compactionStatus === 'skipped'
          ? 'Context compact API unsupported; retrying AgentServer generation once with slim handoff diagnostics.'
          : 'Context compaction failed; retrying AgentServer generation once with slim handoff diagnostics.',
      detail: compaction.message || compaction.reason,
      contextCompaction: contextCompactionMetadata(compaction),
      contextWindowState: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
      raw: compaction,
    });
    const diagnostics: AgentServerGenerationFailureDiagnostics = {
      kind: 'contextWindowExceeded',
      backend: params.adapter.backend,
      provider: diagnosticProvider,
      model: params.model,
      agentId: params.agentId,
      sessionRef: contextSessionRef,
      originalErrorSummary,
      compaction,
      priorHandoff: params.priorHandoff,
      retryAttempted: true,
      retrySucceeded: false,
    };
    await appendContextRecoveryAuditAttempt({
      workspace: params.workspace,
      request: params.request,
      skill: params.skill,
      diagnostics,
      status: compaction.ok ? 'self-healed' : 'repair-needed',
      failureReason: originalErrorSummary,
    });
    return { retry: true, diagnostics };
  }

  const diagnostic = classifyAgentServerBackendFailure(params.error, {
    httpStatus: params.httpStatus,
    headers: params.headers,
    backend: params.adapter.backend,
    provider: diagnosticProvider,
    model: params.model,
  });
  if (!diagnostic) {
    return {
      retry: false,
      result: { ok: false, error: params.sanitizedError },
    };
  }

  if (params.dispatchAttempt >= 2 || params.contextRecovery?.retryAttempted) {
    return {
      retry: false,
      result: {
        ok: false,
        error: providerRateLimitDiagnosticMessage(diagnostic, true),
        diagnostics: {
          ...(params.contextRecovery ?? {}),
          kind: diagnostic.categories.includes('context-window') ? 'contextWindowExceeded' : diagnostic.categories.includes('rate-limit') || diagnostic.categories.includes('http-429') ? 'rateLimit' : 'agentserver',
          categories: diagnostic.categories,
          backend: diagnostic.backend,
          provider: diagnostic.provider,
          model: diagnostic.model,
          agentId: params.agentId,
          sessionRef: `${params.baseUrl}/api/agent-server/agents/${encodeURIComponent(params.agentId)}`,
          originalErrorSummary: providerRateLimitDiagnosticMessage(diagnostic, true),
          retryAfterMs: diagnostic.retryAfterMs,
          resetAt: diagnostic.resetAt,
          priorHandoff: params.priorHandoff,
          retryAttempted: true,
          retrySucceeded: false,
        },
      },
    };
  }

  const backoffMs = boundedRateLimitBackoffMs(diagnostic);
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: diagnostic.categories.includes('context-window') ? 'agentserver-context-window-recovery' : 'agentserver-generation-retry',
    source: 'workspace-runtime',
    status: 'running',
    message: 'AgentServer provider/rate-limit recovery: compacting context and retrying once.',
    detail: providerRateLimitDiagnosticMessage(diagnostic, false),
    raw: diagnostic,
  });
  if (backoffMs > 0) {
    await sleep(backoffMs);
  }
  const sessionRef = {
    agentId: params.agentId,
    workspace: params.workspace,
    baseUrl: params.baseUrl,
  };
  const compaction = await params.adapter.compactContext?.(
    sessionRef,
    `rate-limit-retry:${diagnostic.categories.join(',')}:${diagnostic.message.slice(0, 120)}`,
  );
  if (compaction) {
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextCompaction',
      source: 'workspace-runtime',
      status: compaction.ok ? 'completed' : 'failed',
      message: 'AgentServer compact before provider/rate-limit retry',
      detail: compaction.message || compaction.reason,
      contextCompaction: contextCompactionMetadata(compaction),
      contextWindowState: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
      raw: compaction,
    });
  }

  const retryAudit: AgentServerGenerationRetryAudit = {
    schemaVersion: 'sciforge.agentserver-generation-retry.v1',
    attempt: 2,
    maxAttempts: 2,
    trigger: diagnostic,
    firstFailedAt: new Date().toISOString(),
    backoffMs,
    recoveryActions: rateLimitRecoverActions(diagnostic),
    contextPolicy: {
      mode: 'delta',
      handoff: 'slimmed',
      compactBeforeRetry: true,
      maxRetryCount: 1,
    },
    compaction: compaction ? contextCompactionMetadata(compaction) : undefined,
    priorHandoff: params.priorHandoff,
  };
  return {
    retry: true,
    diagnostics: {
      kind: diagnostic.categories.includes('context-window') ? 'contextWindowExceeded' : diagnostic.categories.includes('rate-limit') || diagnostic.categories.includes('http-429') ? 'rateLimit' : 'agentserver',
      categories: diagnostic.categories,
      backend: diagnostic.backend,
      provider: diagnostic.provider,
      model: diagnostic.model,
      agentId: params.agentId,
      sessionRef: `${params.baseUrl}/api/agent-server/agents/${encodeURIComponent(params.agentId)}`,
      originalErrorSummary: providerRateLimitDiagnosticMessage(diagnostic, false),
      retryAfterMs: diagnostic.retryAfterMs,
      resetAt: diagnostic.resetAt,
      compaction,
      priorHandoff: params.priorHandoff,
      retryAudit,
      retryAttempted: true,
      retrySucceeded: false,
    },
  };
}

async function finalizeAgentServerGenerationSuccess<T extends Extract<AgentServerGenerationResult, { ok: true }>>(params: {
  result: T;
  contextRecovery?: AgentServerGenerationFailureDiagnostics;
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  callbacks?: WorkspaceRuntimeCallbacks;
  httpStatus?: number;
  headers?: Headers;
  priorHandoff?: AgentServerGenerationRetryAudit['priorHandoff'];
}): Promise<T> {
  if (!params.contextRecovery) return params.result;
  params.contextRecovery.retrySucceeded = true;
  if (String(params.contextRecovery.kind) === 'contextWindowExceeded') {
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-context-window-recovery',
      source: 'workspace-runtime',
      status: 'completed',
      message: 'AgentServer generation succeeded after context compaction retry.',
      detail: params.contextRecovery.compaction?.message || params.contextRecovery.originalErrorSummary,
      raw: params.contextRecovery,
    });
    await appendContextRecoveryAuditAttempt({
      workspace: params.workspace,
      request: params.request,
      skill: params.skill,
      diagnostics: params.contextRecovery,
      status: 'self-healed',
      failureReason: `Recovered from contextWindowExceeded after one compact+retry: ${params.contextRecovery.originalErrorSummary}`,
    });
    return params.result;
  }
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: 'agentserver-generation-retry',
    source: 'workspace-runtime',
    status: 'completed',
    message: 'AgentServer provider/rate-limit recovery succeeded after one compact retry.',
    detail: params.contextRecovery.originalErrorSummary,
    raw: params.contextRecovery,
  });
  return params.result;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  return normalizeAgentServerWorkspaceEventFromModule(raw);
}

function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  return withRequestContextWindowLimitFromModule(event, request);
}
