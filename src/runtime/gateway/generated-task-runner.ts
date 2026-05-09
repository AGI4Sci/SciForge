import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { appendTaskAttempt, readRecentTaskAttempts } from '../task-attempt-history.js';
import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from '../skill-promotion.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { errorMessage, generatedTaskArchiveRel, isRecord, isTaskInputRel, safeWorkspaceRel, toRecordList, uniqueStrings } from '../gateway-utils.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import { currentTurnReferences } from './agentserver-context-window.js';
import { sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { evaluateToolPayloadEvidence } from './work-evidence-guard.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import { evaluateGuidanceAdoption } from './guidance-adoption-guard.js';
import { materializeBackendPayloadOutput, type RuntimeRefBundle } from './artifact-materializer.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { reportRuntimeResultViewSlots } from '../../../packages/presentation/interactive-views';
import {
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
  CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL,
  buildCurrentReferenceDigestRecoveryPayload,
  currentReferenceDigestFailureCanRecover,
  currentReferenceDigestRecoveryCandidates,
  type CurrentReferenceDigestRecoverySource,
} from '../../../packages/contracts/runtime/artifact-policy';
import {
  AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
  AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
  AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE,
  agentServerGeneratedEntrypointContractReason,
  agentServerGeneratedTaskInterfaceContractReason,
  agentServerGeneratedTaskRetryDetail,
  agentServerPathOnlyStrictRetryDirectPayloadReason,
  agentServerPathOnlyStrictRetryStillMissingReason,
  agentServerPathOnlyTaskFilesReason,
  agentServerStablePayloadTaskId,
} from '../../../packages/skills/runtime-policy';

const AGENTSERVER_DIRECT_PAYLOAD_TASK_REF = 'agentserver://direct-payload' as const;

type AgentServerGenerationResult =
  | { ok: true; runId?: string; response: AgentServerGenerationResponse }
  | { ok: true; runId?: string; directPayload: ToolPayload }
  | { ok: false; error: string; diagnostics?: any };

export interface GeneratedTaskRunnerDeps {
  readConfiguredAgentServerBaseUrl(workspace: string): Promise<string | undefined>;
  requestAgentServerGeneration(params: {
    baseUrl: string;
    request: GatewayRequest;
    skill: SkillAvailability;
    skills: SkillAvailability[];
    workspace: string;
    callbacks?: WorkspaceRuntimeCallbacks;
    strictTaskFilesReason?: string;
  }): Promise<AgentServerGenerationResult>;
  agentServerGenerationFailureReason(error: string, diagnostics?: any): string;
  attemptPlanRefs(request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string): Record<string, unknown>;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  agentServerFailurePayloadRefs(diagnostics?: any): Record<string, unknown>;
  ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload;
  mergeReusableContextArtifactsForDirectPayload(payload: ToolPayload, request: GatewayRequest): Promise<ToolPayload>;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
  tryAgentServerRepairAndRerun(params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    taskId: string;
    taskPrefix: string;
    run: WorkspaceTaskRunResult;
    schemaErrors: string[];
    failureReason: string;
    callbacks?: WorkspaceRuntimeCallbacks;
  }): Promise<ToolPayload | undefined>;
  failedTaskPayload(request: GatewayRequest, skill: SkillAvailability, run: WorkspaceTaskRunResult, parseReason?: string): ToolPayload;
  coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined;
  schemaErrors(payload: unknown): string[];
  firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
}

