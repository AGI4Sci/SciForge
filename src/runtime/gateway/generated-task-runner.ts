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
        type: 'agentserver-digest-recovery',
        source: 'workspace-runtime',
        status: 'self-healed',
        message: 'AgentServer did not converge, so SciForge recovered from bounded current-reference digests.',
        detail: 'The recovery output keeps the same user-visible contract: report artifact, object references, and execution audit.',
      });
      return await validateAndNormalizePayload(digestRecovery, request, skill, {
        taskRel: 'agentserver://current-reference-digest-recovery',
        outputRel: `agentserver://current-reference-digest-recovery/${sha1(request.prompt).slice(0, 8)}/output`,
        stdoutRel: `agentserver://current-reference-digest-recovery/${sha1(request.prompt).slice(0, 8)}/stdout`,
        stderrRel: `agentserver://current-reference-digest-recovery/${sha1(request.prompt).slice(0, 8)}/stderr`,
        runtimeFingerprint: { runtime: 'SciForge current-reference digest recovery', error: generation.error },
      });
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
    const directPayload = await mergeReusableContextArtifactsForDirectPayload(
      ensureDirectAnswerReportArtifact(
        directGeneration.directPayload,
        request,
        'agentserver-direct-payload',
      ),
      request,
    );
    const normalized = await validateAndNormalizePayload(directPayload, request, skill, {
      taskRel: 'agentserver://direct-payload',
      outputRel: `agentserver://${directGeneration.runId || 'unknown'}/output`,
      stdoutRel: `agentserver://${directGeneration.runId || 'unknown'}/stdout`,
      stderrRel: `agentserver://${directGeneration.runId || 'unknown'}/stderr`,
      runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: directGeneration.runId },
    });
    const evidenceFinding = evaluateToolPayloadEvidence(normalized, request);
    const guidanceFinding = evaluateGuidanceAdoption(normalized, request);
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized);
    const payloadFailureReason = firstPayloadFailureReason(normalized);
    const payloadFailureStatus = payloadHasFailureStatus(normalized);
    const failureReason = payloadFailureReason ?? (!payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined);
    const attemptStatus = guidanceFinding
      ? guidanceFinding.severity
      : evidenceFinding
        ? evidenceFinding.severity
      : payloadFailureStatus
        ? 'failed-with-reason'
        : 'done';
    await appendTaskAttempt(workspace, {
      id: `agentserver-direct-${skill.id}-${sha1(`${request.prompt}:${directGeneration.runId || 'unknown'}`).slice(0, 12)}`,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: attemptStatus,
      codeRef: 'agentserver://direct-payload',
      outputRef: `agentserver://${directGeneration.runId || 'unknown'}/output`,
      stdoutRef: `agentserver://${directGeneration.runId || 'unknown'}/stdout`,
      stderrRef: `agentserver://${directGeneration.runId || 'unknown'}/stderr`,
      workEvidenceSummary,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    if (guidanceFinding || evidenceFinding) {
      return repairNeededPayload(request, skill, guidanceFinding?.reason ?? evidenceFinding?.reason ?? 'AgentServer payload failed runtime guard.');
    }
    return {
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
  }

  const nonExecutableEntrypointReason = generatedEntrypointContractReason(generation.response);
  if (nonExecutableEntrypointReason) {
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'agentserver-generation-retry',
      source: 'workspace-runtime',
      status: 'running',
      message: nonExecutableEntrypointReason,
      detail: 'Retrying AgentServer generation once; entrypoint must be executable code, while reports/data must be emitted as artifacts or direct ToolPayload content.',
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
      const directPayload = await mergeReusableContextArtifactsForDirectPayload(
        ensureDirectAnswerReportArtifact(retriedGeneration.directPayload, request, 'agentserver-direct-payload'),
        request,
      );
      return await validateAndNormalizePayload(directPayload, request, skill, {
        taskRel: 'agentserver://direct-payload',
        outputRel: `agentserver://${retriedGeneration.runId || 'unknown'}/output`,
        stdoutRel: `agentserver://${retriedGeneration.runId || 'unknown'}/stdout`,
        stderrRel: `agentserver://${retriedGeneration.runId || 'unknown'}/stderr`,
        runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: retriedGeneration.runId },
      });
    }
    generation = retriedGeneration;
    const retryReason = generatedEntrypointContractReason(generation.response);
    if (retryReason) {
      return repairNeededPayload(request, skill, `AgentServer generation contract violation: ${nonExecutableEntrypointReason}. Strict retry still returned invalid entrypoint: ${retryReason}`);
    }
  }

  const missingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(workspace, generation.response.taskFiles);
  if (missingPathOnlyTaskFiles.length) {
    const reason = `AgentServer returned path-only taskFiles that were not present in the workspace and had no inline content: ${missingPathOnlyTaskFiles.join(', ')}`;
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'agentserver-generation-retry',
      source: 'workspace-runtime',
      status: 'running',
      message: reason,
      detail: 'Retrying AgentServer generation once; taskFiles must include inline content or be physically written before returning.',
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
        `${reason}. Strict retry returned a direct ToolPayload instead of executable taskFiles.`,
      );
    }
    generation = retriedGeneration;
    const stillMissingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(workspace, generation.response.taskFiles);
    if (stillMissingPathOnlyTaskFiles.length) {
      const contractReason = [
        reason,
        `Strict retry still returned path-only taskFiles without inline content or workspace files: ${stillMissingPathOnlyTaskFiles.join(', ')}`,
      ].join('. ');
      return repairNeededPayload(request, skill, `AgentServer generation contract violation: ${contractReason}`);
    }
  }

  const taskInterfaceReason = await generatedTaskInterfaceContractReason(workspace, generation.response);
  if (taskInterfaceReason) {
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'agentserver-generation-retry',
      source: 'workspace-runtime',
      status: 'running',
      message: taskInterfaceReason,
      detail: 'Retrying AgentServer generation once; generated tasks must consume the SciForge task input and write the declared output payload, not bake the current answer into static code.',
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
      const directPayload = await mergeReusableContextArtifactsForDirectPayload(
        ensureDirectAnswerReportArtifact(retriedGeneration.directPayload, request, 'agentserver-direct-payload'),
        request,
      );
      return await validateAndNormalizePayload(directPayload, request, skill, {
        taskRel: 'agentserver://direct-payload',
        outputRel: `agentserver://${retriedGeneration.runId || 'unknown'}/output`,
        stdoutRel: `agentserver://${retriedGeneration.runId || 'unknown'}/stdout`,
        stderrRel: `agentserver://${retriedGeneration.runId || 'unknown'}/stderr`,
        runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: retriedGeneration.runId },
      });
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
        type: 'workspace-task-materialized',
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
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const payload = coerceWorkspaceTaskPayload(rawPayload) ?? rawPayload;
    const errors = schemaErrors(payload);
    const normalized = errors.length ? undefined : await validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    const evidenceFinding = normalized ? evaluateToolPayloadEvidence(normalized, request) : undefined;
    const guidanceFinding = normalized ? evaluateGuidanceAdoption(normalized, request) : undefined;
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized ?? payload);
    const payloadFailureReason = firstPayloadFailureReason(payload, run);
    const payloadFailureStatus = payloadHasFailureStatus(payload);
    const evidenceFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
    const failureReason = payloadFailureReason ?? evidenceFailureReason;
    const shouldRepairExecutionFailure = errors.length === 0 && Boolean(failureReason)
      && (run.exitCode !== 0 || Boolean(evidenceFailureReason));
    const attemptStatus = errors.length
      ? 'repair-needed'
      : shouldRepairExecutionFailure
        ? guidanceFinding?.severity ?? evidenceFinding?.severity ?? 'repair-needed'
        : payloadFailureStatus
          ? 'failed-with-reason'
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
        : evidenceFailureReason ?? `AgentServer generated task exited ${run.exitCode} with failed payload: ${failureReason}`;
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
      if (repaired) return repaired;
      return repairNeededPayload(request, skill, repairFailureReason);
    }
    if (!normalized) {
      return repairNeededPayload(request, skill, 'AgentServer generated task output could not be normalized after schema validation.');
    }
    if (options.allowSupplement !== false) {
      const supplemented = await tryAgentServerSupplementMissingArtifacts({
        request,
        skill,
        skills,
        baseUrl,
        workspace,
        payload: normalized,
        expectedArtifactTypes: generatedSupplementScope,
        callbacks,
        deps,
      });
      if (supplemented) return supplemented;
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
    return {
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
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }
}

async function currentReferenceDigestRecoveryPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  workspace: string,
  failureReason: string,
): Promise<ToolPayload | undefined> {
  if (!/convergence guard|silent stream guard|context window|token/i.test(failureReason)) return undefined;
  const digests = toRecordList(request.uiState?.currentReferenceDigests)
    .filter((entry) => /^(ok|ready)$/i.test(String(entry.status || '')));
  if (!digests.length) return undefined;
  const sources: Array<{ sourceRef: string; digestRef: string; text: string }> = [];
  for (const digest of digests.slice(0, 6)) {
    const digestRef = typeof digest.digestRef === 'string'
      ? digest.digestRef.replace(/^file:/, '')
      : typeof digest.clickableRef === 'string'
        ? digest.clickableRef.replace(/^file:/, '')
        : typeof digest.path === 'string'
          ? digest.path
          : '';
    const inlineText = typeof digest.digestText === 'string' ? digest.digestText : '';
    if (inlineText.trim()) {
      sources.push({
        sourceRef: String(digest.sourceRef || digestRef || digest.id || 'current-reference'),
        digestRef: digestRef || String(digest.clickableRef || digest.sourceRef || digest.id || 'current-reference'),
        text: inlineText,
      });
      continue;
    }
    if (digestRef) {
      const abs = resolve(workspace, safeWorkspaceRel(digestRef));
      try {
        const text = await readFile(abs, 'utf8');
        sources.push({
          sourceRef: String(digest.sourceRef || digestRef),
          digestRef,
          text,
        });
      } catch {
        // A missing digest should not block other current references.
      }
    }
  }
  if (!sources.length) return undefined;
  const markdown = buildDigestRecoveryMarkdown(request, sources, failureReason);
  const reportId = 'research-report';
  const digestRefs = sources.flatMap((source) => [
    { id: `source-${sha1(source.sourceRef).slice(0, 8)}`, kind: 'file', title: source.sourceRef.split('/').pop() || source.sourceRef, ref: `file:${source.sourceRef}` },
    { id: `digest-${sha1(source.digestRef).slice(0, 8)}`, kind: 'file', title: source.digestRef.split('/').pop() || source.digestRef, ref: `file:${source.digestRef}` },
  ]);
  return {
    message: firstParagraph(markdown) || '已根据本轮引用摘要生成恢复性结果。',
    confidence: 0.68,
    claimType: 'current-reference-digest-recovery',
    evidenceLevel: 'bounded-current-reference-digest',
    reasoningTrace: [
      'AgentServer generation was stopped by convergence guard.',
      'SciForge recovered from bounded current-reference digests instead of replaying full files into the backend context.',
      `Failure reason: ${failureReason}`,
    ].join('\n'),
    claims: [{
      text: firstParagraph(markdown) || 'Current-reference digest recovery produced a report from bounded workspace refs.',
      type: 'inference',
      confidence: 0.68,
      evidenceLevel: 'bounded-current-reference-digest',
      supportingRefs: sources.map((source) => `file:${source.sourceRef}`),
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: reportId, priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: `${request.skillDomain}-runtime-result`, priority: 2 },
    ],
    executionUnits: [{
      id: `current-reference-digest-recovery-${sha1(markdown).slice(0, 8)}`,
      status: 'self-healed',
      tool: 'sciforge.current-reference-digest-recovery',
      params: JSON.stringify({
        skillId: skill.id,
        sourceRefs: sources.map((source) => source.sourceRef),
        digestRefs: sources.map((source) => source.digestRef),
      }),
      stdoutRef: sources[0] ? `file:${sources[0].digestRef}` : undefined,
    }],
    artifacts: [{
      id: reportId,
      type: 'research-report',
      producerScenario: request.skillDomain,
      producer: 'sciforge.current-reference-digest-recovery',
      schemaVersion: '1',
      metadata: {
        source: 'current-reference-digest-recovery',
        markdownRef: sources.find((source) => /\.(md|markdown)$/i.test(source.sourceRef))?.sourceRef,
        sourceRefs: sources.map((source) => source.sourceRef),
        digestRefs: sources.map((source) => source.digestRef),
        failureReason,
      },
      data: {
        markdown,
        sections: markdownSections(markdown),
      },
    }],
    objectReferences: digestRefs,
  };
}

