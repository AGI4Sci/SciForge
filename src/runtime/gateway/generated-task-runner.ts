import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from '../skill-promotion.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { errorMessage, generatedTaskArchiveRel, isRecord, isTaskInputRel, safeWorkspaceRel } from '../gateway-utils.js';
import { sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { materializeBackendPayloadOutput, type RuntimeRefBundle } from './artifact-materializer.js';
import {
  appendGeneratedTaskDirectPayloadAttemptLifecycle,
  appendGeneratedTaskGenerationFailureLifecycle,
  appendGeneratedTaskAttemptLifecycle,
  assessGeneratedTaskDirectPayloadLifecycle,
  assessGeneratedTaskValidationLifecycle,
  buildGeneratedTaskRunInputLifecycle,
  recordGeneratedTaskSuccessLedgerLifecycle,
  runGeneratedTaskParseRepairLifecycle,
  runGeneratedTaskPreOutputRepairLifecycle,
  runGeneratedTaskRepairAttemptLifecycle,
} from './generated-task-runner-validation-lifecycle.js';
import {
  expectedArtifactTypesForGeneratedRun,
  supplementScopeForGeneratedRun,
  tryAgentServerSupplementMissingArtifacts,
} from './generated-task-runner-supplement-lifecycle.js';
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
    await appendGeneratedTaskGenerationFailureLifecycle({
      workspacePath: workspace,
      request,
      skill,
      failedRequestId,
      failureReason,
      diagnostics: generation.diagnostics,
      attemptPlanRefs,
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
    const lifecycle = assessGeneratedTaskDirectPayloadLifecycle({
      payload: normalized,
      request,
      firstPayloadFailureReason,
      payloadHasFailureStatus,
    });
    await appendGeneratedTaskDirectPayloadAttemptLifecycle({
      workspacePath: workspace,
      request,
      skill,
      runId: directGeneration.runId,
      refs: directRefs,
      lifecycle,
      attemptPlanRefs,
    });
    if (lifecycle.guardFailureReason) {
      return repairNeededPayload(request, skill, lifecycle.guardFailureReason);
    }
    if (lifecycle.payloadFailureStatus) return normalized;
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
  const inputRel = `.sciforge/task-inputs/${taskId}.json`;
  const outputRel = `.sciforge/task-results/${taskId}.json`;
  const stdoutRel = `.sciforge/logs/${taskId}.stdout.log`;
  const stderrRel = `.sciforge/logs/${taskId}.stderr.log`;
  const generatedExpectedArtifacts = expectedArtifactTypesForGeneratedRun(request, generation.response.expectedArtifacts);
  const generatedSupplementScope = supplementScopeForGeneratedRun(request, generation.response.expectedArtifacts);
  const taskInputLifecycle = await buildGeneratedTaskRunInputLifecycle({
    workspacePath: workspace,
    request,
    skill,
    generatedInputRels,
    expectedArtifacts: generatedExpectedArtifacts,
  });
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: generation.response.entrypoint.language,
    entrypoint: generation.response.entrypoint.command || 'main',
    entrypointArgs: generation.response.entrypoint.args,
    taskRel,
    input: taskInputLifecycle.taskInput,
    retentionProtectedInputRels: taskInputLifecycle.retentionProtectedInputRels,
    outputRel,
    stdoutRel,
    stderrRel,
  });

  if (run.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    const repair = await runGeneratedTaskPreOutputRepairLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      taskRel,
      inputRel,
      outputRel,
      stdoutRel,
      stderrRel,
      attemptPlanRefs,
      callbacks,
      tryAgentServerRepairAndRerun,
    });
    if (repair.repaired) {
      return repair.repaired;
    }
    return failedTaskPayload(request, skill, run, repair.failureReason);
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
    const lifecycle = assessGeneratedTaskValidationLifecycle({
      payload,
      normalized,
      schemaErrors: errors,
      run,
      request,
      firstPayloadFailureReason,
      payloadHasFailureStatus,
    });
    if (lifecycle.repair) {
      const repaired = await runGeneratedTaskRepairAttemptLifecycle({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        runId: generation.runId,
        run,
        payload: normalized ?? payload,
        taskRel,
        inputRel,
        outputRel,
        stdoutRel,
        stderrRel,
        attemptPlanRefs,
        attemptStatus: lifecycle.attemptStatus,
        attemptSchemaErrors: errors,
        workEvidenceSummary: lifecycle.workEvidenceSummary,
        attemptFailureReason: lifecycle.attemptFailureReason,
        schemaErrors: errors,
        failureReason: lifecycle.repair.failureReason,
        recoverActions: lifecycle.repair.recoverActions,
        callbacks,
        tryAgentServerRepairAndRerun,
      });
      if (repaired) {
        return repaired;
      }
      if (lifecycle.normalizedRepairNeeded && normalized) return normalized;
      return repairNeededPayload(request, skill, lifecycle.repair.failureReason);
    }
    await appendGeneratedTaskAttemptLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      run,
      attemptPlanRefs,
      status: lifecycle.attemptStatus,
      taskRel,
      inputRel,
      outputRel,
      stdoutRel,
      stderrRel,
      schemaErrors: errors,
      workEvidenceSummary: lifecycle.workEvidenceSummary,
      failureReason: lifecycle.attemptFailureReason,
    });
    if (!normalized) {
      return repairNeededPayload(request, skill, 'AgentServer generated task output could not be normalized after schema validation.');
    }
    if (options.allowSupplement !== false) {
      const supplemented = await tryAgentServerSupplementMissingArtifacts({
        request,
        skill,
        skills,
        workspace,
        payload: normalized,
        primaryTaskId: taskId,
        primaryRunId: generation.runId,
        primaryRun: run,
        primaryRefs: { taskRel, outputRel, stdoutRel, stderrRel },
        expectedArtifactTypes: generatedSupplementScope,
        callbacks,
        deps,
        runGeneratedTask: runAgentServerGeneratedTask,
      });
      if (supplemented) return await materializeBackendPayloadOutput(workspace, request, supplemented, { taskRel, outputRel, stdoutRel, stderrRel });
    }
    if (lifecycle.normalizedFailureStatus) return normalized;
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      taskRel,
      inputRef: inputRel,
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
    await recordGeneratedTaskSuccessLedgerLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      payload: completed,
      refs: { taskRel, inputRel, outputRel, stdoutRel, stderrRel },
    });
    return await materializeBackendPayloadOutput(workspace, request, completed, { taskRel, outputRel, stdoutRel, stderrRel });
  } catch (error) {
    const repair = await runGeneratedTaskParseRepairLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      taskRel,
      inputRel,
      outputRel,
      stdoutRel,
      stderrRel,
      attemptPlanRefs,
      error,
      callbacks,
      tryAgentServerRepairAndRerun,
    });
    if (repair.repaired) {
      return repair.repaired;
    }
    return failedTaskPayload(request, skill, run, repair.failureReason);
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
