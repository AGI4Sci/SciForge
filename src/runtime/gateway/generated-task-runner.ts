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
    const normalized = await validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    const failureReason = firstPayloadFailureReason(payload, run);
    const shouldRepairExecutionFailure = errors.length === 0 && run.exitCode !== 0 && Boolean(failureReason);
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: errors.length || shouldRepairExecutionFailure ? 'repair-needed' : payloadHasFailureStatus(payload) ? 'failed-with-reason' : 'done',
      codeRef: taskRel,
      inputRef: `.sciforge/task-inputs/${taskId}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      schemaErrors: errors,
      failureReason: errors.length ? `AgentServer generated task output failed schema validation: ${errors.join('; ')}` : failureReason,
      createdAt: new Date().toISOString(),
    });
    if (errors.length || shouldRepairExecutionFailure) {
      const repairFailureReason = errors.length
        ? `AgentServer generated task output failed schema validation: ${errors.join('; ')}`
        : `AgentServer generated task exited ${run.exitCode} with failed payload: ${failureReason}`;
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

function generatedEntrypointContractReason(response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const ext = extname(entryRel).toLowerCase();
  const language = String(response.entrypoint.language || '').toLowerCase();
  const executableExts = new Set(['.py', '.r', '.R', '.sh', '.bash', '.zsh', '.js', '.mjs', '.ts']);
  const artifactExts = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.pdf', '.png', '.jpg', '.jpeg', '.html']);
  if (artifactExts.has(ext) && !executableExts.has(ext)) {
    return `AgentServer returned a non-executable artifact/report as entrypoint: ${entryRel}. Return a direct ToolPayload for report-only answers, or use an executable task file that writes the report artifact.`;
  }
  if ((language === 'python' || !language) && ext && !['.py'].includes(ext)) {
    return `AgentServer entrypoint language/path mismatch: language=${language || 'python'} path=${entryRel}.`;
  }
  const entryFile = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel);
  if (entryFile && artifactExts.has(ext) && !/^(python|r|shell|cli|javascript|typescript)$/i.test(String(entryFile.language || ''))) {
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