function buildDigestRecoveryMarkdown(
  request: GatewayRequest,
  sources: Array<{ sourceRef: string; digestRef: string; text: string }>,
  failureReason: string,
) {
  const combined = sources.map((source) => `# Source: ${source.sourceRef}\n\n${source.text}`).join('\n\n');
  const executive = extractSection(combined, ['Executive Summary', '摘要', 'Summary']) || firstUsefulLines(combined, 8);
  const stats = extractSection(combined, ['Key Statistics', 'Statistics', '统计']) || summarizeJsonLikeSources(sources);
  const topics = extractTopicSections(combined);
  const opportunities = extractSection(combined, ['Opportunities', '机会', 'Future Directions', 'Research Opportunities']) || inferOpportunities(topics);
  const risks = extractSection(combined, ['Risks', 'Limitations', '风险', '局限']) || inferRisks(topics);
  const refs = sources.map((source) => `- \`${source.sourceRef}\`（digest: \`${source.digestRef}\`）`).join('\n');
  return [
    '# Current Reference Digest Recovery Report',
    '',
    `用户问题：${request.prompt}`,
    '',
    '## 摘要',
    executive,
    '',
    '## 关键统计',
    stats,
    '',
    '## 方向聚类',
    topics.length ? topics.map((topic) => `### ${topic.title}\n${topic.body}`).join('\n\n') : firstUsefulLines(combined, 12),
    '',
    '## 机会',
    opportunities,
    '',
    '## 风险',
    risks,
    '',
    '## 可审计引用',
    refs,
    '',
    '## 恢复说明',
    `AgentServer 未能在收敛阈值内完成（${failureReason}）。本报告使用本轮显式引用的 bounded digest 生成，避免重复全量读取大文件。`,
  ].join('\n');
}