export async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks = {},
  deps: GeneratedTaskRunnerDeps,
  options: { allowSupplement?: boolean } = {},
): Promise<ToolPayload | undefined> {
  const {
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
  } = deps;
  const workspace = resolve(request.workspacePath || process.cwd());
  const baseUrl = request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(workspace);
  if (!baseUrl) {
    return repairNeededPayload(request, skill, 'No validated local skill matched this request and no AgentServer base URL is configured.');
  }
  let generation = await requestAgentServerGeneration({
    baseUrl,
    request,
    skill,
    skills,
    workspace,
    callbacks,
  });
  if (!generation.ok) {
    const digestRecovery = await currentReferenceDigestRecoveryPayload(request, skill, workspace, generation.error);
    if (digestRecovery) {
      emitWorkspaceRuntimeEvent(callbacks, {
        type: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
        source: 'workspace-runtime',
        status: 'self-healed',
        message: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
        detail: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
      });
      const recoveryRefs = backendPayloadRefs(
        stableAgentServerPayloadTaskId('digest-recovery', request, skill, sha1(request.prompt).slice(0, 8)),
        `agentserver://${CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH}`,
      );
      await writeBackendPayloadLogs(workspace, recoveryRefs, CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE);
      const normalizedRecovery = await validateAndNormalizePayload(digestRecovery, request, skill, {
        ...recoveryRefs,
        runtimeFingerprint: { runtime: CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL, error: generation.error },
      });
      return await materializeBackendPayloadOutput(workspace, request, normalizedRecovery, recoveryRefs);
    }
    const failureReason = agentServerGenerationFailureReason(generation.error, generation.diagnostics);
    const failedRequestId = `agentserver-generation-${request.skillDomain}-${sha1(`${request.prompt}:${generation.error}`).slice(0, 12)}`;
    await appendTaskAttempt(workspace, {
      id: failedRequestId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill, failureReason),
      skillId: skill.id,
      attempt: 1,
      status: 'repair-needed',
      failureReason,
      contextRecovery: generation.diagnostics?.kind === 'contextWindowExceeded' ? {
        kind: 'contextWindowExceeded',
        backend: generation.diagnostics.backend,
        provider: generation.diagnostics.provider,
        agentId: generation.diagnostics.agentId,
        sessionRef: generation.diagnostics.sessionRef,
        originalErrorSummary: generation.diagnostics.originalErrorSummary,
        compaction: generation.diagnostics.compaction,
        retryAttempted: generation.diagnostics.retryAttempted,
        retrySucceeded: generation.diagnostics.retrySucceeded,
      } : undefined,
      createdAt: new Date().toISOString(),
    });
    return repairNeededPayload(request, skill, failureReason, agentServerFailurePayloadRefs(generation.diagnostics));
  }
  if ('directPayload' in generation) {
    const directGeneration = generation;
    const directRefs = backendPayloadRefs(
      stableAgentServerPayloadTaskId('direct', request, skill, directGeneration.runId),
      AGENTSERVER_DIRECT_PAYLOAD_TASK_REF,
    );
    await writeBackendPayloadLogs(workspace, directRefs, `AgentServer direct ToolPayload run: ${directGeneration.runId || 'unknown'}\n`);
    const directPayload = await mergeReusableContextArtifactsForDirectPayload(
      ensureDirectAnswerReportArtifact(
        directGeneration.directPayload,
        request,
        'agentserver-direct-payload',
      ),
      request,
    );
    let normalized = await validateAndNormalizePayload(directPayload, request, skill, {
      ...directRefs,
      runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: directGeneration.runId },
    });
    normalized = await materializeBackendPayloadOutput(workspace, request, normalized, directRefs);
    const evidenceFinding = evaluateToolPayloadEvidence(normalized, request);
    const guidanceFinding = evaluateGuidanceAdoption(normalized, request);
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized);
    const payloadFailureReason = firstPayloadFailureReason(normalized) ?? firstRepairOrFailurePayloadReason(normalized);
    const payloadFailureStatus = payloadHasFailureStatus(normalized) || payloadHasRepairOrFailureStatus(normalized);
    const failureReason = payloadFailureReason ?? (!payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined);
    const attemptStatus = guidanceFinding
      ? guidanceFinding.severity
      : evidenceFinding
        ? evidenceFinding.severity
      : payloadFailureStatus
        ? payloadAttemptStatus(normalized)
        : 'done';
    await appendTaskAttempt(workspace, {
      id: `agentserver-direct-${skill.id}-${sha1(`${request.prompt}:${directGeneration.runId || 'unknown'}`).slice(0, 12)}`,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: attemptStatus,
      codeRef: directRefs.taskRel,
      outputRef: directRefs.outputRel,
      stdoutRef: directRefs.stdoutRel,
      stderrRef: directRefs.stderrRel,
      workEvidenceSummary,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    if (guidanceFinding || evidenceFinding) {
      return repairNeededPayload(request, skill, guidanceFinding?.reason ?? evidenceFinding?.reason ?? 'AgentServer payload failed runtime guard.');
    }
    if (payloadFailureStatus) return normalized;
    const completed = {
      ...normalized,
      reasoningTrace: [
        normalized.reasoningTrace,
        `AgentServer generation run: ${directGeneration.runId || 'unknown'}`,
        'AgentServer returned a SciForge ToolPayload directly; no workspace task archive was required.',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(request, skill),
        agentServerGenerated: true,
        agentServerRunId: directGeneration.runId,
      } : unit),
    };
    return await materializeBackendPayloadOutput(workspace, request, completed, directRefs);
  }

  const nonExecutableEntrypointReason = agentServerGeneratedEntrypointContractReason(generation.response, { normalizePath: safeWorkspaceRel });
  if (nonExecutableEntrypointReason) {
    emitWorkspaceRuntimeEvent(callbacks, {
      type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
      source: 'workspace-runtime',
      status: 'running',
      message: nonExecutableEntrypointReason,
      detail: agentServerGeneratedTaskRetryDetail('entrypoint'),
    });
    const retriedGeneration = await requestAgentServerGeneration({
      baseUrl,
      request,
      skill,
      skills,
      workspace,
      callbacks,
      strictTaskFilesReason: nonExecutableEntrypointReason,
    });
    if (!retriedGeneration.ok) return repairNeededPayload(request, skill, retriedGeneration.error);
    if ('directPayload' in retriedGeneration) {
      const retryDirectRefs = backendPayloadRefs(
        stableAgentServerPayloadTaskId('direct-retry-entrypoint', request, skill, retriedGeneration.runId),
        AGENTSERVER_DIRECT_PAYLOAD_TASK_REF,
      );
      await writeBackendPayloadLogs(workspace, retryDirectRefs, `AgentServer strict retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`);
      const directPayload = await mergeReusableContextArtifactsForDirectPayload(
        ensureDirectAnswerReportArtifact(retriedGeneration.directPayload, request, 'agentserver-direct-payload'),
        request,
      );
      const normalizedDirect = await validateAndNormalizePayload(directPayload, request, skill, {
        ...retryDirectRefs,
        runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: retriedGeneration.runId },
      });
      return await materializeBackendPayloadOutput(workspace, request, normalizedDirect, retryDirectRefs);
    }
    generation = retriedGeneration;
    const retryReason = agentServerGeneratedEntrypointContractReason(generation.response, { normalizePath: safeWorkspaceRel });
    if (retryReason) {
      return repairNeededPayload(request, skill, `AgentServer generation contract violation: ${nonExecutableEntrypointReason}. Strict retry still returned invalid entrypoint: ${retryReason}`);
    }
  }

  const missingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(workspace, generation.response.taskFiles);
  if (missingPathOnlyTaskFiles.length) {
    const reason = agentServerPathOnlyTaskFilesReason(missingPathOnlyTaskFiles);
    emitWorkspaceRuntimeEvent(callbacks, {
      type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
      source: 'workspace-runtime',
      status: 'running',
      message: reason,
      detail: agentServerGeneratedTaskRetryDetail('path-only-task-files'),
    });
    const retriedGeneration = await requestAgentServerGeneration({
      baseUrl,
      request,
      skill,
      skills,
      workspace,
      callbacks,
      strictTaskFilesReason: reason,
    });
    if (!retriedGeneration.ok) {
      return repairNeededPayload(request, skill, retriedGeneration.error);
    }
    if ('directPayload' in retriedGeneration) {
      return repairNeededPayload(
        request,
        skill,
        agentServerPathOnlyStrictRetryDirectPayloadReason(reason),
      );
    }
    generation = retriedGeneration;
    const stillMissingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(workspace, generation.response.taskFiles);
    if (stillMissingPathOnlyTaskFiles.length) {
      const contractReason = agentServerPathOnlyStrictRetryStillMissingReason(reason, stillMissingPathOnlyTaskFiles);
      return repairNeededPayload(request, skill, `AgentServer generation contract violation: ${contractReason}`);
    }
  }

  const taskInterfaceReason = await generatedTaskInterfaceContractReason(workspace, generation.response);
  if (taskInterfaceReason) {
    emitWorkspaceRuntimeEvent(callbacks, {
      type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
      source: 'workspace-runtime',
      status: 'running',
      message: taskInterfaceReason,
      detail: agentServerGeneratedTaskRetryDetail('task-interface'),
    });
    const retriedGeneration = await requestAgentServerGeneration({
      baseUrl,
      request,
      skill,
      skills,
      workspace,
      callbacks,
      strictTaskFilesReason: taskInterfaceReason,
    });
    if (!retriedGeneration.ok) {
      return repairNeededPayload(request, skill, retriedGeneration.error);
    }
    if ('directPayload' in retriedGeneration) {
      const retryDirectRefs = backendPayloadRefs(
        stableAgentServerPayloadTaskId('direct-retry-interface', request, skill, retriedGeneration.runId),
        AGENTSERVER_DIRECT_PAYLOAD_TASK_REF,
      );
      await writeBackendPayloadLogs(workspace, retryDirectRefs, `AgentServer interface retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`);
      const directPayload = await mergeReusableContextArtifactsForDirectPayload(
        ensureDirectAnswerReportArtifact(retriedGeneration.directPayload, request, 'agentserver-direct-payload'),
        request,
      );
      const normalizedDirect = await validateAndNormalizePayload(directPayload, request, skill, {
        ...retryDirectRefs,
        runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: retriedGeneration.runId },
      });
      return await materializeBackendPayloadOutput(workspace, request, normalizedDirect, retryDirectRefs);
    }
    generation = retriedGeneration;
    const retryInterfaceReason = await generatedTaskInterfaceContractReason(workspace, generation.response);
    if (retryInterfaceReason) {
      return repairNeededPayload(request, skill, `AgentServer generation contract violation: ${taskInterfaceReason}. Strict retry still returned a static/non-interface task: ${retryInterfaceReason}`);
    }
  }

  const taskId = `generated-${request.skillDomain}-${sha1(`${request.prompt}:${Date.now()}`).slice(0, 12)}`;
  const generatedPathMap = new Map<string, string>();
  const generatedInputRels: string[] = [];
  try {
    for (const file of generation.response.taskFiles) {
      const declaredRel = safeWorkspaceRel(file.path);
      const rel = generatedTaskArchiveRel(taskId, declaredRel);
      generatedPathMap.set(declaredRel, rel);
      if (isTaskInputRel(declaredRel)) generatedInputRels.push(declaredRel);
      const content = file.content || await readGeneratedTaskFileIfPresent(workspace, file.path);
      if (content === undefined) {
        return repairNeededPayload(
          request,
          skill,
          `AgentServer returned taskFiles path-only reference but SciForge could not read workspace file: ${declaredRel}`,
        );
      }
      await mkdir(dirname(join(workspace, declaredRel)), { recursive: true });
      await writeFile(join(workspace, declaredRel), content);
      await mkdir(dirname(join(workspace, rel)), { recursive: true });
      await writeFile(join(workspace, rel), content);
      emitWorkspaceRuntimeEvent(callbacks, {
        type: AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
        source: 'workspace-runtime',
        message: `Materialized AgentServer task file ${declaredRel}`,
        detail: rel === declaredRel ? declaredRel : `${declaredRel} -> ${rel}`,
      });
    }
  } catch (error) {
    return repairNeededPayload(request, skill, `AgentServer generated task files could not be archived: ${sanitizeAgentServerError(errorMessage(error))}`);
  }
  const entrypointOriginalRel = safeWorkspaceRel(generation.response.entrypoint.path);
  const taskRel = generatedPathMap.get(entrypointOriginalRel) ?? generatedTaskArchiveRel(taskId, generation.response.entrypoint.path);
  const outputRel = `.sciforge/task-results/${taskId}.json`;
  const stdoutRel = `.sciforge/logs/${taskId}.stdout.log`;
  const stderrRel = `.sciforge/logs/${taskId}.stderr.log`;
  const generatedExpectedArtifacts = expectedArtifactTypesForGeneratedRun(request, generation.response.expectedArtifacts);
  const generatedSupplementScope = supplementScopeForGeneratedRun(request, generation.response.expectedArtifacts);
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: generation.response.entrypoint.language,
    entrypoint: generation.response.entrypoint.command || 'main',
    entrypointArgs: generation.response.entrypoint.args,
    taskRel,
    input: {
      prompt: request.prompt,
      attempt: 1,
      skillId: skill.id,
      agentServerGenerated: true,
      artifacts: request.artifacts,
      uiStateSummary: request.uiState,
      taskProjectHandoff: isRecord(request.uiState?.taskProjectHandoff) ? request.uiState.taskProjectHandoff : undefined,
      userGuidanceQueue: activeGuidanceQueueForTaskInput(request),
      recentExecutionRefs: toRecordList(request.uiState?.recentExecutionRefs),
      priorAttempts: currentTurnReferences(request).length
        ? []
        : summarizeTaskAttemptsForAgentServer(await readRecentTaskAttempts(workspace, request.skillDomain, 8, {
          scenarioPackageId: request.scenarioPackageRef?.id,
          skillPlanRef: request.skillPlanRef,
          prompt: request.prompt,
        })),
      expectedArtifacts: generatedExpectedArtifacts,
      selectedComponentIds: selectedComponentIdsForRequest(request),
    },
    retentionProtectedInputRels: generatedInputRels,
    outputRel,
    stdoutRel,
    stderrRel,
  });

  if (run.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    const failureReason = run.stderr || 'AgentServer generated task failed before writing output.';
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: 'repair-needed',
      codeRef: taskRel,
      inputRef: `.sciforge/task-inputs/${taskId}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    await writeCapabilityEvolutionEventBestEffort({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      taskRel,
      inputRel: `.sciforge/task-inputs/${taskId}.json`,
      outputRel,
      stdoutRel,
      stderrRel,
      failureReason,
      recoverActions: ['inspect-stderr-ref', 'repair-generated-task', 'rerun-generated-task'],
    });
    const repaired = await tryAgentServerRepairAndRerun({
      request,
      skill,
      taskId,
      taskPrefix: 'generated',
      run,
      schemaErrors: [],
      failureReason,
      callbacks,
    });
    if (repaired) {
      await writeCapabilityEvolutionEventBestEffort({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        runId: generation.runId,
        run,
        payload: repaired,
        taskRel,
        inputRel: `.sciforge/task-inputs/${taskId}.json`,
        outputRel,
        stdoutRel,
        stderrRel,
        failureReason,
        finalStatus: 'repair-succeeded',
        repairAttempt: {
          id: `${taskId}-repair`,
          status: 'succeeded',
          reason: failureReason,
          validationResult: { verdict: 'pass', validatorId: 'sciforge.payload-schema' },
        },
      });
      return repaired;
    }
    return failedTaskPayload(request, skill, run, failureReason);
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const payload = coerceWorkspaceTaskPayload(rawPayload) ?? rawPayload;
    const errors = schemaErrors(payload);
    let normalized = errors.length ? undefined : await validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    if (normalized) {
      normalized = await materializeBackendPayloadOutput(workspace, request, normalized, { taskRel, outputRel, stdoutRel, stderrRel });
    }
    const evidenceFinding = normalized ? evaluateToolPayloadEvidence(normalized, request) : undefined;
    const guidanceFinding = normalized ? evaluateGuidanceAdoption(normalized, request) : undefined;
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized ?? payload);
    const normalizedFailureReason = normalized ? firstPayloadFailureReason(normalized, run) ?? firstRepairOrFailurePayloadReason(normalized) : undefined;
    const normalizedFailureStatus = normalized ? payloadHasFailureStatus(normalized) || payloadHasRepairOrFailureStatus(normalized) : false;
    const normalizedRepairNeeded = normalized ? payloadHasRepairNeededStatus(normalized) : false;
    const payloadFailureReason = firstPayloadFailureReason(payload, run) ?? firstRepairOrFailurePayloadReason(payload) ?? normalizedFailureReason;
    const payloadFailureStatus = payloadHasFailureStatus(payload) || payloadHasRepairOrFailureStatus(payload) || normalizedFailureStatus;
    const evidenceFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
    const failureReason = payloadFailureReason ?? evidenceFailureReason;
    const shouldRepairExecutionFailure = errors.length === 0 && Boolean(failureReason)
      && (run.exitCode !== 0 || Boolean(evidenceFailureReason) || normalizedRepairNeeded);
    const attemptStatus = errors.length
      ? 'repair-needed'
      : shouldRepairExecutionFailure
        ? normalizedRepairNeeded ? 'repair-needed' : guidanceFinding?.severity ?? evidenceFinding?.severity ?? 'repair-needed'
        : payloadFailureStatus
          ? normalized ? payloadAttemptStatus(normalized) : payloadAttemptStatus(payload)
          : 'done';
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: attemptStatus,
      codeRef: taskRel,
      inputRef: `.sciforge/task-inputs/${taskId}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      schemaErrors: errors,
      workEvidenceSummary,
      failureReason: errors.length ? `AgentServer generated task output failed schema validation: ${errors.join('; ')}` : failureReason,
      createdAt: new Date().toISOString(),
    });
    if (errors.length || shouldRepairExecutionFailure) {
      const repairFailureReason = errors.length
        ? `AgentServer generated task output failed schema validation: ${errors.join('; ')}`
        : normalizedRepairNeeded
          ? String(failureReason)
          : evidenceFailureReason ?? `AgentServer generated task exited ${run.exitCode} with failed payload: ${failureReason}`;
      await writeCapabilityEvolutionEventBestEffort({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        runId: generation.runId,
        run,
        payload: normalized ?? payload,
        taskRel,
        inputRel: `.sciforge/task-inputs/${taskId}.json`,
        outputRel,
        stdoutRel,
        stderrRel,
        schemaErrors: errors,
        failureReason: repairFailureReason,
        recoverActions: errors.length
          ? ['repair-output-schema', 'preserve-output-ref', 'rerun-generated-task']
          : ['repair-runtime-evidence', 'preserve-output-ref', 'rerun-generated-task'],
      });
      const repaired = await tryAgentServerRepairAndRerun({
        request,
        skill,
        taskId,
        taskPrefix: 'generated',
        run,
        schemaErrors: errors,
        failureReason: repairFailureReason,
        callbacks,
      });
      if (repaired) {
        await writeCapabilityEvolutionEventBestEffort({
          workspacePath: workspace,
          request,
          skill,
          taskId,
          runId: generation.runId,
          run,
          payload: repaired,
          taskRel,
          inputRel: `.sciforge/task-inputs/${taskId}.json`,
          outputRel,
          stdoutRel,
          stderrRel,
          schemaErrors: errors,
          failureReason: repairFailureReason,
          finalStatus: 'repair-succeeded',
          repairAttempt: {
            id: `${taskId}-repair`,
            status: 'succeeded',
            reason: repairFailureReason,
            validationResult: { verdict: 'pass', validatorId: 'sciforge.payload-schema' },
          },
        });
        return repaired;
      }
      if (normalizedRepairNeeded && normalized) return normalized;
      return repairNeededPayload(request, skill, repairFailureReason);
    }
    if (!normalized) {
      return repairNeededPayload(request, skill, 'AgentServer generated task output could not be normalized after schema validation.');
    }
    if (normalizedFailureStatus) return normalized;
    if (options.allowSupplement !== false) {
      const supplemented = await tryAgentServerSupplementMissingArtifacts({
        request,
        skill,
        skills,
        baseUrl,
        workspace,
        payload: normalized,
        primaryTaskId: taskId,
        primaryRunId: generation.runId,
        primaryRun: run,
        primaryRefs: { taskRel, outputRel, stdoutRel, stderrRel },
        expectedArtifactTypes: generatedSupplementScope,
        callbacks,
        deps,
      });
      if (supplemented) return await materializeBackendPayloadOutput(workspace, request, supplemented, { taskRel, outputRel, stdoutRel, stderrRel });
    }
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      taskRel,
      inputRef: `.sciforge/task-inputs/${taskId}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      payload: normalized,
      patchSummary: generation.response.patchSummary,
    });
    const completed = {
      ...normalized,
      reasoningTrace: [
        normalized.reasoningTrace,
        `AgentServer generation run: ${generation.runId || 'unknown'}`,
        `Generation summary: ${generation.response.patchSummary || 'task generated'}`,
        proposal ? `Skill promotion proposal: .sciforge/skill-proposals/${proposal.id}` : '',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(request, skill),
        agentServerGenerated: true,
        agentServerRunId: generation.runId,
        patchSummary: generation.response.patchSummary,
      } : unit),
    };
    await writeCapabilityEvolutionEventBestEffort({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      payload: completed,
      taskRel,
      inputRel: `.sciforge/task-inputs/${taskId}.json`,
      outputRel,
      stdoutRel,
      stderrRel,
      finalStatus: 'succeeded',
      recoverActions: ['record-successful-dynamic-glue', 'preserve-runtime-evidence-refs'],
      eventKind: 'dynamic-glue-execution',
      promotionReason: 'Successful dynamic glue execution is ledger evidence; repeated compatible records can become promotion candidates.',
    });
    return await materializeBackendPayloadOutput(workspace, request, completed, { taskRel, outputRel, stdoutRel, stderrRel });
  } catch (error) {
    const failureReason = `AgentServer generated task output could not be parsed: ${errorMessage(error)}`;
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: 'repair-needed',
      codeRef: taskRel,
      inputRef: `.sciforge/task-inputs/${taskId}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    await writeCapabilityEvolutionEventBestEffort({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      taskRel,
      inputRel: `.sciforge/task-inputs/${taskId}.json`,
      outputRel,
      stdoutRel,
      stderrRel,
      schemaErrors: ['output could not be parsed'],
      failureReason,
      recoverActions: ['inspect-output-ref', 'repair-output-parser', 'rerun-generated-task'],
    });
    const repaired = await tryAgentServerRepairAndRerun({
      request,
      skill,
      taskId,
      taskPrefix: 'generated',
      run,
      schemaErrors: ['output could not be parsed'],
      failureReason,
      callbacks,
    });
    if (repaired) {
      await writeCapabilityEvolutionEventBestEffort({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        runId: generation.runId,
        run,
        payload: repaired,
        taskRel,
        inputRel: `.sciforge/task-inputs/${taskId}.json`,
        outputRel,
        stdoutRel,
        stderrRel,
        schemaErrors: ['output could not be parsed'],
        failureReason,
        finalStatus: 'repair-succeeded',
        repairAttempt: {
          id: `${taskId}-repair`,
          status: 'succeeded',
          reason: failureReason,
          validationResult: { verdict: 'pass', validatorId: 'sciforge.payload-schema' },
        },
      });
      return repaired;
    }
    return failedTaskPayload(request, skill, run, failureReason);
  }
}

