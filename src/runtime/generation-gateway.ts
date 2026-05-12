import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentServerGenerationSkill, loadSkillRegistry } from './skill-registry.js';
import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent, WorkspaceTaskRunResult } from './runtime-types.js';
import { fileExists, runWorkspaceTask } from './workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';
import { emitWorkspaceRuntimeEvent, throwIfRuntimeAborted } from './workspace-runtime-events.js';
import { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
import { cleanUrl, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, generatedTaskArchiveRel, headForAgentServer, isRecord, isTaskInputRel, readTextIfExists, summarizeTextChange, tailForAgentServer, toRecordList, toStringList } from './gateway-utils.js';
import { normalizeBackendHandoff } from './workspace-task-input.js';
import { sessionBundleRelForRequest } from './session-bundle.js';
import {
  expectedArtifactTypesForRequest,
  normalizeGatewayRequest as normalizeGatewayRequestFromModule,
  normalizeLlmEndpoint,
  selectedComponentIdsForRequest,
} from './gateway/gateway-request.js';
import { agentHarnessMetadata, requestWithAgentHarnessShadow, requestWithoutInlineAgentHarness } from './gateway/agent-harness-shadow.js';
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
import {
  captureRepairBoundarySnapshot,
  evaluateRepairBoundarySnapshot,
  repairBoundaryDiagnosticPayload,
  repairNeededPayload as buildRepairNeededPayload,
  type RepairPolicyRefs,
} from './gateway/repair-policy.js';
import {
  normalizeAgentServerWorkspaceEvent as normalizeAgentServerWorkspaceEventFromModule,
  withRequestContextWindowLimit as withRequestContextWindowLimitFromModule,
} from './gateway/workspace-event-normalizer.js';
import { runAgentServerGeneratedTask as runAgentServerGeneratedTaskFromModule } from './gateway/generated-task-runner.js';
import {
  agentServerAgentId,
  agentServerContextPolicy,
  contextCompactionMetadata,
  contextWindowMetadata,
  estimateWorkspaceContextWindowState,
  fetchAgentServerContextSnapshot,
  currentTurnReferences,
  handoffBudgetDecisionRecords,
  handoffContextWindowState,
  preflightAgentServerContextWindow,
  requestNeedsAgentServerContinuity,
} from './gateway/agentserver-context-window.js';
import {
  agentBackendAdapter,
  agentServerBackendSelectionDecision,
  isBlockingAgentServerConfigurationFailure,
} from './gateway/agent-backend-config.js';
import {
  coerceAgentServerToolPayload,
  coerceWorkspaceTaskPayload,
  configureDirectAnswerArtifactContext,
  ensureDirectAnswerReportArtifact,
  extractJson,
  mergeReusableContextArtifactsForDirectPayload,
  normalizeWorkspaceTaskPayloadBoundary,
  normalizeToolPayloadShape,
  toolPayloadFromPlainAgentOutput,
} from './gateway/direct-answer-payload.js';
import { directContextFastPathPayload } from './gateway/direct-context-fast-path.js';
import {
  agentServerLlmRuntime,
  AGENT_BACKEND_ANSWER_PRINCIPLE,
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
  summarizeRuntimeCapabilitiesForAgentServer,
  summarizeToolsForAgentServer,
  writeAgentServerDebugArtifact,
} from './gateway/agentserver-prompts.js';
import {
  agentServerRequestFailureMessage,
  agentServerRunFailure,
  extractAgentServerOutputText,
  looksLikeUnparsedGenerationResponseText,
  parseGenerationResponse,
  parseToolPayloadResponse,
} from './gateway/agentserver-run-output.js';
import { evaluateToolPayloadEvidence } from './gateway/work-evidence-guard.js';
import { evaluateGuidanceAdoption } from './gateway/guidance-adoption-guard.js';
import { summarizeWorkEvidenceForHandoff } from './gateway/work-evidence-types.js';
import { createLatencyTelemetry } from './gateway/latency-telemetry.js';
import { attachIntentFirstVerification } from './gateway/intent-first-verification.js';
import { applyRuntimeReplayRecorder, attachRuntimeReplayRecorderRefs } from './gateway/runtime-replay-recorder.js';
import { recordValidationRepairTelemetryForPayload } from './gateway/validation-repair-telemetry-runtime.js';
import {
  agentServerFailurePayloadRefs,
  agentServerGenerationFailureReason,
  configurePayloadValidationContext,
  failedTaskPayload,
  repairNeededPayload,
  schemaErrors,
  schemaValidationRepairPayload,
  validateAndNormalizePayload,
} from './gateway/payload-validation.js';
import { collectArtifactReferenceContext } from './gateway/artifact-reference-context.js';
import { sanitizeAgentServerError } from './gateway/backend-failure-diagnostics.js';
import {
  finalizeAgentServerGenerationSuccess,
  recoverOrReturnAgentServerGenerationFailure,
  type AgentServerGenerationFailureDiagnostics,
  type AgentServerGenerationResult,
} from './gateway/agentserver-generation-recovery.js';
import {
  activeGuidanceQueueForTaskInput,
  attemptPlanRefs,
  firstPayloadFailureReason,
  payloadHasFailureStatus,
} from './gateway/runtime-routing.js';
import {
  agentServerGenerationTokenGuardLimit,
  currentReferenceDigestSilentGuardPolicy,
  mergeBackendStreamWorkEvidence,
  readAgentServerRunStream,
  silentStreamDecisionFromGatewayRequest,
} from './gateway/agentserver-stream.js';
import {
  hydrateGeneratedTaskResponseFromText,
} from './gateway/generated-task-response-text.js';
import { hasRecoverableRecentAttempt } from './gateway/recoverable-attempts.js';
import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';
import { applyConversationPolicy } from './conversation-policy/apply.js';
import { toolPackageManifests } from '../../packages/skills/tool_skills';
import { AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE } from '../../packages/skills/runtime-policy';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import {
  agentServerConvergenceGuardEvent,
  agentServerDispatchEvent,
  agentServerSilentStreamGuardEvent,
  conversationPolicyStartedEvent,
  directContextFastPathEvent,
  gatewayRequestReceivedEvent,
  repairAttemptResultEvent,
  repairAttemptStartEvent,
  workspaceSkillSelectedEvent,
} from '@sciforge-ui/runtime-contract/events';

configureDirectAnswerArtifactContext(collectArtifactReferenceContext);
configurePayloadValidationContext(attemptPlanRefs);

function requestHandoffSource(request: GatewayRequest) {
  return request.handoffSource ?? 'cli';
}

export async function runWorkspaceRuntimeGateway(body: Record<string, unknown>, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  const normalizedRequest = normalizeGatewayRequestFromModule(body);
  const runtimeReplayRecorder = applyRuntimeReplayRecorder(callbacks, normalizedRequest);
  const telemetry = createLatencyTelemetry(normalizedRequest, runtimeReplayRecorder.callbacks);
  try {
    emitWorkspaceRuntimeEvent(telemetry.callbacks, gatewayRequestReceivedEvent(normalizedRequest.skillDomain));
    emitWorkspaceRuntimeEvent(telemetry.callbacks, conversationPolicyStartedEvent());
    const policyApplication = await applyConversationPolicy(normalizedRequest, telemetry.callbacks, { workspace: normalizedRequest.workspacePath });
    telemetry.markPolicyApplication(policyApplication);
    const request = await requestWithAgentHarnessShadow(policyApplication.request, telemetry.callbacks, policyApplication);
    const directContextPayload = directContextFastPathPayload(request);
    if (directContextPayload) {
      emitWorkspaceRuntimeEvent(telemetry.callbacks, directContextFastPathEvent({
        executionModePlan: request.uiState?.executionModePlan,
        responsePlan: request.uiState?.responsePlan,
        latencyPolicy: request.uiState?.latencyPolicy,
      }));
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(directContextPayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const visionSensePayload = await tryRunVisionSenseRuntime(request, telemetry.callbacks);
    if (visionSensePayload) {
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(visionSensePayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const skills = await loadSkillRegistry(request);
    const skill = agentServerGenerationSkill(request.skillDomain);
    emitWorkspaceRuntimeEvent(telemetry.callbacks, workspaceSkillSelectedEvent({
      skillId: skill.id,
      skillDomain: request.skillDomain,
      entrypointType: skill.manifest.entrypoint.type,
    }));
    const payload = await runAgentServerGeneratedTask(request, skill, skills, telemetry.callbacks)
      ?? repairNeededPayload(request, skill, 'AgentServer task generation did not produce a runnable task.');
    telemetry.markVerificationStart();
    const verified = await recordValidationRepairTelemetryForPayload(
      await applyRuntimeVerificationPolicy(payload, request),
      request,
    );
    telemetry.markVerificationEnd();
    return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
  } catch (error) {
    telemetry.markFallback(errorMessage(error));
    telemetry.emitFinal();
    throw error;
  } finally {
    await runtimeReplayRecorder.flush?.();
  }
}

function finalizeGatewayPayload(
  payload: ToolPayload,
  request: GatewayRequest,
  runtimeReplayRecorder: ReturnType<typeof applyRuntimeReplayRecorder>,
  callbacks: WorkspaceRuntimeCallbacks,
): ToolPayload {
  return attachIntentFirstVerification(
    attachRuntimeReplayRecorderRefs(payload, runtimeReplayRecorder),
    request,
    { callbacks, runWorkVerify: true },
  );
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

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  return values.map(finiteNumber).find((value): value is number => value !== undefined);
}

function executionPromptForWorkspaceSkill(request: GatewayRequest) {
  const currentPrompt = request.uiState && typeof request.uiState.currentPrompt === 'string'
    ? request.uiState.currentPrompt.trim()
    : '';
  return currentPrompt || request.prompt;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
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
  const repairBoundaryBefore = await captureRepairBoundarySnapshot(workspace);
  const priorAttempts = await readTaskAttempts(workspace, params.taskId);
  const maxAttempts = agentServerRepairMaxAttempts();
  const attempt = Math.max(2, priorAttempts.length + 1);
  const parentAttempt = attempt - 1;
  if (attempt > maxAttempts) {
    return terminalAgentServerRepairFailurePayload(params, `AgentServer repair reached the maximum attempt budget (${maxAttempts}) before producing a valid ToolPayload.`);
  }
  emitWorkspaceRuntimeEvent(params.callbacks, repairAttemptStartEvent({
    attempt,
    maxAttempts,
    failureReason: params.failureReason,
  }));
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
  const repairBoundaryAfter = await captureRepairBoundarySnapshot(workspace);
  const repairBoundaryViolation = evaluateRepairBoundarySnapshot(repairBoundaryBefore, repairBoundaryAfter, {
    taskRel: params.run.spec.taskRel,
    allowedPrefixes: [
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/tasks/` : undefined,
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/debug/agentserver/` : undefined,
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/handoffs/` : undefined,
      `${sessionBundleRelForRequest(params.request).replace(/\/+$/, '')}/debug/agentserver/`,
      `${sessionBundleRelForRequest(params.request).replace(/\/+$/, '')}/handoffs/`,
    ].filter((value): value is string => Boolean(value)),
  });
  const diffSummary = repair.ok
    ? summarizeTextChange(beforeCode, afterCode, repair.diffSummary)
    : repair.error;
  const diffRel = `.sciforge/task-diffs/${params.taskId}-attempt-${attempt}.diff.txt`;
  await mkdir(dirname(join(workspace, diffRel)), { recursive: true });
  await writeFile(join(workspace, diffRel), diffSummary || 'AgentServer repair produced no diff summary.');

  if (repairBoundaryViolation) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: [diffSummary, repairBoundaryViolation.reason].filter(Boolean).join('\n\n'),
      diffRef: diffRel,
      status: 'repair-needed',
      codeRef: params.run.spec.taskRel,
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      exitCode: params.run.exitCode,
      failureReason: repairBoundaryViolation.reason,
      createdAt: new Date().toISOString(),
    });
    return await repairBoundaryDiagnosticPayload({
      workspace,
      request: params.request,
      skill: params.skill,
      violation: repairBoundaryViolation,
      refs: {
        taskRel: params.run.spec.taskRel,
        outputRel: params.run.outputRef,
        stdoutRel: params.run.stdoutRef,
        stderrRel: params.run.stderrRef,
        blocker: 'repair-boundary',
        agentServerRefs: {
          diffRef: diffRel,
          repairRunId: repair.ok ? repair.runId : undefined,
        },
      },
    });
  }

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
    return terminalAgentServerRepairFailurePayload(params, repair.error);
  }

  if (repairShouldStopForNoCodeChange(beforeCode, afterCode, priorAttempts, params.failureReason)) {
    const failureReason = [
      'AgentServer repair produced no task code changes after a repeated failure; stopping repair reruns to avoid repeating the same failed workspace task.',
      `Previous failure: ${params.failureReason}`,
    ].join(' ');
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
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      exitCode: params.run.exitCode,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    return terminalAgentServerRepairFailurePayload(params, failureReason);
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
  emitWorkspaceRuntimeEvent(params.callbacks, repairAttemptResultEvent({
    attempt,
    maxAttempts,
    exitCode: rerun.exitCode,
    stdout: rerun.stdout,
    stderr: rerun.stderr,
  }));

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
    return terminalAgentServerRepairFailurePayload(params, rerun.stderr || 'AgentServer repair rerun failed before writing output.', {
      outputRel,
      stdoutRel,
      stderrRel,
    });
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const boundaryPayload = normalizeWorkspaceTaskPayloadBoundary(rawPayload) as ToolPayload;
    const payload = coerceWorkspaceTaskPayload(boundaryPayload) ?? boundaryPayload;
    const rawErrors = schemaErrors(rawPayload);
    const payloadErrors = schemaErrors(payload);
    const errors = payloadErrors.length ? payloadErrors : [];
    const normalized = errors.length ? undefined : await validateAndNormalizePayload(payload, params.request, params.skill, {
      taskRel: params.run.spec.taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: rerun.runtimeFingerprint,
    });
    const evidenceFinding = normalized ? evaluateToolPayloadEvidence(normalized, params.request) : undefined;
    const guidanceFinding = normalized ? evaluateGuidanceAdoption(normalized, params.request) : undefined;
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized ?? payload);
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
      if (errors.length) {
        return schemaValidationRepairPayload({
          payload,
          sourcePayload: rawPayload,
          errors,
          request: params.request,
          skill: params.skill,
          refs: {
            taskRel: params.run.spec.taskRel,
            outputRel,
            stdoutRel,
            stderrRel,
          },
        });
      }
      return terminalAgentServerRepairFailurePayload(params, failureReason ?? `AgentServer repair rerun exited ${rerun.exitCode}.`, {
        outputRel,
        stdoutRel,
        stderrRel,
      });
    }
    if (!normalized) {
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
    return terminalAgentServerRepairFailurePayload(params, `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`, {
      outputRel,
      stdoutRel,
      stderrRel,
    });
  }
}

function terminalAgentServerRepairFailurePayload(
  params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    run: WorkspaceTaskRunResult;
  },
  reason: string,
  refs: Partial<RepairPolicyRefs> = {},
) {
  return repairNeededPayload(params.request, params.skill, reason, {
    taskRel: params.run.spec.taskRel,
    outputRel: params.run.outputRef,
    stdoutRel: params.run.stdoutRef,
    stderrRel: params.run.stderrRef,
    ...refs,
  });
}

export function agentServerRepairMaxAttempts() {
  const value = Number(process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS || 4);
  return Number.isFinite(value) ? Math.max(2, Math.min(50, Math.floor(value))) : 4;
}

export function repairShouldStopForNoCodeChange(
  beforeCode: string,
  afterCode: string,
  priorAttempts: unknown[],
  failureReason: string,
) {
  if (beforeCode !== afterCode) return false;
  const normalizedFailure = normalizeRepairFailureReason(failureReason);
  if (!normalizedFailure) return false;
  return priorAttempts.some((attempt) => {
    if (!isRecord(attempt)) return false;
    return [
      attempt.failureReason,
      attempt.selfHealReason,
      attempt.patchSummary,
    ].some((value) => normalizeRepairFailureReason(value) === normalizedFailure);
  });
}

function normalizeRepairFailureReason(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value
    .replace(/-attempt-\d+/g, '-attempt-N')
    .replace(/generated-[a-z]+-[a-f0-9]{12}/g, 'generated-domain-id')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
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
  const abortGeneration = () => controller.abort();
  params.callbacks?.signal?.addEventListener('abort', abortGeneration, { once: true });
  if (params.callbacks?.signal?.aborted) controller.abort();
  let runPayload: unknown;
  let contextRecovery: AgentServerGenerationFailureDiagnostics | undefined;
  let strictTaskFilesReason = params.strictTaskFilesReason;
  try {
    const request = params.request;
    const promptRequest = requestWithoutInlineAgentHarness(request);
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(request, params.workspace);
    const backendSelectionDecision = agentServerBackendSelectionDecision(request, llmRuntime.llmEndpoint);
    const backend = backendSelectionDecision.backend;
    const needsContinuity = requestNeedsAgentServerContinuity(promptRequest);
    const generationPurpose = needsContinuity ? 'workspace-task-generation' : 'workspace-task-generation-inline';
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const adapter = agentBackendAdapter(backend);
    const agentId = agentServerAgentId(promptRequest, 'task-generation');
    for (let dispatchAttempt = 1; dispatchAttempt <= 2; dispatchAttempt += 1) {
    const preflight = await preflightAgentServerContextWindow({
      adapter,
      baseUrl: params.baseUrl,
      workspace: params.workspace,
      agentId,
      callbacks: params.callbacks,
    });
    const workspaceTree = await workspaceTreeSummary(params.workspace);
    const recentAttempts = await readRecentTaskAttempts(params.workspace, promptRequest.skillDomain, 8, {
        scenarioPackageId: promptRequest.scenarioPackageRef?.id,
        skillPlanRef: promptRequest.skillPlanRef,
        prompt: promptRequest.prompt,
      });
    const attachPriorAttempts = needsContinuity || hasRecoverableRecentAttempt(recentAttempts, promptRequest.prompt);
    const priorAttempts = currentTurnReferences(promptRequest).length || !attachPriorAttempts
      ? []
      : summarizeTaskAttemptsForAgentServer(recentAttempts);
    const agentServerSnapshot = preflight.state?.snapshot ?? await fetchAgentServerContextSnapshot(params.baseUrl, agentId);
    const contextMode = contextEnvelopeMode(promptRequest, {
      agentServerCoreAvailable: Boolean(agentServerSnapshot),
      forceSlimHandoff: preflight.forceSlimHandoff || Boolean(contextRecovery),
    });
    const contextEnvelope: Record<string, unknown> = buildContextEnvelope(promptRequest, {
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
    const compactContext = buildAgentServerCompactContext(promptRequest, {
      contextEnvelope,
      workspaceTree,
      priorAttempts,
      mode: contextMode,
    });
    const generationRequest = {
      prompt: promptRequest.prompt,
      skillDomain: promptRequest.skillDomain,
      contextEnvelope,
      workspaceTreeSummary: compactContext.workspaceTreeSummary,
      availableSkills: [],
      availableTools: summarizeToolsForAgentServer(promptRequest),
      availableRuntimeCapabilities: summarizeRuntimeCapabilitiesForAgentServer(promptRequest),
      artifactSchema: expectedArtifactSchema(promptRequest),
      uiManifestContract: {
        type: 'array',
        slotType: 'object',
        requiredKeys: ['componentId'],
        optionalKeys: ['artifactRef', 'encoding', 'layout', 'compare', 'title', 'priority'],
        contentRule: 'Do not put result rows/items/content in uiManifest; put them in artifacts[].data or artifacts[].dataRef.',
      },
      uiStateSummary: compactContext.uiStateSummary,
      artifacts: compactContext.artifacts,
      recentExecutionRefs: compactContext.recentExecutionRefs,
      expectedArtifactTypes: expectedArtifactTypesForRequest(promptRequest),
      selectedComponentIds: promptRequest.selectedComponentIds ?? toStringList(promptRequest.uiState?.selectedComponentIds),
      priorAttempts: compactContext.priorAttempts,
      strictTaskFilesReason,
      retryAudit: contextRecovery?.retryAudit,
      freshCurrentTurn: !needsContinuity,
    };
    const generationPrompt = buildAgentServerGenerationPrompt(generationRequest);
    const contextEnvelopeBytes = Buffer.byteLength(JSON.stringify(contextEnvelope), 'utf8');
    const harnessMetadata = agentHarnessMetadata(request, {
      backendSelectionDecision,
      llmEndpoint: llmRuntime.llmEndpoint,
      startupContextEnvelope: contextEnvelope.startupContextEnvelope as Record<string, unknown> | undefined,
    });
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
            ? 'Fresh-generation hard rule: do not call shell/filesystem/browser tools to inspect the workspace, .sciforge, old task attempts, logs, artifacts, installed packages, or prior generated code before returning. If the user task needs network, downloads, PDF/full-text reading, computation, or file creation, generate a bounded runnable task that performs that work at execution time. Your first substantive assistant output must be the final compact JSON for a direct ToolPayload or a runnable AgentServerGenerationResponse.'
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
          ...harnessMetadata,
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
          toolPolicy: needsContinuity ? {
            mode: 'continuity-read-limited',
            inspectOnlyReferencedWorkspaceRefs: true,
          } : {
            mode: 'fresh-generation-no-native-inspection',
            generateRunnableTaskForExternalWork: true,
            finalJsonFirst: true,
          },
          ...harnessMetadata,
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
        toolPolicy: needsContinuity ? {
          mode: 'continuity-read-limited',
          inspectOnlyReferencedWorkspaceRefs: true,
        } : {
          mode: 'fresh-generation-no-native-inspection',
          generateRunnableTaskForExternalWork: true,
          finalJsonFirst: true,
        },
        ...harnessMetadata,
      },
    };
    const normalizedHandoff = await normalizeBackendHandoff(runPayload, {
      workspacePath: params.workspace,
      purpose: contextRecovery ? 'agentserver-generation-rate-limit-retry' : 'agentserver-generation',
      sessionBundleRel: sessionBundleRelForRequest(request),
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
      } : !needsContinuity ? {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 12_000,
        maxInlineJsonBytes: 24_000,
        maxArrayItems: 12,
        maxObjectKeys: 64,
        maxDepth: 5,
        headChars: 2_000,
        tailChars: 2_000,
        maxPriorAttempts: 0,
      } : {
        maxInlineStringChars: 24_000,
        headChars: 4_000,
        tailChars: 4_000,
      },
    });
    runPayload = withAgentServerDispatchMetadata(normalizedHandoff.payload, {
      contextMode: compactContext.mode,
      retryAudit: contextRecovery?.retryAudit,
    }, {
      backend,
    });
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
    emitWorkspaceRuntimeEvent(params.callbacks, agentServerDispatchEvent({
      backend,
      baseUrl: params.baseUrl,
      normalizedBytes: normalizedHandoff.normalizedBytes,
      maxPayloadBytes: normalizedHandoff.budget.maxPayloadBytes,
      rawRef: normalizedHandoff.rawRef,
    }));
    const response = await fetch(`${params.baseUrl}/api/agent-server/runs/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(runPayload),
    });
    const silentGuardPolicy = currentReferenceDigestSilentGuardPolicy(request);
    const silentRunId = typeof request.uiState?.silentStreamRunId === 'string'
      ? request.uiState.silentStreamRunId
      : typeof request.uiState?.sessionId === 'string'
        ? request.uiState.sessionId
        : undefined;
    const silentStreamDecision = silentStreamDecisionFromGatewayRequest(request);
    const { json, run, error, streamText, workEvidence } = await readAgentServerRunStream(response, (event) => {
      emitWorkspaceRuntimeEvent(params.callbacks, withRequestContextWindowLimit(
        normalizeAgentServerWorkspaceEvent(event),
        request,
      ));
    }, {
      maxTotalUsage: agentServerGenerationTokenGuardLimit(request),
      maxSilentMs: silentGuardPolicy.timeoutMs,
      silencePolicy: silentGuardPolicy,
      silentRetryCount: Math.max(0, dispatchAttempt - 1),
      silentRunId,
      silentStreamDecision,
      onGuardTrip: (message) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, agentServerConvergenceGuardEvent(message));
      },
      onSilentTimeout: (message, audit) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, {
          ...agentServerSilentStreamGuardEvent(message),
          detail: audit.detail,
          raw: audit,
        });
      },
    });
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, response.status, json, sessionBundleRelForRequest(request));
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
    const parsedRaw = parseGenerationResponse(run.output) ?? parseGenerationResponse(run) ?? parseGenerationResponse(streamText) ?? parseGenerationResponse(directText);
    const parsed = parsedRaw && directText ? hydrateGeneratedTaskResponseFromText(parsedRaw, directText) : parsedRaw;
    if (!parsed) {
      if (directText && looksLikeUnparsedGenerationResponseText(directText)) {
        const malformedGenerationReason = 'AgentServer returned a malformed or incomplete AgentServerGenerationResponse-looking JSON payload; retry with compact executable taskFiles JSON and no markdown fences.';
        if (!strictTaskFilesReason && dispatchAttempt < 2) {
          strictTaskFilesReason = malformedGenerationReason;
          emitWorkspaceRuntimeEvent(params.callbacks, {
            type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
            source: 'workspace-runtime',
            status: 'running',
            message: malformedGenerationReason,
            detail: 'Retrying AgentServer generation with a stricter taskFiles-only contract because the prior response looked like task code JSON but could not be parsed as a runnable generation response.',
          });
          continue;
        }
        return { ok: false, error: malformedGenerationReason };
      }
      if (directText) {
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
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, 0, { error: errorMessage(error) }, sessionBundleRelForRequest(params.request));
    return { ok: false, error: agentServerRequestFailureMessage('generation', error, timeoutMs) };
  } finally {
    clearTimeout(timeout);
    params.callbacks?.signal?.removeEventListener('abort', abortGeneration);
  }
}

function withAgentServerDispatchMetadata<T>(
  payload: T,
  metadata: Record<string, unknown>,
  required: { backend?: string } = {},
): T {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (required.backend) {
    const agent: Record<string, unknown> = isRecord(next.agent) ? { ...next.agent } : {};
    agent.backend = required.backend;
    next.agent = agent;
    const runtime: Record<string, unknown> = isRecord(next.runtime) ? { ...next.runtime } : {};
    runtime.backend = required.backend;
    next.runtime = runtime;
  }
  const input: Record<string, unknown> = isRecord(next.input) ? { ...next.input } : {};
  input.metadata = {
    ...(isRecord(input.metadata) ? input.metadata : {}),
    ...metadata,
  };
  next.input = input;
  next.metadata = {
    ...(isRecord(next.metadata) ? next.metadata : {}),
    ...metadata,
  };
  return next as T;
}

function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  return normalizeAgentServerWorkspaceEventFromModule(raw);
}

function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  return withRequestContextWindowLimitFromModule(event, request);
}