function extractSection(text: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?:^|\\n)#{1,3}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,3}\\s|\\n# Source:|$)`, 'i'));
    if (match?.[1]?.trim()) return clipLines(match[1], 18);
  }
  return '';
}

function extractTopicSections(text: string) {
  const topics: Array<{ title: string; body: string }> = [];
  const pattern = /(?:^|\n)##\s+Topic:\s*([^\n]+)\n([\s\S]*?)(?=\n##\s+Topic:|\n##\s+[A-Z\u4e00-\u9fff]|$)/g;
  for (const match of text.matchAll(pattern)) {
    const title = match[1]?.trim();
    const body = clipLines(match[2] || '', 10);
    if (title && body) topics.push({ title, body });
  }
  return topics.slice(0, 10);
}

function summarizeJsonLikeSources(sources: Array<{ sourceRef: string; text: string }>) {
  const lines: string[] = [];
  for (const source of sources) {
    if (!/\.json$/i.test(source.sourceRef)) continue;
    try {
      const parsed = JSON.parse(source.text);
      const content = isRecord(parsed) && Array.isArray(parsed.content) ? parsed.content : Array.isArray(parsed) ? parsed : undefined;
      if (content) lines.push(`- \`${source.sourceRef}\`: ${content.length} 条记录。`);
    } catch {
      // Digest text may be clipped or normalized; ignore parse failures.
    }
  }
  return lines.join('\n') || '未发现结构化统计字段；请查看下方可审计引用。';
}

function inferOpportunities(topics: Array<{ title: string }>) {
  if (!topics.length) return '可优先围绕高频方向做复现基准、工具链集成、可靠性评估和跨任务迁移验证。';
  return topics.slice(0, 6).map((topic) => `- ${topic.title}: 适合继续追踪可复现 benchmark、真实用户工作流和与现有工具链的集成机会。`).join('\n');
}

function inferRisks(topics: Array<{ title: string }>) {
  if (!topics.length) return '主要风险包括评估不充分、上下文成本过高、工具调用不可复现、以及结论依赖未验证来源。';
  return topics.slice(0, 6).map((topic) => `- ${topic.title}: 需关注评估外推、数据污染、工具调用失败和安全/可靠性边界。`).join('\n');
}

function markdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string }> = [];
  const parts = markdown.split(/\n##\s+/);
  for (const part of parts.slice(1)) {
    const [titleLine, ...rest] = part.split('\n');
    const title = titleLine.trim();
    const content = rest.join('\n').trim();
    if (title && content) sections.push({ title, content });
  }
  return sections;
}

function firstParagraph(text: string) {
  return text.split(/\n{2,}/).map((part) => part.replace(/^#+\s*/, '').trim()).find((part) => part && !part.startsWith('用户问题'))?.slice(0, 400);
}

function firstUsefulLines(text: string, count: number) {
  return clipLines(text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('{') && !line.startsWith('}') && !line.startsWith('"'))
    .slice(0, count)
    .join('\n'), count);
}

function clipLines(text: string, maxLines: number) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  return lines.slice(0, maxLines).join('\n').slice(0, 3600);
}

function generatedEntrypointContractReason(response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const ext = extname(entryRel).toLowerCase();
  const language = String(response.entrypoint.language || '').toLowerCase();
  const executableExts = new Set(['.py', '.r', '.R', '.sh', '.bash', '.zsh']);
  const artifactExts = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.pdf', '.png', '.jpg', '.jpeg', '.html']);
  if (artifactExts.has(ext) && !executableExts.has(ext)) {
    return `AgentServer returned a non-executable artifact/report as entrypoint: ${entryRel}. Return a direct ToolPayload for report-only answers, or use an executable task file that writes the report artifact.`;
  }
  if ((language === 'python' || !language) && ext && !['.py'].includes(ext)) {
    return `AgentServer entrypoint language/path mismatch: language=${language || 'python'} path=${entryRel}.`;
  }
  if (['.js', '.mjs', '.ts'].includes(ext) && language !== 'cli') {
    return `AgentServer entrypoint ${entryRel} uses ${ext}, but SciForge generated task runner supports python/r/shell paths or explicit cli commands.`;
  }
  const entryFile = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel);
  if (entryFile && artifactExts.has(ext) && !/^(python|r|shell|cli)$/i.test(String(entryFile.language || ''))) {
    return `AgentServer taskFiles marks artifact-like entrypoint ${entryRel} as ${entryFile.language || 'unknown'} instead of executable code.`;
  }
  return undefined;
}