function backendPayloadRefs(taskId: string, taskRel: string): RuntimeRefBundle {
  return {
    taskRel,
    outputRel: `.sciforge/task-results/${taskId}.json`,
    stdoutRel: `.sciforge/logs/${taskId}.stdout.log`,
    stderrRel: `.sciforge/logs/${taskId}.stderr.log`,
  };
}

function payloadHasRepairOrFailureStatus(payload: ToolPayload) {
  return payloadHasRepairNeededStatus(payload)
    || (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
      .some((unit) => isRecord(unit) && /failed|error|needs-human/i.test(String(unit.status || '')));
}

function payloadHasRepairNeededStatus(payload: ToolPayload) {
  if (/repair-needed|needs-human/i.test(String(payload.claimType || ''))) return true;
  return (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /repair-needed|needs-human/i.test(String(unit.status || '')));
}

function firstRepairOrFailurePayloadReason(payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  const unit = units.find((entry) => isRecord(entry) && /repair-needed|failed|error|needs-human/i.test(String(entry.status || '')));
  return isRecord(unit)
    ? stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message)
    : undefined;
}

function payloadAttemptStatus(payload: ToolPayload): 'repair-needed' | 'failed-with-reason' {
  return payloadHasRepairNeededStatus(payload) ? 'repair-needed' : 'failed-with-reason';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function writeCapabilityEvolutionEventBestEffort(
  input: Parameters<typeof recordCapabilityEvolutionRuntimeEvent>[0],
) {
  try {
    await recordCapabilityEvolutionRuntimeEvent(input);
  } catch {
    // Ledger capture is audit evidence; it must not turn a repair/fallback path into a harder failure.
  }
}

function stableAgentServerPayloadTaskId(
  kind: string,
  request: GatewayRequest,
  skill: SkillAvailability,
  runId: string | undefined,
) {
  return agentServerStablePayloadTaskId({
    kind,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    prompt: request.prompt,
    runId,
    shortHash: (value) => sha1(value).slice(0, 12),
  });
}

async function writeBackendPayloadLogs(
  workspace: string,
  refs: RuntimeRefBundle,
  stdout: string,
  stderr = '',
) {
  try {
    await Promise.all([
      mkdir(dirname(join(workspace, refs.stdoutRel)), { recursive: true }),
      mkdir(dirname(join(workspace, refs.stderrRel)), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(workspace, refs.stdoutRel), stdout),
      writeFile(join(workspace, refs.stderrRel), stderr),
    ]);
  } catch {
    // Stable output materialization is the contract; direct-payload logs are best effort.
  }
}

async function currentReferenceDigestRecoveryPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  workspace: string,
  failureReason: string,
): Promise<ToolPayload | undefined> {
  if (!currentReferenceDigestFailureCanRecover(failureReason)) return undefined;
  const candidates = currentReferenceDigestRecoveryCandidates(request.uiState?.currentReferenceDigests);
  if (!candidates.length) return undefined;
  const sources: CurrentReferenceDigestRecoverySource[] = [];
  for (const digest of candidates) {
    if (digest.inlineText) {
      sources.push({
        sourceRef: digest.sourceRef,
        digestRef: digest.digestRef,
        text: digest.inlineText,
      });
      continue;
    }
    if (digest.digestRef) {
      const abs = resolve(workspace, safeWorkspaceRel(digest.digestRef));
      try {
        const text = await readFile(abs, 'utf8');
        sources.push({
          sourceRef: digest.sourceRef,
          digestRef: digest.digestRef,
          text,
        });
      } catch {
        // A missing digest should not block other current references.
      }
    }
  }
  if (!sources.length) return undefined;
  return buildCurrentReferenceDigestRecoveryPayload({
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    failureReason,
    sources,
    uiManifest: reportRuntimeResultViewSlots(
      CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
      `${request.skillDomain}-runtime-result`,
    ),
    shortHash: (value) => sha1(value).slice(0, 8),
  }) as ToolPayload;
}