async function generatedTaskInterfaceContractReason(workspace: string, response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content === undefined) return undefined;
  const language = String(response.entrypoint.language || '').toLowerCase();
  const ext = extname(entryRel).toLowerCase();
  const source = content.slice(0, 240_000);
  const readsInput = taskSourceReadsInputArg(source, language, ext);
  const writesOutput = taskSourceWritesOutputArg(source, language, ext);
  if (!readsInput || !writesOutput) {
    const missing = [
      readsInput ? '' : 'read the SciForge inputPath argument',
      writesOutput ? '' : 'write the SciForge outputPath argument',
    ].filter(Boolean).join(' and ');
    return [
      `AgentServer generated task ${entryRel} does not ${missing}.`,
      'Generated workspace tasks must be reusable adapters that read request/current-reference data from argv inputPath and write a valid ToolPayload to argv outputPath.',
      'For report-only answers already reasoned by AgentServer, return a direct ToolPayload instead of static code that embeds the current report.',
    ].join(' ');
  }
  return undefined;
}

function taskSourceReadsInputArg(source: string, language: string, ext: string) {
  if (language === 'python' || ext === '.py') return /\bsys\.argv\b|argparse|click\.|typer\.|input[_-]?path/i.test(source);
  if (['javascript', 'typescript', 'node'].includes(language) || ['.js', '.mjs', '.ts'].includes(ext)) return /\bprocess\.argv\b|parseArgs|input[_-]?path/i.test(source);
  if (['shell', 'bash', 'zsh', 'sh'].includes(language) || ['.sh', '.bash', '.zsh'].includes(ext)) return /(^|[^\\])\$\{?1\}?|\binput[_-]?path\b/i.test(source);
  if (language === 'r' || ['.r', '.R'].includes(ext)) return /commandArgs|input[_-]?path/i.test(source);
  return /argv|args|input[_-]?path/i.test(source);
}

function taskSourceWritesOutputArg(source: string, language: string, ext: string) {
  if (language === 'python' || ext === '.py') return /\bsys\.argv\b|argparse|click\.|typer\.|output[_-]?path/i.test(source);
  if (['javascript', 'typescript', 'node'].includes(language) || ['.js', '.mjs', '.ts'].includes(ext)) return /\bprocess\.argv\b|parseArgs|output[_-]?path/i.test(source);
  if (['shell', 'bash', 'zsh', 'sh'].includes(language) || ['.sh', '.bash', '.zsh'].includes(ext)) return /(^|[^\\])\$\{?2\}?|\boutput[_-]?path\b/i.test(source);
  if (language === 'r' || ['.r', '.R'].includes(ext)) return /commandArgs|output[_-]?path/i.test(source);
  return /argv|args|output[_-]?path/i.test(source);
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
  expectedArtifactTypes?: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: GeneratedTaskRunnerDeps;
}) {
  const missingTypes = missingExpectedArtifactTypes(params.request, params.payload.artifacts, params.expectedArtifactTypes);
  if (!missingTypes.length) return undefined;
  emitWorkspaceRuntimeEvent(params.callbacks, {
    type: 'workspace-task-start',
    source: 'workspace-runtime',
    status: 'running',
    message: 'Requesting supplemental AgentServer/backend generation',
    detail: `Missing expected artifact types: ${missingTypes.join(', ')}`,
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
  if (!supplement) return undefined;
  const supplementedTypes = new Set(supplement.artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const filled = missingTypes.filter((type) => supplementedTypes.has(type));
  if (!filled.length) return undefined;
  return mergeSupplementalPayload(params.payload, supplement, filled);
}

function missingExpectedArtifactTypes(request: GatewayRequest, artifacts: Array<Record<string, unknown>>, expectedArtifactTypes?: string[]) {
  const present = new Set(artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  const expected = expectedArtifactTypes?.length ? expectedArtifactTypes : expectedArtifactTypesForRequest(request);
  return uniqueStrings(expected).filter((type) => !present.has(type));
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