async function generatedTaskInterfaceContractReason(workspace: string, response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content === undefined) return undefined;
  const language = String(response.entrypoint.language || '').toLowerCase();
  return agentServerGeneratedTaskInterfaceContractReason({ entryRel, language, source: content });
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

async function tryAgentServerSupplementMissingArtifacts(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  baseUrl: string;
  workspace: string;
  payload: ToolPayload;
  primaryTaskId: string;
  primaryRunId?: string;
  primaryRun: WorkspaceTaskRunResult;
  primaryRefs: RuntimeRefBundle;
  expectedArtifactTypes?: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: GeneratedTaskRunnerDeps;
}) {
  const missingTypes = missingExpectedArtifactTypes(params.request, params.payload.artifacts, params.expectedArtifactTypes);
  if (!missingTypes.length) return undefined;
  const fallbackReason = `Missing expected artifact types: ${missingTypes.join(', ')}`;
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: AGENTSERVER_SUPPLEMENTAL_GENERATION_EVENT_TYPE,
    source: 'workspace-runtime',
    status: 'running',
    message: 'Requesting supplemental AgentServer/backend generation',
    detail: fallbackReason,
  });
  const existingTypes = uniqueStrings(params.payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const supplementRequest: GatewayRequest = {
    ...params.request,
    prompt: [
      params.request.prompt,
      '',
      `Supplement the previous local skill result. Missing expected artifact types: ${missingTypes.join(', ')}.`,
      'Write reproducible workspace code that emits all missing artifacts and preserves existing artifacts if useful.',
      `Existing artifact types: ${existingTypes.join(', ') || 'none'}.`,
    ].join('\n'),
    artifacts: params.payload.artifacts,
    expectedArtifactTypes: missingTypes,
  };
  const supplement = await runAgentServerGeneratedTask(
    supplementRequest,
    params.skill,
    params.skills,
    params.callbacks,
    params.deps,
    { allowSupplement: false },
  );
  if (!supplement) {
    await recordSupplementalFallbackLedger(params, {
      status: 'fallback-failed',
      fallbackReason,
      missingTypes,
      payload: params.payload,
      supplement,
      filled: [],
    });
    return undefined;
  }
  const supplementedTypes = new Set(supplement.artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const filled = missingTypes.filter((type) => supplementedTypes.has(type));
  if (!filled.length) {
    await recordSupplementalFallbackLedger(params, {
      status: 'fallback-failed',
      fallbackReason,
      missingTypes,
      payload: params.payload,
      supplement,
      filled,
    });
    return undefined;
  }
  const merged = mergeSupplementalPayload(params.payload, supplement, filled);
  await recordSupplementalFallbackLedger(params, {
    status: 'fallback-succeeded',
    fallbackReason,
    missingTypes,
    payload: merged,
    supplement,
    filled,
  });
  return merged;
}

async function recordSupplementalFallbackLedger(
  params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    workspace: string;
    payload: ToolPayload;
    primaryTaskId: string;
    primaryRunId?: string;
    primaryRun: WorkspaceTaskRunResult;
    primaryRefs: RuntimeRefBundle;
  },
  outcome: {
    status: 'fallback-succeeded' | 'fallback-failed';
    fallbackReason: string;
    missingTypes: string[];
    payload: ToolPayload;
    supplement?: ToolPayload;
    filled: string[];
  },
) {
  const fallbackSucceeded = outcome.status === 'fallback-succeeded';
  const supplementExecutionUnitRefs = executionUnitRefsFromPayload(outcome.supplement);
  const supplementArtifactRefs = artifactRefsFromPayload(outcome.supplement);
  const validationResult = {
    verdict: 'fail' as const,
    validatorId: 'sciforge.expected-artifact-contract',
    failureCode: 'missing-artifact',
    summary: outcome.fallbackReason,
    resultRef: params.primaryRefs.outputRel,
  };
  await writeCapabilityEvolutionEventBestEffort({
    workspacePath: params.workspace,
    request: params.request,
    skill: params.skill,
    taskId: params.primaryTaskId,
    runId: params.primaryRunId,
    run: params.primaryRun,
    payload: outcome.payload,
    taskRel: params.primaryRefs.taskRel,
    inputRel: `.sciforge/task-inputs/${params.primaryTaskId}.json`,
    outputRel: params.primaryRefs.outputRel,
    stdoutRel: params.primaryRefs.stdoutRel,
    stderrRel: params.primaryRefs.stderrRel,
    finalStatus: outcome.status,
    failureReason: fallbackSucceeded
      ? undefined
      : `Supplemental fallback did not fill missing artifact types: ${outcome.missingTypes.join(', ')}`,
    fallbackReason: outcome.fallbackReason,
    eventKind: 'composed-capability-fallback',
    validationResult,
    selectedCapabilities: [{
      id: `capability.composed.${params.request.skillDomain}.expected-artifacts`,
      kind: 'composed',
      providerId: params.skill.id,
      role: 'primary',
    }],
    fallbackCapabilities: [
      {
        id: 'runtime.python-task',
        kind: 'tool',
        providerId: 'sciforge.core.runtime.python-task',
        role: 'fallback',
      },
      {
        id: 'runtime.workspace-write',
        kind: 'action',
        providerId: 'sciforge.core.runtime.workspace-write',
        role: 'fallback',
      },
      {
        id: 'verifier.schema',
        kind: 'verifier',
        providerId: 'sciforge.core.verifier.schema',
        role: 'validator',
      },
    ],
    providers: [
      { id: 'sciforge.core.runtime.python-task', kind: 'local-runtime' },
      { id: 'sciforge.core.runtime.workspace-write', kind: 'local-runtime' },
      { id: 'sciforge.core.verifier.schema', kind: 'local-runtime' },
    ],
    inputSchemaRefs: [`capability-fallback:${params.request.skillDomain}:expected-artifacts`],
    outputSchemaRefs: outcome.missingTypes.map((type) => `artifact-schema:${type}`),
    recoverActions: fallbackSucceeded
      ? ['fallback-to-atomic', 'supplement-missing-artifacts', 'merge-supplemental-payload']
      : ['fallback-to-atomic', 'supplement-missing-artifacts', 'preserve-failure-evidence-refs'],
    atomicTrace: [{
      capabilityId: 'runtime.python-task',
      providerId: 'sciforge.core.runtime.python-task',
      status: fallbackSucceeded ? 'succeeded' : 'failed',
      failureCode: fallbackSucceeded ? undefined : 'missing-artifact',
      executionUnitRefs: supplementExecutionUnitRefs,
      artifactRefs: supplementArtifactRefs,
      validationResult: {
        verdict: fallbackSucceeded ? 'pass' : 'fail',
        validatorId: 'sciforge.expected-artifact-contract',
        failureCode: fallbackSucceeded ? undefined : 'missing-artifact',
        summary: fallbackSucceeded
          ? `Supplemental fallback filled artifact types: ${outcome.filled.join(', ')}`
          : `Supplemental fallback did not fill artifact types: ${outcome.missingTypes.join(', ')}`,
        resultRef: params.primaryRefs.outputRel,
      },
    }],
  });
}

function missingExpectedArtifactTypes(request: GatewayRequest, artifacts: Array<Record<string, unknown>>, expectedArtifactTypes?: string[]) {
  const present = new Set(artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const expected = expectedArtifactTypes?.length ? expectedArtifactTypes : expectedArtifactTypesForRequest(request);
  return uniqueStrings(expected).filter((type) => !present.has(type));
}

function executionUnitRefsFromPayload(payload: ToolPayload | undefined) {
  return uniqueStrings((payload?.executionUnits ?? []).flatMap((unit) => {
    const id = isRecord(unit) && typeof unit.id === 'string' ? unit.id : '';
    return id ? [`execution-unit:${id}`] : [];
  }));
}

function artifactRefsFromPayload(payload: ToolPayload | undefined) {
  return uniqueStrings((payload?.artifacts ?? []).flatMap((artifact) => {
    const id = isRecord(artifact) && typeof artifact.id === 'string' ? artifact.id : '';
    return id ? [`artifact:${id}`] : [];
  }));
}

function expectedArtifactTypesForGeneratedRun(request: GatewayRequest, generatedExpectedArtifacts?: string[]) {
  const generated = uniqueStrings((generatedExpectedArtifacts ?? []).map((type) => type.trim()).filter(Boolean));
  return uniqueStrings([...expectedArtifactTypesForRequest(request), ...generated]);
}

function supplementScopeForGeneratedRun(request: GatewayRequest, generatedExpectedArtifacts?: string[]) {
  const generated = uniqueStrings((generatedExpectedArtifacts ?? []).map((type) => type.trim()).filter(Boolean));
  return generated.length ? generated : expectedArtifactTypesForRequest(request);
}

function mergeSupplementalPayload(base: ToolPayload, supplement: ToolPayload, filledTypes: string[]): ToolPayload {
  const seenArtifacts = new Set<string>();
  const artifacts = [...base.artifacts, ...supplement.artifacts].filter((artifact) => {
    const key = [
      String(artifact.type || artifact.id || ''),
      String(artifact.id || ''),
      String(artifact.dataRef || ''),
      isRecord(artifact.metadata) ? String(artifact.metadata.artifactRef || artifact.metadata.outputRef || '') : '',
    ].join('|');
    if (seenArtifacts.has(key)) return false;
    seenArtifacts.add(key);
    return true;
  });
  const uiManifest = [...base.uiManifest, ...supplement.uiManifest].filter((slot, index, all) => {
    const key = `${String(slot.componentId || '')}:${String(slot.artifactRef || '')}`;
    return all.findIndex((candidate) => `${String(candidate.componentId || '')}:${String(candidate.artifactRef || '')}` === key) === index;
  });
  return {
    ...base,
    message: `${base.message}\n\nSupplemented missing artifacts: ${filledTypes.join(', ')}.`,
    reasoningTrace: [
      base.reasoningTrace,
      `Supplemental AgentServer/backend generation filled: ${filledTypes.join(', ')}`,
      supplement.reasoningTrace,
    ].filter(Boolean).join('\n'),
    claims: [...base.claims, ...supplement.claims],
    uiManifest,
    executionUnits: [...base.executionUnits, ...supplement.executionUnits],
    artifacts,
    logs: [...(base.logs ?? []), ...(supplement.logs ?? [])],
  };
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
}

async function readGeneratedTaskFileIfPresent(workspace: string, path: string) {
  try {
    return await readFile(join(workspace, safeWorkspaceRel(path)), 'utf8');
  } catch {
    return undefined;
  }
}

export async function missingGeneratedTaskFileContents(
  workspace: string,
  taskFiles: AgentServerGenerationResponse['taskFiles'],
) {
  const missing: string[] = [];
  for (const file of taskFiles) {
    if (file.content) continue;
    const existing = await readGeneratedTaskFileIfPresent(workspace, file.path);
    if (existing === undefined) missing.push(safeWorkspaceRel(file.path));
  }
  return missing;
}
