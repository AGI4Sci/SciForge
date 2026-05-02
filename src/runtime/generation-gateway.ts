import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { agentServerGenerationSkill, loadSkillRegistry } from './skill-registry.js';
import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { AgentBackendAdapter, AgentBackendCapabilities, AgentServerGenerationResponse, BackendContextCompactionResult, BackendContextWindowState, BioAgentSkillDomain, GatewayRequest, LlmEndpointConfig, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeContextBudget, WorkspaceRuntimeContextWindowSource, WorkspaceRuntimeEvent, WorkspaceTaskRunResult } from './runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from './workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';
import { emitWorkspaceRuntimeEvent, throwIfRuntimeAborted } from './workspace-runtime-events.js';
import { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
import { cleanUrl, clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, generatedTaskArchiveRel, hashJson, headForAgentServer, isRecord, isTaskInputRel, readTextIfExists, safeWorkspaceRel, summarizeTextChange, tailForAgentServer, toRecordList, toStringList, uniqueStrings } from './gateway-utils.js';
import { normalizeBackendHandoff } from './workspace-task-input.js';

const SKILL_DOMAIN_SET = new Set<BioAgentSkillDomain>(['literature', 'structure', 'omics', 'knowledge']);
const AGENT_BACKEND_ANSWER_PRINCIPLE = [
  'All normal user-visible answers must be reasoned by the agent backend.',
  'BioAgent must not use preset reply templates for user requests; local code may only provide protocol validation, execution recovery, safety-boundary diagnostics, and artifact display.',
].join(' ');

type AgentServerContextMode = 'full' | 'delta';

type AgentServerBackendFailureKind =
  | 'context-window'
  | 'http-429'
  | 'rate-limit'
  | 'retry-budget'
  | 'too-many-failed-attempts';

interface AgentServerBackendFailureDiagnostic {
  kind: AgentServerBackendFailureKind;
  categories: AgentServerBackendFailureKind[];
  backend?: string;
  provider?: string;
  model?: string;
  httpStatus?: number;
  retryAfterMs?: number;
  resetAt?: string;
  message: string;
}

interface AgentServerGenerationRetryAudit {
  schemaVersion: 'bioagent.agentserver-generation-retry.v1';
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
  const request = normalizeGatewayRequest(body);
  const skills = await loadSkillRegistry(request);
  const skill = agentServerGenerationSkill(request.skillDomain);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'workspace-skill-selected',
    source: 'workspace-runtime',
    message: `Selected skill ${skill.id} for ${request.skillDomain}`,
    detail: skill.manifest.entrypoint.type,
  });
  return await runAgentServerGeneratedTask(request, skill, skills, callbacks) ?? repairNeededPayload(request, skill, 'AgentServer task generation did not produce a runnable task.');
}

async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: { allowSupplement?: boolean } = {},
): Promise<ToolPayload | undefined> {
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
        'AgentServer returned a BioAgent ToolPayload directly; no workspace task archive was required.',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(request, skill),
        agentServerGenerated: true,
        agentServerRunId: directGeneration.runId,
      } : unit),
    };
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
          `AgentServer returned taskFiles path-only reference but BioAgent could not read workspace file: ${declaredRel}`,
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
  const outputRel = `.bioagent/task-results/${taskId}.json`;
  const stdoutRel = `.bioagent/logs/${taskId}.stdout.log`;
  const stderrRel = `.bioagent/logs/${taskId}.stderr.log`;
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
      priorAttempts: summarizeTaskAttemptsForAgentServer(await readRecentTaskAttempts(workspace, request.skillDomain, 8, {
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
      inputRef: `.bioagent/task-inputs/${taskId}.json`,
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
      inputRef: `.bioagent/task-inputs/${taskId}.json`,
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
      });
      if (supplemented) return supplemented;
    }
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      taskRel,
      inputRef: `.bioagent/task-inputs/${taskId}.json`,
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
        proposal ? `Skill promotion proposal: .bioagent/skill-proposals/${proposal.id}` : '',
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
      inputRef: `.bioagent/task-inputs/${taskId}.json`,
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

async function tryAgentServerSupplementMissingArtifacts(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  baseUrl: string;
  workspace: string;
  payload: ToolPayload;
  expectedArtifactTypes?: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
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

function isBlockingAgentServerConfigurationFailure(reason: string) {
  return /User-side model configuration|llmEndpoint|openteam\.json defaults|Model Provider|Model Base URL|Model Name/i.test(reason);
}

async function readGeneratedTaskFileIfPresent(workspace: string, path: string) {
  try {
    return await readFile(join(workspace, safeWorkspaceRel(path)), 'utf8');
  } catch {
    return undefined;
  }
}

async function missingGeneratedTaskFileContents(
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

function normalizeGatewayRequest(body: Record<string, unknown>): GatewayRequest {
  const skillDomain = String(body.skillDomain || '') as BioAgentSkillDomain;
  if (!SKILL_DOMAIN_SET.has(skillDomain)) throw new Error(`Unsupported BioAgent skill domain: ${String(body.skillDomain || '')}`);
  return {
    skillDomain,
    prompt: String(body.prompt || ''),
    workspacePath: typeof body.workspacePath === 'string' ? body.workspacePath : undefined,
    agentServerBaseUrl: typeof body.agentServerBaseUrl === 'string' ? cleanUrl(body.agentServerBaseUrl) : undefined,
    agentBackend: typeof body.agentBackend === 'string' ? body.agentBackend : undefined,
    modelProvider: typeof body.modelProvider === 'string' ? body.modelProvider : undefined,
    modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
    maxContextWindowTokens: finiteNumber(body.maxContextWindowTokens),
    llmEndpoint: normalizeLlmEndpoint(body.llmEndpoint),
    scenarioPackageRef: normalizeScenarioPackageRef(body.scenarioPackageRef),
    skillPlanRef: typeof body.skillPlanRef === 'string' ? body.skillPlanRef : undefined,
    uiPlanRef: typeof body.uiPlanRef === 'string' ? body.uiPlanRef : undefined,
    artifacts: Array.isArray(body.artifacts) ? body.artifacts.filter(isRecord) : [],
    uiState: isRecord(body.uiState) ? body.uiState : undefined,
    availableSkills: Array.isArray(body.availableSkills) ? body.availableSkills.map(String) : undefined,
    expectedArtifactTypes: Array.isArray(body.expectedArtifactTypes) ? uniqueStrings(body.expectedArtifactTypes.map(String)) : undefined,
    selectedComponentIds: Array.isArray(body.selectedComponentIds) ? uniqueStrings(body.selectedComponentIds.map(String)) : undefined,
  };
}

function normalizeScenarioPackageRef(value: unknown): GatewayRequest['scenarioPackageRef'] {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const version = typeof value.version === 'string' ? value.version.trim() : '';
  const source = value.source === 'built-in' || value.source === 'workspace' || value.source === 'generated' ? value.source : undefined;
  return id && version && source ? { id, version, source } : undefined;
}

function normalizeLlmEndpoint(value: unknown): LlmEndpointConfig | undefined {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const baseUrl = typeof value.baseUrl === 'string' ? cleanUrl(value.baseUrl) : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const modelName = typeof value.modelName === 'string' ? value.modelName.trim() : '';
  if (!baseUrl && !apiKey && !modelName) return undefined;
  return {
    provider: provider || undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
}

async function collectArtifactReferenceContext(request: GatewayRequest) {
  const workspace = resolve(request.workspacePath || process.cwd());
  const recentExecutionRefs = toRecordList(request.uiState?.recentExecutionRefs);
  let priorAttempts = await readRecentTaskAttempts(workspace, request.skillDomain, 8, {
    scenarioPackageId: request.scenarioPackageRef?.id,
    skillPlanRef: request.skillPlanRef,
  });
  if (!priorAttempts.length) {
    priorAttempts = await readRecentTaskAttempts(workspace, request.skillDomain, 8);
  }
  const sessionId = typeof request.uiState?.sessionId === 'string' ? request.uiState.sessionId : undefined;
  const artifactFiles = (await readRecentArtifactFiles(workspace, sessionId))
    .filter((entry) => artifactBelongsToRequest(entry.artifact, request));
  if (!request.artifacts.length && !recentExecutionRefs.length && !priorAttempts.length && !artifactFiles.length) return undefined;
  const latestAttempt = pickLatestReferenceAttempt(priorAttempts);
  const latestExecutionRef = pickLatestReferenceExecutionRef(recentExecutionRefs);
  const refs = {
    codeRef: await pickExistingReference(workspace, stringField(latestAttempt?.codeRef), stringField(latestExecutionRef?.codeRef)),
    inputRef: await pickExistingReference(workspace, stringField(latestAttempt?.inputRef), stringField(latestExecutionRef?.inputRef)),
    outputRef: await pickExistingReference(workspace, stringField(latestAttempt?.outputRef), stringField(latestExecutionRef?.outputRef)),
    stdoutRef: await pickExistingReference(workspace, stringField(latestAttempt?.stdoutRef), stringField(latestExecutionRef?.stdoutRef)),
    stderrRef: await pickExistingReference(workspace, stringField(latestAttempt?.stderrRef), stringField(latestExecutionRef?.stderrRef)),
  };
  const outputArtifacts = await readArtifactsFromOutputRef(workspace, refs.outputRef);
  const allReferenceArtifacts = mergeArtifactsForReference([
    ...request.artifacts,
    ...outputArtifacts,
  ], artifactFiles.map((entry) => ({
    ...entry.artifact,
    dataRef: stringField(entry.artifact.dataRef) ?? entry.rel,
  })));
  const hasCoreArtifacts = Boolean(
    findArtifactByType(allReferenceArtifacts, 'paper-list')
    || findArtifactByType(allReferenceArtifacts, 'research-report'),
  );
  const latestFailed = (isFailedReferenceAttempt(latestAttempt) || isFailedReferenceAttempt(latestExecutionRef)) && !hasCoreArtifacts;
  const combinedArtifacts = latestFailed ? mergeArtifactsForReference(
    request.artifacts.filter((artifact) => artifactMatchesExecutionRef(artifact, refs.outputRef)),
    [],
  ) : allReferenceArtifacts;
  return {
    combinedArtifacts,
  };
}

function artifactBelongsToRequest(artifact: Record<string, unknown>, request: GatewayRequest) {
  const producer = [
    stringField(artifact.producerScenario),
    stringField(artifact.producerScenarioId),
    stringField(isRecord(artifact.metadata) ? artifact.metadata.producerScenario : undefined),
    stringField(isRecord(artifact.metadata) ? artifact.metadata.skillDomain : undefined),
  ].filter(Boolean).join(' ').toLowerCase();
  if (producer && producer.includes(request.skillDomain)) return true;
  if (producer) return false;
  const type = String(artifact.type || artifact.id || '').toLowerCase();
  if (request.skillDomain === 'literature') return /paper|literature|evidence|research-report/.test(type);
  if (request.skillDomain === 'structure') return /structure|molecule|pdb|protein|research-report/.test(type);
  if (request.skillDomain === 'omics') return /omics|expression|volcano|heatmap|umap|research-report/.test(type);
  if (request.skillDomain === 'knowledge') return /knowledge|graph|network|sequence|research-report/.test(type);
  return true;
}

function currentUserRequestText(prompt: string) {
  const current = prompt.match(/Current user request:\s*([\s\S]*?)(?:\n[A-Z][^\n:]{2,80}:\s|\nWork requirements:\s|$)/);
  if (current?.[1]?.trim()) return current[1].trim();
  const recent = prompt.match(/当前用户请求[:：]\s*([\s\S]*?)(?:\n[A-Z][^\n:]{2,80}:\s|\n工作要求[:：]\s|$)/);
  if (recent?.[1]?.trim()) return recent[1].trim();
  return prompt;
}

function pickLatestReferenceAttempt(attempts: TaskAttemptRecord[]) {
  return attempts.find((attempt) => hasExecutionFileRefs(attempt)) ?? attempts[0];
}

function pickLatestReferenceExecutionRef(refs: Array<Record<string, unknown>>) {
  return refs.find((entry) => hasExecutionFileRefs(entry) && !isFailedReferenceAttempt(entry))
    ?? refs.find((entry) => hasExecutionFileRefs(entry));
}

function hasExecutionFileRefs(value: unknown) {
  if (!isRecord(value)) return false;
  return Boolean(value.codeRef || value.outputRef || value.stdoutRef || value.stderrRef);
}

async function pickExistingReference(workspace: string, ...refs: Array<string | undefined>) {
  const candidates = uniqueStrings(refs.filter((ref): ref is string => Boolean(ref)));
  for (const ref of candidates) {
    const path = workspaceRefPath(workspace, ref);
    if (path && await fileExists(path)) return ref;
  }
  return candidates[0];
}

function isFailedReferenceAttempt(value: unknown) {
  if (!isRecord(value)) return false;
  const status = String(value.status || '').toLowerCase();
  const exitCode = typeof value.exitCode === 'number' ? value.exitCode : undefined;
  return status === 'failed'
    || status === 'failed-with-reason'
    || status === 'repair-needed'
    || (typeof exitCode === 'number' && exitCode !== 0);
}

async function readRecentArtifactFiles(workspace: string, sessionId?: string) {
  const dir = join(workspace, '.bioagent', 'artifacts');
  if (!await fileExists(dir)) return [] as Array<{ rel: string; artifact: Record<string, unknown>; mtimeMs: number }>;
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(files
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => {
      const rel = `.bioagent/artifacts/${file}`;
      const path = join(workspace, rel);
      try {
        const [stats, text] = await Promise.all([stat(path), readFile(path, 'utf8')]);
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? { rel, artifact: parsed, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }));
  return entries
    .filter((entry): entry is { rel: string; artifact: Record<string, unknown>; mtimeMs: number } => Boolean(entry))
    .filter((entry) => !sessionId || entry.rel.includes(sessionId) || String(entry.artifact.producerSessionId || entry.artifact.sessionId || '').includes(sessionId))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 24);
}

async function readArtifactsFromOutputRef(workspace: string, outputRef: string | undefined) {
  if (!outputRef || /^[a-z]+:\/\//i.test(outputRef)) return [] as Array<Record<string, unknown>>;
  const path = workspaceRefPath(workspace, outputRef);
  if (!path) return [];
  if (!await fileExists(path)) return [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const artifacts = isRecord(parsed) && Array.isArray(parsed.artifacts)
      ? toRecordList(parsed.artifacts)
      : isRecord(parsed) && parsed.type ? [parsed] : [];
    return artifacts.map((artifact) => ({
      ...artifact,
      dataRef: stringField(artifact.dataRef) ?? outputRef,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        outputRef,
      },
    }));
  } catch {
    return [];
  }
}

function workspaceRefPath(workspace: string, ref: string | undefined) {
  if (!ref || /^[a-z]+:\/\//i.test(ref)) return undefined;
  try {
    const root = resolve(workspace);
    const path = ref.startsWith('/')
      ? resolve(ref)
      : resolve(root, safeWorkspaceRel(ref));
    return path === root || path.startsWith(`${root}/`) ? path : undefined;
  } catch {
    return undefined;
  }
}

function mergeArtifactsForReference(left: Array<Record<string, unknown>>, right: Array<Record<string, unknown>>) {
  return [...left, ...right].filter((artifact) => isRecord(artifact));
}

function findArtifactByType(artifacts: Array<Record<string, unknown>>, type: string) {
  return artifacts.find((artifact) => String(artifact.type || artifact.id || '') === type && !artifactNeedsRepair(artifact))
    ?? artifacts.find((artifact) => String(artifact.type || artifact.id || '') === type);
}

function artifactMatchesExecutionRef(artifact: Record<string, unknown>, outputRef: string | undefined) {
  if (!outputRef) return false;
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.outputRef) === outputRef
    || stringField(artifact.dataRef) === outputRef
    || stringField(metadata.outputRef) === outputRef;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  return request.scenarioPackageRef?.source === 'built-in' ? 'seed-skill' : undefined;
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
  const requested = process.env.BIOAGENT_AGENTSERVER_BACKEND?.trim();
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

async function preflightAgentServerContextWindow(params: {
  adapter: AgentBackendAdapter;
  baseUrl: string;
  workspace: string;
  agentId: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}) {
  const sessionRef = {
    agentId: params.agentId,
    workspace: params.workspace,
    baseUrl: params.baseUrl,
  };
  const state = await params.adapter.readContextWindowState?.(sessionRef);
  if (state) {
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-context-window-state',
      source: 'workspace-runtime',
      status: state.status,
      message: `AgentServer context window ${state.status}`,
      detail: formatContextWindowState(state),
      contextWindowState: workspaceContextWindowStateFromBackend(state),
      raw: state,
    });
  }
  if (!state || !contextWindowNeedsCompaction(state)) {
    return { state, forceSlimHandoff: false };
  }
  const reason = `preflight:${state.status}:${formatContextWindowState(state)}`;
  const compaction = await params.adapter.compactContext?.(sessionRef, reason);
  if (compaction) {
    const compactionStatus = compaction.status === 'unsupported' || compaction.status === 'skipped'
      ? 'skipped'
      : compaction.ok ? 'completed' : 'failed';
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-context-compaction',
      source: 'workspace-runtime',
      status: compactionStatus,
      message: `AgentServer context compaction ${compaction.strategy}`,
      detail: compaction.message || compaction.reason,
      raw: compaction,
    });
  }
  const after = compaction?.after ?? state;
  return {
    state: after,
    compaction,
    forceSlimHandoff: !compaction?.ok || compaction.strategy === 'handoff-slimming' || compaction.strategy === 'session-rotate',
  };
}

async function readBackendContextWindowState(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  capabilities: AgentBackendCapabilities,
): Promise<BackendContextWindowState | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/context`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
    const json = await response.json() as unknown;
    const data = isRecord(json) && isRecord(json.data) ? json.data : json;
    if (!isRecord(data)) return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
    const snapshot = compactAgentServerCoreSnapshot(data);
    return normalizeBackendContextWindowState(data, snapshot, sessionRef.agentId, backend, capabilities);
  } catch {
    return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
  } finally {
    clearTimeout(timeout);
  }
}

async function compactBackendContext(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  capabilities: AgentBackendCapabilities,
  reason: string,
): Promise<BackendContextCompactionResult> {
  const before = await readBackendContextWindowState(sessionRef, backend, capabilities);
  const managedByAgentServer = isAgentServerManagedCompactionBackend(backend);
  if (!capabilities.nativeCompaction) {
    const agentServerCompaction = await requestAgentServerCompact(sessionRef, backend, reason, before);
    if (agentServerCompaction.ok) return agentServerCompaction;
    if (managedByAgentServer) {
      return {
        ok: false,
        status: agentServerCompaction.status === 'unsupported' ? 'unsupported' : 'failed',
        backend,
        agentId: sessionRef.agentId,
        strategy: 'agentserver',
        reason,
        before,
        after: markAgentServerManagedFallbackState(before, sessionRef.agentId, backend),
        message: agentServerCompaction.message || 'AgentServer session/current-work compaction was unavailable for this managed backend.',
        auditRefs: agentServerCompaction.auditRefs,
      };
    }
    return {
      ok: false,
      status: agentServerCompaction.status === 'unsupported' ? 'unsupported' : 'skipped',
      backend,
      agentId: sessionRef.agentId,
      strategy: backend === 'gemini' && capabilities.sessionRotationSafe ? 'session-rotate' : capabilities.sessionRotationSafe ? 'handoff-slimming' : 'none',
      reason,
      before,
      after: markHandoffSlimmingState(before, sessionRef.agentId, backend),
      message: agentServerCompaction.message || (backend === 'gemini'
        ? 'Gemini SDK/API has no native compaction/reset; using AgentServer context compaction and session rotation fallback.'
        : 'Backend has no native compaction; using compact handoff refs for this turn.'),
      auditRefs: agentServerCompaction.auditRefs,
    };
  }
  const native = await requestAgentServerCompact(sessionRef, backend, reason, before);
  if (native.ok) return native;
  return {
    ok: false,
    status: native.status === 'unsupported' ? 'unsupported' : 'skipped',
    backend,
    agentId: sessionRef.agentId,
    strategy: 'handoff-slimming',
    reason,
    before,
    after: markHandoffSlimmingState(before, sessionRef.agentId, backend),
    message: native.message || 'Native compaction was unavailable; using compact handoff refs for this turn.',
    auditRefs: native.auditRefs,
  };
}

async function requestAgentServerCompact(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  reason: string,
  before: BackendContextWindowState | undefined,
): Promise<BackendContextCompactionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        reason,
        backend,
        workspace: sessionRef.workspace,
        compactionScope: isAgentServerManagedCompactionBackend(backend) ? 'session-current-work' : 'backend-context',
        strategy: isAgentServerManagedCompactionBackend(backend) ? 'agentserver-session-current-work' : undefined,
        contextWindow: before ? contextWindowMetadata(before) : undefined,
      }),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Compact endpoints may be absent or plain-text in older AgentServer builds.
    }
    if (!response.ok) {
      const compactStatus = response.status === 404 || response.status === 405 || response.status === 501
        ? 'unsupported'
        : 'failed';
      return {
        ok: false,
        status: compactStatus,
        backend,
        agentId: sessionRef.agentId,
        strategy: 'agentserver',
        reason,
        before,
        message: isRecord(json) ? String(json.error || json.message || '') : String(text).slice(0, 500),
        auditRefs: [
          `agentserver:${sessionRef.agentId}:compact:${response.status}`,
          `${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/compact`,
        ],
      };
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    const stateData = isRecord(data.state) ? data.state : isRecord(data.contextWindowState) ? data.contextWindowState : data;
    const after = normalizeBackendContextWindowState(stateData, before?.snapshot, sessionRef.agentId, backend, agentBackendCapabilities(backend));
    return {
      ok: true,
      status: 'compacted',
      backend,
      agentId: sessionRef.agentId,
      strategy: before?.compactCapability === 'native' ? 'native' : 'agentserver',
      reason,
      before,
      after,
      runId: stringField(data.runId) ?? stringField(data.id),
      message: stringField(data.message) ?? 'Context compacted before dispatch.',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      backend,
      agentId: sessionRef.agentId,
      strategy: 'agentserver',
      reason,
      before,
      message: errorMessage(error),
      auditRefs: [`agentserver:${sessionRef.agentId}:compact:error`],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBackendContextWindowState(
  data: Record<string, unknown>,
  snapshot: Record<string, unknown> | undefined,
  agentId: string,
  backend: string,
  capabilities: AgentBackendCapabilities,
): BackendContextWindowState {
  const hermesCompat = backend === 'hermes-agent' ? hermesCompatContextRecord(data) : {};
  const contextWindow = firstRecord(data.contextWindow, data.contextWindowState, hermesCompat);
  const usage = firstRecord(data.usage, data.tokenUsage, contextWindow.usage, hermesCompat);
  const workBudget = isRecord(data.workBudget) ? data.workBudget : {};
  const input = firstFiniteNumber(usage.input, usage.inputTokens, usage.promptTokens, usage.prompt_tokens, contextWindow.input, contextWindow.inputTokens, contextWindow.prompt_tokens);
  const output = firstFiniteNumber(usage.output, usage.outputTokens, usage.completionTokens, usage.completion_tokens, contextWindow.output, contextWindow.outputTokens, contextWindow.completion_tokens);
  const cacheRead = firstFiniteNumber(usage.cacheRead, usage.cache_read, usage.cacheReadTokens, contextWindow.cacheRead, contextWindow.cache_read, contextWindow.cacheReadTokens);
  const cacheWrite = firstFiniteNumber(usage.cacheWrite, usage.cache_write, usage.cacheWriteTokens, contextWindow.cacheWrite, contextWindow.cache_write, contextWindow.cacheWriteTokens);
  const cache = firstFiniteNumber(usage.cache, usage.cacheTokens, usage.cache_tokens, contextWindow.cache, contextWindow.cacheTokens, contextWindow.cache_tokens)
    ?? (cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const tokens = finiteNumber(contextWindow.tokens)
    ?? finiteNumber(contextWindow.usedTokens)
    ?? finiteNumber(contextWindow.used_tokens)
    ?? finiteNumber(contextWindow.contextWindowTokens)
    ?? finiteNumber(contextWindow.context_window_tokens)
    ?? finiteNumber(contextWindow.contextLength)
    ?? finiteNumber(contextWindow.context_length)
    ?? finiteNumber(contextWindow.currentContextLength)
    ?? finiteNumber(contextWindow.current_context_length)
    ?? finiteNumber(workBudget.approxCurrentWorkTokens);
  const limit = finiteNumber(contextWindow.limit)
    ?? finiteNumber(contextWindow.window)
    ?? finiteNumber(contextWindow.windowTokens)
    ?? finiteNumber(contextWindow.window_tokens)
    ?? finiteNumber(contextWindow.contextWindowLimit)
    ?? finiteNumber(contextWindow.context_window_limit)
    ?? finiteNumber(contextWindow.modelContextWindow)
    ?? finiteNumber(contextWindow.model_context_window)
    ?? finiteNumber(contextWindow.maxContextLength)
    ?? finiteNumber(contextWindow.max_context_length)
    ?? finiteNumber(contextWindow.contextLimit)
    ?? finiteNumber(contextWindow.context_limit)
    ?? finiteNumber(data.maxContextWindowTokens)
    ?? finiteNumber(data.max_context_window_tokens)
    ?? finiteNumber(snapshot?.maxContextWindowTokens)
    ?? finiteNumber(snapshot?.max_context_window_tokens)
    ?? finiteNumber(workBudget.contextWindowLimit);
  const ratio = finiteNumber(contextWindow.ratio)
    ?? finiteNumber(contextWindow.contextWindowRatio)
    ?? finiteNumber(contextWindow.context_window_ratio)
    ?? finiteNumber(contextWindow.usageRatio)
    ?? finiteNumber(contextWindow.usage_ratio)
    ?? (tokens !== undefined && limit ? tokens / limit : undefined);
  const rawAutoCompactThreshold = finiteNumber(contextWindow.autoCompactThreshold)
    ?? finiteNumber(contextWindow.auto_compact_threshold)
    ?? finiteNumber(contextWindow.compressionThreshold)
    ?? finiteNumber(contextWindow.compression_threshold)
    ?? finiteNumber(contextWindow.modelAutoCompactTokenLimit)
    ?? (limit && finiteNumber(workBudget.autoCompactTokenLimit) ? finiteNumber(workBudget.autoCompactTokenLimit)! / limit : undefined);
  const autoCompactThreshold = rawAutoCompactThreshold && rawAutoCompactThreshold > 1 && limit
    ? rawAutoCompactThreshold / limit
    : rawAutoCompactThreshold ?? 0.82;
  const rawStatus = stringField(contextWindow.status) ?? stringField(workBudget.status);
  const status = normalizeContextWindowStatus(rawStatus, ratio, autoCompactThreshold);
  const provider = stringField(contextWindow.provider) ?? stringField(usage.provider) ?? providerForBackend(backend);
  const model = stringField(contextWindow.model) ?? stringField(usage.model) ?? stringField(data.model) ?? stringField(data.modelName);
  const source = normalizeBackendContextWindowSource(
    stringField(contextWindow.source) ?? stringField(usage.source) ?? stringField(data.source),
    backend,
    capabilities,
    Boolean(tokens !== undefined || limit !== undefined || ratio !== undefined),
    Boolean(input !== undefined || output !== undefined || cache !== undefined || finiteNumber(usage.total) !== undefined),
  );
  return {
    backend,
    agentId,
    provider,
    model,
    usedTokens: tokens,
    input,
    output,
    cache,
    window: limit,
    ratio,
    source,
    status,
    contextWindowTokens: tokens,
    contextWindowLimit: limit,
    contextWindowRatio: ratio,
    autoCompactThreshold,
    lastCompactedAt: stringField(contextWindow.lastCompactedAt) ?? stringField(contextWindow.last_compacted_at) ?? stringField(contextWindow.lastCompressedAt) ?? stringField(contextWindow.last_compressed_at) ?? stringField(workBudget.lastCompactedAt),
    rateLimit: normalizeRateLimit(data.rateLimit ?? data.rate_limit ?? contextWindow.rateLimit ?? contextWindow.rate_limit ?? hermesCompatRateLimitRecord(data)),
    compactCapability: capabilities.nativeCompaction
      ? 'native'
      : compactCapabilityForBackend(backend) === 'session-rotate'
        ? 'session-rotate'
        : compactCapabilityForBackend(backend) === 'handoff-only'
          ? 'handoff-only'
          : 'agentserver',
    snapshot,
  };
}

function fallbackContextWindowState(agentId: string, backend: string, capabilities: AgentBackendCapabilities): BackendContextWindowState {
  return {
    backend,
    agentId,
    provider: providerForBackend(backend),
    source: 'unknown',
    status: 'unknown',
    compactCapability: fallbackCompactCapabilityForBackend(backend, capabilities),
  };
}

function fallbackCompactCapabilityForBackend(
  backend: string,
  capabilities: AgentBackendCapabilities,
): BackendContextWindowState['compactCapability'] {
  if (capabilities.nativeCompaction) return 'native';
  const capability = compactCapabilityForBackend(backend);
  if (capability === 'agentserver' || capability === 'handoff-only' || capability === 'session-rotate' || capability === 'none') {
    return capability;
  }
  if (backend === 'gemini' && capabilities.sessionRotationSafe) return 'session-rotate';
  return capabilities.sessionRotationSafe ? 'handoff-only' : 'none';
}

function isAgentServerManagedCompactionBackend(backend: string) {
  return backend === 'openteam_agent';
}

function markAgentServerManagedFallbackState(
  state: BackendContextWindowState | undefined,
  agentId: string,
  backend: string,
): BackendContextWindowState {
  return {
    ...(state ?? {
      backend,
      agentId,
      source: 'agentserver-estimate' as const,
      status: 'unknown' as const,
      compactCapability: 'agentserver' as const,
    }),
    backend,
    agentId,
    source: state?.source ?? 'agentserver-estimate',
    status: state?.status ?? 'unknown',
    compactCapability: 'agentserver',
  };
}

function markHandoffSlimmingState(
  state: BackendContextWindowState | undefined,
  agentId: string,
  backend: string,
): BackendContextWindowState {
  return {
    ...(state ?? {
      backend,
      agentId,
      source: 'agentserver-estimate' as const,
      status: 'watch' as const,
      compactCapability: 'handoff-only' as const,
    }),
    backend,
    agentId,
    source: 'agentserver-estimate',
    status: 'watch',
    compactCapability: backend === 'gemini' ? 'session-rotate' : 'handoff-only',
  };
}

function normalizeBackendContextWindowSource(
  value: string | undefined,
  backend: string,
  capabilities: AgentBackendCapabilities,
  hasContextWindowTelemetry: boolean,
  hasUsage: boolean,
): BackendContextWindowState['source'] {
  if (value === 'native') return 'native';
  if (value === 'provider-usage' || value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'handoff') return 'agentserver-estimate';
  if (hasContextWindowTelemetry && capabilities.nativeCompaction && (backend === 'codex' || backend === 'hermes-agent')) return 'native';
  if (hasUsage) return 'provider-usage';
  if (hasContextWindowTelemetry) return 'agentserver-estimate';
  return 'unknown';
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) ?? {};
}

function normalizeRateLimit(value: unknown): BackendContextWindowState['rateLimit'] | undefined {
  if (!isRecord(value)) return undefined;
  const rateLimit = {
    limited: typeof value.limited === 'boolean' ? value.limited : typeof value.rate_limited === 'boolean' ? value.rate_limited : undefined,
    retryAfterMs: finiteNumber(value.retryAfterMs) ?? finiteNumber(value.retry_after_ms) ?? retryAfterMsFromText(JSON.stringify(value)),
    resetAt: stringField(value.resetAt) ?? stringField(value.reset_at) ?? stringField(value.rateLimitResetAt) ?? stringField(value.rate_limit_reset_at) ?? stringField(value.rate_limit_reset),
  };
  return rateLimit.limited !== undefined || rateLimit.retryAfterMs !== undefined || rateLimit.resetAt ? rateLimit : undefined;
}

function hermesCompatContextRecord(data: Record<string, unknown>): Record<string, unknown> {
  const hermes = firstRecord(data.hermes, data.hermesAgent, data.hermes_agent, data.compat, data.supervisorCompat, data.supervisor_compat);
  const event = firstRecord(data.event, data.payload, data.data);
  return firstRecord(
    data.context_compressor,
    data.contextCompressor,
    data.hermesContextCompressor,
    data.hermes_context_compressor,
    hermes.context_compressor,
    hermes.contextCompressor,
    event.context_compressor,
    event.contextCompressor,
    /context_compressor|context-compressor|hermes/i.test(String(data.type || data.kind || event.type || event.kind || '')) ? event : undefined,
  );
}

function hermesCompatRateLimitRecord(data: Record<string, unknown>): Record<string, unknown> {
  const hermes = firstRecord(data.hermes, data.hermesAgent, data.hermes_agent, data.compat, data.supervisorCompat, data.supervisor_compat);
  const event = firstRecord(data.event, data.payload, data.data);
  return firstRecord(
    data.rate_limit,
    data.rateLimit,
    data.rateLimitDiagnostics,
    data.rate_limit_diagnostics,
    hermes.rate_limit,
    hermes.rateLimit,
    event.rate_limit,
    event.rateLimit,
    event.rateLimitDiagnostics,
    event.rate_limit_diagnostics,
    data.rate_limit_reset || data.rate_limit_reset_at || data.retry_after_ms ? data : undefined,
    event.rate_limit_reset || event.rate_limit_reset_at || event.retry_after_ms ? event : undefined,
  );
}

function normalizeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): BackendContextWindowState['status'] {
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /near|compact|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

function contextWindowNeedsCompaction(state: BackendContextWindowState) {
  return state.status === 'near-limit'
    || state.status === 'exceeded'
    || (state.contextWindowRatio !== undefined && state.contextWindowRatio >= (state.autoCompactThreshold ?? 0.82));
}

function formatContextWindowState(state: BackendContextWindowState) {
  const ratio = state.contextWindowRatio !== undefined ? `${Math.round(state.contextWindowRatio * 100)}%` : 'unknown ratio';
  const tokens = state.contextWindowTokens !== undefined ? `${state.contextWindowTokens}` : '?';
  const limit = state.contextWindowLimit !== undefined ? `${state.contextWindowLimit}` : '?';
  return `${state.backend} ${state.status} ${ratio} (${tokens}/${limit}) via ${state.compactCapability}`;
}

function contextWindowMetadata(state: BackendContextWindowState) {
  return {
    backend: state.backend,
    provider: state.provider,
    model: state.model,
    usedTokens: state.usedTokens,
    input: state.input,
    output: state.output,
    cache: state.cache,
    window: state.window,
    ratio: state.ratio,
    source: state.source,
    status: state.status,
    contextWindowTokens: state.contextWindowTokens,
    contextWindowLimit: state.contextWindowLimit,
    contextWindowRatio: state.contextWindowRatio,
    autoCompactThreshold: state.autoCompactThreshold,
    compactCapability: state.compactCapability,
    rateLimit: state.rateLimit,
    budget: state.budget,
    auditRefs: state.auditRefs,
  };
}

function workspaceContextWindowStateFromBackend(state: BackendContextWindowState): WorkspaceRuntimeEvent['contextWindowState'] {
  return {
    backend: state.backend,
    provider: state.provider,
    model: state.model,
    usedTokens: state.usedTokens,
    input: state.input,
    output: state.output,
    cache: state.cache,
    window: state.window,
    windowTokens: state.window,
    ratio: state.ratio,
    source: state.source,
    status: state.status,
    compactCapability: state.compactCapability,
    budget: state.budget,
    auditRefs: state.auditRefs,
    autoCompactThreshold: state.autoCompactThreshold,
    lastCompactedAt: state.lastCompactedAt,
  };
}

function contextCompactionMetadata(compaction: BackendContextCompactionResult) {
  return {
    ok: compaction.ok,
    status: compaction.status,
    strategy: compaction.strategy,
    reason: compaction.reason,
    message: compaction.message,
    runId: compaction.runId,
    auditRefs: compaction.auditRefs,
    before: compaction.before ? contextWindowMetadata(compaction.before) : undefined,
    after: compaction.after ? contextWindowMetadata(compaction.after) : undefined,
  };
}

function agentServerAgentId(request: GatewayRequest, _purpose: string) {
  const sessionId = typeof request.uiState?.sessionId === 'string' ? request.uiState.sessionId : '';
  const packageId = request.scenarioPackageRef?.id || request.skillDomain;
  const stable = [packageId, sessionId || request.skillPlanRef || request.skillDomain]
    .filter(Boolean)
    .join(':');
  return `bioagent-${request.skillDomain}-${sha1(stable).slice(0, 12)}`;
}

function agentServerContextPolicy(request: GatewayRequest) {
  const hasSession = typeof request.uiState?.sessionId === 'string' && request.uiState.sessionId.trim().length > 0;
  return {
    includeCurrentWork: hasSession,
    includeRecentTurns: hasSession,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: hasSession,
    persistExtractedConstraints: false,
    maxContextWindowTokens: request.maxContextWindowTokens,
    contextWindowLimit: request.maxContextWindowTokens,
    modelContextWindow: request.maxContextWindowTokens,
  };
}

function estimateWorkspaceContextWindowState(params: {
  backend: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  usedTokens: number;
  source: 'estimate' | 'unknown';
  budget?: WorkspaceRuntimeContextBudget;
  auditRefs?: string[];
}) {
  const windowTokens = params.maxContextWindowTokens ?? estimateModelContextWindow(params.modelName);
  const ratio = windowTokens ? params.usedTokens / windowTokens : undefined;
  return {
    backend: params.backend,
    provider: providerForBackend(params.backend),
    model: params.modelName,
    usedTokens: params.usedTokens,
    window: windowTokens,
    windowTokens,
    ratio,
    source: windowTokens ? params.source : 'unknown',
    status: normalizeContextWindowStatus(undefined, ratio, 0.82),
    compactCapability: compactCapabilityForBackend(params.backend),
    budget: params.budget,
    auditRefs: params.auditRefs,
    autoCompactThreshold: 0.82,
    watchThreshold: 0.68,
    nearLimitThreshold: 0.86,
  };
}

function handoffContextWindowState(params: {
  backend: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  maxPayloadBytes: number;
  normalizedTokens: number;
  rawTokens: number;
  savedTokens: number;
  decisions: Array<Record<string, unknown>>;
  auditRefs: string[];
}) {
  return estimateWorkspaceContextWindowState({
    backend: params.backend,
    modelName: params.modelName,
    maxContextWindowTokens: params.maxContextWindowTokens,
    usedTokens: params.normalizedTokens,
    source: 'estimate',
    auditRefs: params.auditRefs,
    budget: {
      rawRef: params.rawRef,
      rawSha1: params.rawSha1,
      rawBytes: params.rawBytes,
      normalizedBytes: params.normalizedBytes,
      maxPayloadBytes: params.maxPayloadBytes,
      rawTokens: params.rawTokens,
      normalizedTokens: params.normalizedTokens,
      savedTokens: params.savedTokens,
      normalizedBudgetRatio: params.maxPayloadBytes ? params.normalizedBytes / params.maxPayloadBytes : undefined,
      decisions: params.decisions,
    },
  });
}

function handoffBudgetDecisionRecords(decisions: unknown[]): Array<Record<string, unknown>> {
  return decisions.filter(isRecord).map((decision) => ({ ...decision }));
}

function estimateModelContextWindow(modelName?: string) {
  const model = (modelName ?? '').toLowerCase();
  if (!model) return undefined;
  if (/1m|1000k|gemini-1\.5-pro|gemini-2\./.test(model)) return 1_000_000;
  if (/400k|claude.*sonnet-4|claude.*opus-4/.test(model)) return 400_000;
  if (/200k|claude|gpt-4\.1|gpt-5|o3|o4/.test(model)) return 200_000;
  if (/128k|gpt-4o|gemini/.test(model)) return 128_000;
  if (/32k/.test(model)) return 32_000;
  if (/16k/.test(model)) return 16_000;
  return undefined;
}

function compactCapabilityForBackend(backend: string): 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown' {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

async function fetchAgentServerContextSnapshot(baseUrl: string, agentId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/api/agent-server/agents/${encodeURIComponent(agentId)}/context`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const json = await response.json() as unknown;
    const data = isRecord(json) && isRecord(json.data) ? json.data : json;
    if (!isRecord(data)) return undefined;
    return compactAgentServerCoreSnapshot(data);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function compactAgentServerCoreSnapshot(snapshot: Record<string, unknown>) {
  const recentTurns = toRecordList(snapshot.recentTurns);
  const currentWorkEntries = toRecordList(snapshot.currentWorkEntries);
  return {
    source: 'AgentServer Core /context',
    session: isRecord(snapshot.session) ? {
      id: stringField(snapshot.session.id),
      status: stringField(snapshot.session.status),
      updatedAt: stringField(snapshot.session.updatedAt),
      recovery: isRecord(snapshot.session.recovery) ? clipForAgentServerJson(snapshot.session.recovery, 2) : undefined,
    } : undefined,
    operationalGuidance: clipForAgentServerJson(snapshot.operationalGuidance, 3),
    workLayout: clipForAgentServerJson(snapshot.workLayout, 3),
    workBudget: clipForAgentServerJson(snapshot.workBudget, 2),
    persistentBudget: clipForAgentServerJson(snapshot.persistentBudget, 2),
    memoryBudget: clipForAgentServerJson(snapshot.memoryBudget, 2),
    recentTurns: recentTurns.slice(-6).map((turn) => ({
      turnNumber: typeof turn.turnNumber === 'number' ? turn.turnNumber : undefined,
      role: stringField(turn.role),
      runId: stringField(turn.runId),
      contentRef: stringField(turn.contentRef),
      contentOmitted: turn.contentOmitted === true,
      content: clipForAgentServerPrompt(turn.content, 800),
      createdAt: stringField(turn.createdAt),
    })),
    currentWork: {
      entryCount: currentWorkEntries.length,
      rawTurnCount: currentWorkEntries.filter((entry) => entry.kind === 'turn' || entry.role).length,
      compactionTags: currentWorkEntries
        .filter((entry) => entry.kind === 'compaction' || entry.kind === 'partial_compaction')
        .slice(-8)
        .map((entry) => ({
          kind: stringField(entry.kind),
          id: stringField(entry.id),
          turns: stringField(entry.turns),
          archived: entry.archived,
          summary: Array.isArray(entry.summary) ? entry.summary.slice(0, 4).map((item) => clipForAgentServerPrompt(item, 400)) : undefined,
        })),
    },
  };
}

async function runPythonWorkspaceSkill(request: GatewayRequest, skill: SkillAvailability, taskPrefix: string, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const executionPrompt = executionPromptForWorkspaceSkill(request);
  const runId = sha1(`${taskPrefix}:${executionPrompt}:${Date.now()}`).slice(0, 12);
  const outputRel = `.bioagent/task-results/${taskPrefix}-${runId}.json`;
  const inputRel = `.bioagent/task-inputs/${taskPrefix}-${runId}.json`;
  const stdoutRel = `.bioagent/logs/${taskPrefix}-${runId}.stdout.log`;
  const stderrRel = `.bioagent/logs/${taskPrefix}-${runId}.stderr.log`;
  const taskRel = `.bioagent/tasks/${taskPrefix}-${runId}.py`;
  const taskId = `${taskPrefix}-${runId}`;
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'workspace-task-start',
    source: 'workspace-runtime',
    message: `Running ${skill.id}`,
    detail: `${taskPrefix} task ${taskId}`,
  });
  if (taskPrefix === 'structure') await mkdir(join(workspace, '.bioagent', 'structures'), { recursive: true });
  const entrypointPath = resolve(dirname(skill.manifestPath), String(skill.manifest.entrypoint.path || ''));
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: 'python',
    entrypoint: 'main',
    codeTemplatePath: entrypointPath,
    input: {
      prompt: executionPrompt,
      runtimePrompt: request.prompt,
      runId,
      attempt: 1,
      skillId: skill.id,
      skillMarkdownRef: skill.manifest.entrypoint.path,
      skillDescription: skill.manifest.description,
      expectedArtifacts: expectedArtifactTypesForRequest(request),
      selectedComponentIds: selectedComponentIdsForRequest(request),
    },
    taskRel,
    outputRel,
    stdoutRel,
    stderrRel,
  });
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'workspace-task-result',
    source: 'workspace-runtime',
    status: run.exitCode === 0 ? 'completed' : 'failed',
    message: `${skill.id} exited with ${run.exitCode}`,
    detail: [run.stdout?.slice(0, 800), run.stderr?.slice(0, 800)].filter(Boolean).join('\n'),
  });
  if (run.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    const failureReason = run.stderr || 'Task failed before writing output.';
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: executionPrompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: 'repair-needed',
      codeRef: taskRel,
      inputRef: inputRel,
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
      taskPrefix,
      run,
      schemaErrors: [],
      failureReason,
      callbacks,
    });
    if (repaired) return repaired;
    const payload = failedTaskPayload(request, skill, run);
    return payload;
  }
  try {
    const payload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const errors = schemaErrors(payload);
    const normalized = await validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: executionPrompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: errors.length ? 'repair-needed' : 'done',
      codeRef: taskRel,
      inputRef: inputRel,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      schemaErrors: errors,
      createdAt: new Date().toISOString(),
    });
    if (errors.length) {
      const repaired = await tryAgentServerRepairAndRerun({
        request,
        skill,
        taskId,
        taskPrefix,
        run,
        schemaErrors: errors,
        failureReason: `Task output failed schema validation: ${errors.join('; ')}`,
        callbacks,
      });
      if (repaired) return repaired;
    }
    return normalized;
  } catch (error) {
    const failureReason = errorMessage(error);
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: executionPrompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: 'repair-needed',
      codeRef: taskRel,
      inputRef: inputRel,
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
      taskPrefix,
      run,
      schemaErrors: ['output could not be parsed'],
      failureReason,
      callbacks,
    });
    if (repaired) return repaired;
    const payload = failedTaskPayload(request, skill, run, failureReason);
    return payload;
  }
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
  if (['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason'].includes(status)) return status;
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
  if (!baseUrl || process.env.BIOAGENT_ENABLE_AGENTSERVER_REPAIR === '0') return undefined;
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
  const diffRel = `.bioagent/task-diffs/${params.taskId}-attempt-${attempt}.diff.txt`;
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
      inputRef: params.run.spec.id ? `.bioagent/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      failureReason: repair.error,
      createdAt: new Date().toISOString(),
    });
    return undefined;
  }

  const outputRel = `.bioagent/task-results/${params.taskId}-attempt-${attempt}.json`;
  const stdoutRel = `.bioagent/logs/${params.taskId}-attempt-${attempt}.stdout.log`;
  const stderrRel = `.bioagent/logs/${params.taskId}-attempt-${attempt}.stderr.log`;
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
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-${attempt}.json`,
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
    const failureReason = firstPayloadFailureReason(payload, rerun);
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
      status: errors.length ? 'repair-needed' : payloadHasFailureStatus(payload) || rerun.exitCode !== 0 ? 'failed-with-reason' : 'done',
      codeRef: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      schemaErrors: errors,
      failureReason: errors.length ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}` : failureReason,
      createdAt: new Date().toISOString(),
    });
    if (errors.length || payloadHasFailureStatus(payload) || rerun.exitCode !== 0) {
      if (attempt < maxAttempts) {
        const nextFailureReason = errors.length
          ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}`
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
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-${attempt}.json`,
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
        proposal ? `Skill promotion proposal: .bioagent/skill-proposals/${proposal.id}` : '',
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
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-${attempt}.json`,
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
  const value = Number(process.env.BIOAGENT_AGENTSERVER_REPAIR_MAX_ATTEMPTS || 12);
  return Number.isFinite(value) ? Math.max(2, Math.min(50, Math.floor(value))) : 12;
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
  const timeoutMs = Number(process.env.BIOAGENT_AGENTSERVER_GENERATION_TIMEOUT_MS || 900000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let runPayload: unknown;
  let contextRecovery: AgentServerGenerationFailureDiagnostics | undefined;
  try {
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(params.request, params.workspace);
    const backend = agentServerBackend(params.request, llmRuntime.llmEndpoint);
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const adapter = agentBackendAdapter(backend);
    const agentId = agentServerAgentId(params.request, 'task-generation');
    for (let dispatchAttempt = 1; dispatchAttempt <= 2; dispatchAttempt += 1) {
    const preflight = await preflightAgentServerContextWindow({
      adapter,
      baseUrl: params.baseUrl,
      workspace: params.workspace,
      agentId,
      callbacks: params.callbacks,
    });
    const workspaceTree = await workspaceTreeSummary(params.workspace);
    const priorAttempts = summarizeTaskAttemptsForAgentServer(await readRecentTaskAttempts(params.workspace, params.request.skillDomain, 8, {
      scenarioPackageId: params.request.scenarioPackageRef?.id,
      skillPlanRef: params.request.skillPlanRef,
      prompt: params.request.prompt,
    }));
    const agentServerSnapshot = preflight.state?.snapshot ?? await fetchAgentServerContextSnapshot(params.baseUrl, agentId);
    const contextMode = contextEnvelopeMode(params.request, {
      agentServerCoreAvailable: Boolean(agentServerSnapshot),
      forceSlimHandoff: preflight.forceSlimHandoff || Boolean(contextRecovery),
    });
    const contextEnvelope: Record<string, unknown> = buildContextEnvelope(params.request, {
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
    const compactContext = buildAgentServerCompactContext(params.request, {
      contextEnvelope,
      workspaceTree,
      priorAttempts,
      selectedSkill: params.skill,
      skills: params.skills,
      mode: contextMode,
    });
    const generationRequest = {
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      contextEnvelope,
      workspaceTreeSummary: compactContext.workspaceTreeSummary,
      availableSkills: compactContext.availableSkills,
      artifactSchema: expectedArtifactSchema(params.request),
      uiManifestContract: { expectedKeys: ['componentId', 'artifactRef', 'encoding', 'layout', 'compare'] },
      uiStateSummary: compactContext.uiStateSummary,
      artifacts: compactContext.artifacts,
      recentExecutionRefs: compactContext.recentExecutionRefs,
      expectedArtifactTypes: expectedArtifactTypesForRequest(params.request),
      selectedComponentIds: params.request.selectedComponentIds ?? toStringList(params.request.uiState?.selectedComponentIds),
      priorAttempts: compactContext.priorAttempts,
      strictTaskFilesReason: params.strictTaskFilesReason,
      retryAudit: contextRecovery?.retryAudit,
    };
    const generationPrompt = buildAgentServerGenerationPrompt(generationRequest);
    const contextEnvelopeBytes = Buffer.byteLength(JSON.stringify(contextEnvelope), 'utf8');
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextWindowState',
      source: 'workspace-runtime',
      message: 'Estimated context window before AgentServer dispatch',
      contextWindowState: estimateWorkspaceContextWindowState({
        backend,
        modelName: llmRuntime.llmEndpoint?.modelName ?? params.request.modelName,
        maxContextWindowTokens: params.request.maxContextWindowTokens,
        usedTokens: Math.ceil((contextEnvelopeBytes + generationPrompt.length) / 4),
        source: 'estimate',
      }),
    });
    runPayload = {
      agent: {
        id: agentId,
        name: `BioAgent ${params.request.skillDomain} Task Generation`,
        backend,
        workspace: params.workspace,
        workingDirectory: params.workspace,
        reconcileExisting: true,
        systemPrompt: [
          AGENT_BACKEND_ANSWER_PRINCIPLE,
          'You generate BioAgent workspace-local task code.',
          'Write task files that accept inputPath and outputPath argv values and write a BioAgent ToolPayload JSON object.',
          'Do not create demo/default success artifacts; if the real task cannot be generated, explain the missing condition.',
        ].join(' '),
      },
      input: {
        text: generationPrompt,
        metadata: {
          project: 'BioAgent',
          purpose: 'workspace-task-generation',
          skillDomain: params.request.skillDomain,
          skillId: params.skill.id,
          expectedArtifactTypes: generationRequest.expectedArtifactTypes,
          selectedComponentIds: generationRequest.selectedComponentIds,
          priorAttemptCount: generationRequest.priorAttempts.length,
          contextEnvelopeVersion: 'bioagent.context-envelope.v1',
          contextMode: compactContext.mode,
          retryAudit: contextRecovery?.retryAudit,
          contextEnvelopeBytes,
          promptChars: generationPrompt.length,
          maxContextWindowTokens: params.request.maxContextWindowTokens,
          contextWindowLimit: params.request.maxContextWindowTokens,
          modelContextWindow: params.request.maxContextWindowTokens,
          workspaceTreeEntryCount: workspaceTree.length,
          contextWindow: preflight.state ? contextWindowMetadata(preflight.state) : undefined,
          contextCompaction: preflight.compaction ? contextCompactionMetadata(preflight.compaction) : undefined,
          backendCapabilities: adapter.capabilities,
        },
      },
      contextPolicy: agentServerContextPolicy(params.request),
      runtime: {
        backend,
        cwd: params.workspace,
        ...llmRuntime,
        metadata: {
          autoApprove: true,
          sandbox: 'danger-full-access',
          source: 'bioagent-workspace-runtime-gateway',
          purpose: 'workspace-task-generation',
          maxContextWindowTokens: params.request.maxContextWindowTokens,
          contextWindowLimit: params.request.maxContextWindowTokens,
          modelContextWindow: params.request.maxContextWindowTokens,
          requiresNativeWorkspaceCapabilities: true,
          llmEndpointSource: llmRuntime.llmEndpoint ? llmEndpointSource : undefined,
          retryAudit: contextRecovery?.retryAudit,
        },
      },
      metadata: {
        project: 'BioAgent',
        source: 'workspace-runtime-gateway',
        task: 'generation',
        workspace: params.workspace,
        workingDirectory: params.workspace,
        maxContextWindowTokens: params.request.maxContextWindowTokens,
        contextWindowLimit: params.request.maxContextWindowTokens,
        modelContextWindow: params.request.maxContextWindowTokens,
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
        modelName: llmRuntime.llmEndpoint?.modelName ?? params.request.modelName,
        maxContextWindowTokens: params.request.maxContextWindowTokens,
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
    const { json, run, error } = await readAgentServerRunStream(response, (event) => {
      emitWorkspaceRuntimeEvent(params.callbacks, withRequestContextWindowLimit(
        normalizeAgentServerWorkspaceEvent(event),
        params.request,
      ));
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
        model: llmRuntime.llmEndpoint?.modelName ?? params.request.modelName,
        request: params.request,
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
        model: llmRuntime.llmEndpoint?.modelName ?? params.request.modelName,
        request: params.request,
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
        model: llmRuntime.llmEndpoint?.modelName ?? params.request.modelName,
        request: params.request,
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
      return await finalizeAgentServerGenerationSuccess({
        result: {
        ok: true,
        runId: typeof run.id === 'string' ? run.id : undefined,
        directPayload,
        },
        contextRecovery,
        workspace: params.workspace,
        request: params.request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
    }
    const directText = extractAgentServerOutputText(run);
    const parsed = parseGenerationResponse(run.output) ?? parseGenerationResponse(run);
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
        request: params.request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
        }
        return await finalizeAgentServerGenerationSuccess({
          result: {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload: toolPayloadFromPlainAgentOutput(directText, params.request),
          },
          contextRecovery,
          workspace: params.workspace,
        request: params.request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
      }
      return { ok: false, error: 'AgentServer generation response did not include taskFiles and entrypoint or a BioAgent ToolPayload.' };
    }
    return await finalizeAgentServerGenerationSuccess({
      result: {
      ok: true,
      runId: typeof run.id === 'string' ? run.id : undefined,
      response: parsed,
      },
      contextRecovery,
      workspace: params.workspace,
      request: params.request,
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
  return parseGenerationResponse(parsed);
}

async function readAgentServerRunStream(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ json: unknown; run: Record<string, unknown>; error?: string }> {
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
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const envelopes: unknown[] = [];
  let buffer = '';
  let finalResult: unknown;
  let streamError = '';
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    const envelope = JSON.parse(line) as unknown;
    envelopes.push(envelope);
    if (!isRecord(envelope)) return;
    if ('event' in envelope) onEvent(envelope.event);
    if ('result' in envelope) finalResult = envelope.result;
    if ('error' in envelope) streamError = String(envelope.error || '');
  }
  for (;;) {
    const { value, done } = await reader.read();
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
  };
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
      type: 'agentserver-context-window-recovery',
      source: 'workspace-runtime',
      status: compactionStatus,
      message: compaction.ok
        ? 'Context compaction completed; retrying AgentServer generation once.'
        : compactionStatus === 'skipped'
          ? 'Context compact API unsupported; retrying AgentServer generation once with slim handoff diagnostics.'
          : 'Context compaction failed; retrying AgentServer generation once with slim handoff diagnostics.',
      detail: compaction.message || compaction.reason,
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
      type: 'agentserver-context-compaction',
      source: 'workspace-runtime',
      status: compaction.ok ? 'completed' : 'failed',
      message: 'AgentServer compact before provider/rate-limit retry',
      detail: compaction.message || compaction.reason,
      raw: compaction,
    });
  }

  const retryAudit: AgentServerGenerationRetryAudit = {
    schemaVersion: 'bioagent.agentserver-generation-retry.v1',
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

function classifyAgentServerBackendFailure(
  message: string,
  context: {
    httpStatus?: number;
    headers?: Headers;
    backend?: string;
    provider?: string;
    model?: string;
  } = {},
): AgentServerBackendFailureDiagnostic | undefined {
  const text = parseJsonErrorMessage(message) || message;
  const lower = text.toLowerCase();
  const categories: AgentServerBackendFailureKind[] = [];
  if (/contextwindowexceeded|context window exceeded|context_length|maximum context|token limit|context.*overflow/i.test(text)) categories.push('context-window');
  if (context.httpStatus === 429 || /\b429\b|too many requests/.test(lower)) categories.push('http-429', 'rate-limit');
  if (/rate[\s-]?limit|retry-after|reset/i.test(text)) categories.push('rate-limit');
  if (/responseTooManyFailedAttempts|too many failed attempts/i.test(text)) categories.push('too-many-failed-attempts', 'retry-budget');
  if (/exceeded retry limit|retry budget|too many retries|max retries/i.test(text)) categories.push('retry-budget');
  const uniqueCategories = uniqueStrings(categories) as AgentServerBackendFailureKind[];
  if (!uniqueCategories.length) return undefined;
  const retryAfterMs = retryAfterMsFromHeaders(context.headers) ?? retryAfterMsFromText(text);
  const resetAt = rateLimitResetAtFromHeaders(context.headers) ?? rateLimitResetAtFromText(text);
  return {
    kind: uniqueCategories[0],
    categories: uniqueCategories,
    backend: context.backend,
    provider: context.provider,
    model: context.model,
    httpStatus: context.httpStatus,
    retryAfterMs,
    resetAt,
    message: sanitizeBackendFailureDetail(text),
  };
}

function providerRateLimitDiagnosticMessage(diagnostic: AgentServerBackendFailureDiagnostic, finalFailure: boolean) {
  const labels = diagnostic.categories.join(', ');
  const provider = [diagnostic.provider, diagnostic.model].filter(Boolean).join('/') || diagnostic.backend || 'unknown provider';
  const retryAfter = diagnostic.retryAfterMs !== undefined ? ` retryAfterMs=${diagnostic.retryAfterMs}.` : '';
  const resetAt = diagnostic.resetAt ? ` resetAt=${diagnostic.resetAt}.` : '';
  const retry = finalFailure
    ? ' BioAgent already performed the single allowed compact/slim retry and will not retry again automatically.'
    : ' BioAgent will back off, compact/slim the handoff, and retry once.';
  return `AgentServer/provider failure classified as ${labels} for ${provider}.${retryAfter}${resetAt}${retry} Detail: ${diagnostic.message}`;
}

function rateLimitRecoverActions(diagnostic: AgentServerBackendFailureDiagnostic) {
  const wait = diagnostic.retryAfterMs
    ? `Wait at least ${Math.ceil(diagnostic.retryAfterMs / 1000)}s or until provider retry-after/reset before rerunning.`
    : 'Wait for the provider rate-limit or retry budget to reset before rerunning.';
  return [
    wait,
    'Reduce concurrent AgentServer runs or switch to a model/provider with available quota.',
    'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
  ];
}

function boundedRateLimitBackoffMs(diagnostic: AgentServerBackendFailureDiagnostic) {
  const configuredMax = Number(process.env.BIOAGENT_AGENTSERVER_RATE_LIMIT_BACKOFF_MAX_MS || 1500);
  const max = Number.isFinite(configuredMax) ? Math.max(0, Math.min(10_000, configuredMax)) : 1500;
  const requested = diagnostic.retryAfterMs ?? 250;
  return Math.min(max, Math.max(0, requested));
}

function retryAfterMsFromHeaders(headers?: Headers) {
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function rateLimitResetAtFromHeaders(headers?: Headers) {
  return headers?.get('x-ratelimit-reset') ?? headers?.get('x-rate-limit-reset') ?? undefined;
}

function retryAfterMsFromText(text: string) {
  const seconds = text.match(/retry-after["'\s:=]+(\d+(?:\.\d+)?)/i)?.[1]
    ?? text.match(/retry after\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/i)?.[1];
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1000)) : undefined;
}

function rateLimitResetAtFromText(text: string) {
  return text.match(/(?:resetAt|reset_at|rate limit reset)["'\s:=]+([0-9T:.\-+Z]+)/i)?.[1];
}

function sanitizeBackendFailureDetail(text: string) {
  return redactSecretText(text
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'))
    .slice(0, 320);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  const record = isRecord(raw) ? raw : {};
  const rawType = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : 'agentserver-event';
  const type = normalizeAgentServerWorkspaceEventType(rawType, record);
  const toolName = typeof record.toolName === 'string' ? record.toolName : undefined;
  const usage = normalizeWorkspaceTokenUsage(record.usage)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextCompaction = normalizeWorkspaceContextCompaction(
    record.contextCompaction ?? record.compaction ?? record.context_compaction ?? record.context_compressor ?? record.contextCompressor,
    type,
    record,
  );
  const rateLimit = normalizeWorkspaceRateLimit(
    record.rateLimit ?? record.rate_limit ?? record.rateLimitDiagnostics ?? record.rate_limit_diagnostics ?? hermesCompatRateLimitRecord(record),
    record,
  );
  const contextWindowState = normalizeWorkspaceContextWindowState(
    workspaceContextWindowCandidate(record),
    type,
    record,
  );
  const baseDetail = typeof record.detail === 'string'
    ? record.detail
    : typeof record.message === 'string'
      ? record.message
      : typeof record.text === 'string'
        ? record.text
        : typeof record.output === 'string'
        ? record.output.slice(0, 600)
        : Array.isArray(record.plan)
          ? record.plan.join(' -> ')
        : record.error !== undefined
          ? summarizeEventValue(record.error)
        : record.result !== undefined
          ? summarizeEventValue(record.result)
        : undefined;
  const usageDetail = formatWorkspaceTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    type,
    source: 'agentserver',
    toolName,
    message: toolName ? `${type}: ${toolName}` : type,
    detail,
    text: typeof record.text === 'string' ? record.text : undefined,
    output: typeof record.output === 'string' ? record.output.slice(0, 2000) : undefined,
    usage,
    contextWindowState,
    contextCompaction,
    rateLimit,
    raw,
  };
}

function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  const state = event.contextWindowState;
  const limit = request.maxContextWindowTokens;
  if (!state || state.windowTokens !== undefined || limit === undefined) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / limit : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: limit,
      windowTokens: limit,
      ratio,
      status: normalizeWorkspaceContextStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

function normalizeAgentServerWorkspaceEventType(type: string, record: Record<string, unknown>) {
  const lower = type.toLowerCase();
  if (lower === 'context_compressor' || lower === 'context-compressor') return 'contextCompaction';
  if (lower === 'ratelimit' || lower === 'rate_limit' || lower === 'rate-limit') return 'rateLimit';
  if (lower.includes('context_compressor') || record.context_compressor || record.contextCompressor) return 'contextCompaction';
  if (lower.includes('rate-limit') || lower.includes('rate_limit') || record.rate_limit || record.rateLimit || record.rate_limit_reset || record.rate_limit_reset_at) return 'rateLimit';
  return type;
}

function normalizeWorkspaceContextWindowState(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = firstFiniteNumber(record.input, record.inputTokens, record.prompt_tokens, usage.input, usage.inputTokens, usage.promptTokens, usage.prompt_tokens);
  const output = firstFiniteNumber(record.output, record.outputTokens, record.completion_tokens, usage.output, usage.outputTokens, usage.completionTokens, usage.completion_tokens);
  const cacheRead = firstFiniteNumber(record.cacheRead, record.cache_read, record.cacheReadTokens, usage.cacheRead, usage.cache_read, usage.cacheReadTokens);
  const cacheWrite = firstFiniteNumber(record.cacheWrite, record.cache_write, record.cacheWriteTokens, usage.cacheWrite, usage.cache_write, usage.cacheWriteTokens);
  const cache = firstFiniteNumber(record.cache, record.cacheTokens, record.cache_tokens, usage.cache, usage.cacheTokens, usage.cache_tokens)
    ?? (cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const explicitUsedTokens = finiteNumber(record.usedTokens)
    ?? finiteNumber(record.used_tokens)
    ?? finiteNumber(record.used)
    ?? finiteNumber(record.contextWindowTokens)
    ?? finiteNumber(record.context_window_tokens)
    ?? finiteNumber(record.currentContextWindowTokens)
    ?? finiteNumber(record.current_context_window_tokens)
    ?? finiteNumber(record.contextLength)
    ?? finiteNumber(record.context_length)
    ?? finiteNumber(record.currentContextLength)
    ?? finiteNumber(record.current_context_length)
    ?? finiteNumber(record.tokens);
  const usedTokens = explicitUsedTokens;
  const windowTokens = finiteNumber(record.windowTokens)
    ?? finiteNumber(record.window_tokens)
    ?? finiteNumber(record.window)
    ?? finiteNumber(record.contextWindowLimit)
    ?? finiteNumber(record.context_window_limit)
    ?? finiteNumber(record.limit)
    ?? finiteNumber(record.contextWindow)
    ?? finiteNumber(record.maxContextLength)
    ?? finiteNumber(record.max_context_length)
    ?? finiteNumber(record.contextLimit)
    ?? finiteNumber(record.context_limit);
  const ratio = finiteNumber(record.ratio)
    ?? finiteNumber(record.contextWindowRatio)
    ?? finiteNumber(record.context_window_ratio)
    ?? finiteNumber(record.usageRatio)
    ?? finiteNumber(record.usage_ratio)
    ?? (usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined);
  const rawAutoCompactThreshold = finiteNumber(record.autoCompactThreshold)
    ?? finiteNumber(record.auto_compact_threshold)
    ?? finiteNumber(record.compressionThreshold)
    ?? finiteNumber(record.compression_threshold);
  const autoCompactThreshold = rawAutoCompactThreshold && rawAutoCompactThreshold > 1 && windowTokens
    ? rawAutoCompactThreshold / windowTokens
    : rawAutoCompactThreshold;
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || finiteNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = stringField(record.source) ?? stringField(record.contextWindowSource) ?? stringField(record.context_window_source);
  const source = explicitSource
    ? (normalizeWorkspaceContextSource(explicitSource) === 'unknown' && hasUsage ? 'provider-usage' : normalizeWorkspaceContextSource(explicitSource))
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: stringField(record.backend) ?? stringField(fallback.backend) ?? stringField(usage.provider),
    provider: stringField(record.provider) ?? stringField(usage.provider),
    model: stringField(record.model) ?? stringField(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeWorkspaceContextStatus(stringField(record.status), ratio, autoCompactThreshold),
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability)),
    budget: isRecord(record.budget) ? record.budget : undefined,
    auditRefs: toStringList(record.auditRefs),
    autoCompactThreshold,
    watchThreshold: finiteNumber(record.watchThreshold),
    nearLimitThreshold: finiteNumber(record.nearLimitThreshold),
    lastCompactedAt: stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry
    ? state
    : undefined;
}

function workspaceContextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? record.context_compressor
    ?? record.contextCompressor
    ?? (isExplicitWorkspaceContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitWorkspaceContextWindowRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [
    'usedTokens',
    'used_tokens',
    'contextWindowTokens',
    'context_window_tokens',
    'currentContextWindowTokens',
    'current_context_window_tokens',
    'contextLength',
    'context_length',
    'currentContextLength',
    'current_context_length',
    'windowTokens',
    'window_tokens',
    'contextWindowLimit',
    'context_window_limit',
    'modelContextWindow',
    'model_context_window',
    'contextWindowRatio',
    'context_window_ratio',
    'contextWindowSource',
    'context_window_source',
  ].some((key) => key in value);
}

function normalizeWorkspaceContextCompaction(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const status = normalizeWorkspaceCompactionStatus(stringField(record.status) ?? stringField(record.result));
  const completedAt = stringField(record.completedAt) ?? stringField(record.completed_at) ?? stringField(record.compressedAt) ?? stringField(record.compressed_at);
  const lastCompactedAt = stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at) ?? completedAt;
  const reason = stringField(record.reason) ?? stringField(record.trigger);
  const message = stringField(record.message) ?? stringField(record.summary);
  return {
    status,
    source: normalizeWorkspaceContextSource(stringField(record.source) ?? 'native'),
    backend: stringField(record.backend) ?? stringField(fallback.backend) ?? 'hermes-agent',
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability) ?? 'native'),
    startedAt: stringField(record.startedAt) ?? stringField(record.started_at),
    completedAt,
    lastCompactedAt,
    reason,
    message,
  };
}

function normalizeWorkspaceCompactionStatus(value?: string): NonNullable<WorkspaceRuntimeEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /start|running|compact/i.test(value) && !/complete|done|success|compressed/i.test(value)) return 'started';
  if (value && /skip|unsupported/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compressed/i.test(value)) return 'completed';
  return 'completed';
}

function normalizeWorkspaceRateLimit(
  value: unknown,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['rateLimit'] | undefined {
  const record = isRecord(value) ? value : {};
  const rateLimit = {
    limited: typeof record.limited === 'boolean'
      ? record.limited
      : typeof record.rate_limited === 'boolean'
        ? record.rate_limited
        : undefined,
    retryAfterMs: finiteNumber(record.retryAfterMs) ?? finiteNumber(record.retry_after_ms) ?? retryAfterMsFromText(JSON.stringify(record)),
    resetAt: stringField(record.resetAt)
      ?? stringField(record.reset_at)
      ?? stringField(record.rateLimitResetAt)
      ?? stringField(record.rate_limit_reset_at)
      ?? stringField(record.rate_limit_reset)
      ?? stringField(fallback.rate_limit_reset_at)
      ?? stringField(fallback.rate_limit_reset),
    provider: stringField(record.provider) ?? stringField(fallback.provider),
    model: stringField(record.model) ?? stringField(fallback.model),
    backend: stringField(record.backend) ?? stringField(fallback.backend),
    source: stringField(record.source) ?? 'agentserver',
  };
  return rateLimit.limited !== undefined || rateLimit.retryAfterMs !== undefined || rateLimit.resetAt ? rateLimit : undefined;
}

function normalizeWorkspaceContextSource(value?: string): WorkspaceRuntimeContextWindowSource {
  if (value === 'native' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider' || value === 'provider-usage') return 'native';
  if (value === 'backend') return 'native';
  if (value === 'agentserver-estimate') return 'estimate';
  if (value === 'handoff') return 'agentserver';
  return 'unknown';
}

function normalizeWorkspaceCompactCapability(value?: string): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['compactCapability'] {
  if (value === 'handoff-only') return 'handoff-slimming';
  if (value === 'native' || value === 'agentserver' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

function normalizeWorkspaceContextStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['status'] {
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

function normalizeWorkspaceTokenUsage(value: unknown): WorkspaceRuntimeEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: finiteNumber(value.input),
    output: finiteNumber(value.output),
    total: finiteNumber(value.total),
    cacheRead: finiteNumber(value.cacheRead),
    cacheWrite: finiteNumber(value.cacheWrite),
    provider: stringField(value.provider),
    model: stringField(value.model),
    source: stringField(value.source),
  };
  if (
    usage.input === undefined
    && usage.output === undefined
    && usage.total === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) {
    return undefined;
  }
  return usage;
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

function formatWorkspaceTokenUsage(usage: WorkspaceRuntimeEvent['usage'] | undefined) {
  if (!usage) return undefined;
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

function summarizeEventValue(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 1200);
  try {
    return JSON.stringify(redactSecrets(value)).slice(0, 1200);
  } catch {
    return String(value).slice(0, 1200);
  }
}

async function requestAgentServerRepair(params: {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}): Promise<{ ok: true; runId?: string; diffSummary?: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.BIOAGENT_AGENTSERVER_REPAIR_TIMEOUT_MS || 900000);
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
        name: `BioAgent ${params.request.skillDomain} Runtime Repair`,
        backend,
        workspace: params.run.workspace,
        workingDirectory: params.run.workspace,
        reconcileExisting: true,
        systemPrompt: [
          AGENT_BACKEND_ANSWER_PRINCIPLE,
          'You repair BioAgent workspace-local task code.',
          'Edit the referenced task file or adjacent helper files in the workspace, then stop.',
          'Preserve the task contract: task receives inputPath and outputPath argv values and writes a BioAgent ToolPayload JSON object.',
          'Do not create demo/default success artifacts; if the real task cannot be repaired, explain the missing condition.',
        ].join(' '),
      },
      input: {
        text: repairPrompt,
        metadata: {
          project: 'BioAgent',
          purpose: 'workspace-task-repair',
          skillDomain: params.request.skillDomain,
          skillId: params.skill.id,
          codeRef: params.run.spec.taskRel,
          stdoutRef: params.run.stdoutRef,
          stderrRef: params.run.stderrRef,
          outputRef: params.run.outputRef,
          schemaErrors: params.schemaErrors,
          repairContextVersion: 'bioagent.repair-context.v1',
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
          source: 'bioagent-workspace-runtime-gateway',
          llmEndpointSource: llmRuntime.llmEndpoint ? llmEndpointSource : undefined,
        },
      },
      metadata: {
        project: 'BioAgent',
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

async function readConfiguredAgentServerBaseUrl(workspace: string) {
  try {
    const parsed = JSON.parse(await readFile(join(workspace, '.bioagent', 'config.json'), 'utf8'));
    if (isRecord(parsed) && typeof parsed.agentServerBaseUrl === 'string') {
      return cleanUrl(parsed.agentServerBaseUrl);
    }
  } catch {
    // No persisted UI config is available for this workspace yet.
  }
  return undefined;
}

async function writeAgentServerDebugArtifact(
  workspace: string,
  task: 'generation' | 'repair',
  requestPayload: unknown,
  responseStatus: number,
  responseBody: unknown,
) {
  try {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task}-${sha1(JSON.stringify(requestPayload)).slice(0, 8)}`;
    const rel = join('.bioagent', 'debug', 'agentserver', `${id}.json`);
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

function redactSecrets(value: unknown): unknown {
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

async function agentServerLlmRuntime(request: GatewayRequest, workspace: string): Promise<{
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
  const fromWorkspace = await readConfiguredLlmEndpoint(join(workspace, '.bioagent', 'config.json'), 'workspace-config');
  if (fromWorkspace) return fromWorkspace;
  return {};
}

function hasExplicitRequestLlmConfig(request: GatewayRequest) {
  return typeof request.modelProvider === 'string'
    || typeof request.modelName === 'string'
    || request.llmEndpoint !== undefined;
}

function requiresUserLlmEndpoint(agentServerBaseUrl: string) {
  if (process.env.BIOAGENT_ALLOW_AGENTSERVER_DEFAULT_LLM === '1') return false;
  try {
    const url = new URL(agentServerBaseUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && url.port === '18080';
  } catch {
    return false;
  }
}

function missingUserLlmEndpointMessage() {
  return [
    'User-side model configuration is required before using the default local AgentServer.',
    'Set Model Provider, Model Base URL, Model Name, and API Key in BioAgent settings so the request-selected llmEndpoint is forwarded.',
    'BioAgent will not fall back to AgentServer openteam.json defaults for this path.',
  ].join(' ');
}

async function buildCompactRepairContext(params: {
  request: GatewayRequest;
  workspace: string;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}) {
  const taskAbs = join(params.workspace, params.run.spec.taskRel);
  const inputRel = `.bioagent/task-inputs/${params.run.spec.id}.json`;
  const [code, stdout, stderr, output, input] = await Promise.all([
    readTextIfExists(taskAbs),
    readTextIfExists(join(params.workspace, params.run.stdoutRef)),
    readTextIfExists(join(params.workspace, params.run.stderrRef)),
    readTextIfExists(join(params.workspace, params.run.outputRef)),
    readTextIfExists(join(params.workspace, inputRel)),
  ]);
  const failureEvidence = `${params.failureReason}\n${stderr}\n${stdout}`;
  return {
    version: 'bioagent.repair-context.v1',
    createdAt: new Date().toISOString(),
    projectFacts: {
      project: 'BioAgent',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      taskCodePolicy: 'Generated tasks live in workspace .bioagent/tasks and must be runnable from inputPath/outputPath.',
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
      stderrTail: tailForAgentServer(stderr, 8000),
      stdoutTail: tailForAgentServer(stdout, 4000),
      outputHead: headForAgentServer(output, 4000),
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

async function readConfiguredLlmEndpoint(path: string, source: string): Promise<{
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

function buildAgentServerRepairPrompt(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
  repairContext?: Record<string, unknown>;
}) {
  return [
    'Repair this BioAgent workspace task and leave the workspace ready for BioAgent to rerun it.',
    'Use the compact repair context below: it contains the current user goal, workspace refs, failure evidence, and relevant code/log excerpts.',
    'Edit the referenced task file or adjacent helper files only as needed. BioAgent will rerun the task after you finish.',
    'The repaired task must execute the user goal end-to-end, not merely generate code or report that code was generated.',
    'Preserve failureReason in the next ToolPayload only if the real blocker remains after repair.',
    'Do not fabricate success or replace the user goal with an unrelated demo task.',
    '',
    JSON.stringify({
      repairContext: params.repairContext,
      expectedPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    }, null, 2),
    '',
    'Return a concise summary of files changed, tests or commands run, and any remaining blocker.',
  ].join('\n');
}

function buildAgentServerGenerationPrompt(request: {
  prompt: string;
  skillDomain: BioAgentSkillDomain;
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
  artifactSchema: Record<string, unknown>;
  uiManifestContract: Record<string, unknown>;
  uiStateSummary?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  recentExecutionRefs?: Array<Record<string, unknown>>;
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  priorAttempts: unknown[];
  strictTaskFilesReason?: string;
  retryAudit?: AgentServerGenerationRetryAudit;
}) {
  return [
    request.contextEnvelope ? JSON.stringify({
      version: request.contextEnvelope.version,
      workspaceFacts: Boolean(request.contextEnvelope.workspaceFacts),
      longTermRefs: Boolean(request.contextEnvelope.longTermRefs),
    }, null, 2) : '',
    'Handle this BioAgent request as the agent backend decision-maker.',
    'AgentServer owns orchestration, domain reasoning, tool choice, continuation, and repair strategy. BioAgent only validates protocol, runs returned workspace tasks, persists refs/artifacts, and reports contract failures.',
    'First infer the current-turn intent from prompt, recentConversation, priorAttempts, artifacts, recentExecutionRefs, and workspace refs. BioAgent is only the protocol/execution layer; you decide whether to answer, continue, repair, rerun, retrieve, or generate new workspace task code.',
    'Return exactly one JSON object, with no markdown before or after it.',
    'If the user only needs an answer from existing context, return a valid BioAgent ToolPayload JSON directly, preserving useful existing artifacts/refs.',
    'If the user asks to continue, repair, rerun, retrieve, analyze files, or produce artifacts, return JSON matching AgentServerGenerationResponse: taskFiles, entrypoint, environmentRequirements, validationCommand, expectedArtifacts, and patchSummary.',
    'Hard contract: taskFiles MUST be an array of objects with path, language, and non-empty content unless the file was physically written in the workspace before returning. Never return taskFiles as string paths only.',
    'Hard contract: entrypoint.path MUST reference one of the returned taskFiles or a file that was physically written in the workspace before returning.',
    'If you physically write task files into the workspace, prefer a compact path-only taskFiles object (path + language, content may be omitted/empty) and return JSON immediately. Do not cat/read full generated source back into the final response just to inline it.',
    'Final output must be only compact JSON: either AgentServerGenerationResponse or BioAgent ToolPayload.',
    'When returning a BioAgent ToolPayload, use displayIntent to describe the user-visible view need, and objectReferences to cite key artifacts/files/runs that the user can click on demand.',
    'objectReferences refs must use controlled prefixes: artifact:*, file:*, folder:*, run:*, execution-unit:*, scenario-package:*, or url:*.',
    request.strictTaskFilesReason
      ? `Strict retry reason: ${request.strictTaskFilesReason}`
      : '',
    'If a prior task already exists and the user asks to continue, repair, or rerun it, prefer returning taskFiles that reference that existing workspace task path or a minimal patched task instead of starting an unrelated fresh analysis.',
    'Generate fresh task code only when the current turn truly asks for new work or no prior executable artifact can satisfy the request.',
    'Put generated task paths under .bioagent/tasks when possible. BioAgent will archive any returned taskFiles under .bioagent/tasks/<run-id>/ before execution.',
    'Prefer installed or workspace tools when they genuinely fit, but write adapter code as needed so the run is reproducible from inputPath and outputPath.',
    'Large-file contract: uploaded PDFs, images, spreadsheets, binary blobs, extracted full text, and large logs must stay as workspace refs. Do not inline base64, do not print full extracted text to stdout/stderr, and do not paste full document text into final JSON.',
    'For uploaded PDFs or long documents, generated tasks should read the file by path/dataRef, write any full extraction to .bioagent/artifacts or .bioagent/task-results, and return only bounded excerpts, section summaries, page/figure locators, hashes, and clickable file/artifact refs.',
    'If expectedArtifactTypes contains multiple artifacts, generate a coordinated Python task or small Python module set that emits every requested artifact type. A partial seed skill result is not enough unless the missing artifact has a clear failed-with-reason ExecutionUnit.',
    'Use the selectedComponentIds/UI contract to preserve promised UI slots; do not drop report, table, graph, structure, omics, or execution outputs just because one local skill only produces a subset.',
    'For continuation requests, continue the scenario goal using recentConversation, artifacts, recentExecutionRefs, and priorAttempts. Do not restart an unrelated analysis.',
    'For repair requests, inspect the failureReason plus stdoutRef/stderrRef/outputRef/codeRef and report whether logs are readable before editing or rerunning.',
    'If a required input, remote file, credential, or executable is missing, write a valid ToolPayload with executionUnits.status="failed-with-reason" and a precise failureReason instead of fabricating outputs.',
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

function summarizeSkillsForAgentServer(
  skills: SkillAvailability[],
  selectedSkill: SkillAvailability,
  skillDomain: BioAgentSkillDomain,
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

function summarizeTaskAttemptsForAgentServer(attempts: unknown[]) {
  return attempts
    .filter(isRecord)
    .slice(0, 4)
    .map((attempt) => ({
      id: typeof attempt.id === 'string' ? attempt.id : undefined,
      attempt: typeof attempt.attempt === 'number' ? attempt.attempt : undefined,
      status: typeof attempt.status === 'string' ? attempt.status : undefined,
      skillDomain: typeof attempt.skillDomain === 'string' ? attempt.skillDomain : undefined,
      skillId: typeof attempt.skillId === 'string' ? attempt.skillId : undefined,
      codeRef: typeof attempt.codeRef === 'string' ? attempt.codeRef : undefined,
      inputRef: typeof attempt.inputRef === 'string' ? attempt.inputRef : undefined,
      outputRef: typeof attempt.outputRef === 'string' ? attempt.outputRef : undefined,
      stdoutRef: typeof attempt.stdoutRef === 'string' ? attempt.stdoutRef : undefined,
      stderrRef: typeof attempt.stderrRef === 'string' ? attempt.stderrRef : undefined,
      failureReason: clipForAgentServerPrompt(attempt.failureReason, 800),
      schemaErrors: Array.isArray(attempt.schemaErrors)
        ? attempt.schemaErrors.map((entry) => clipForAgentServerPrompt(entry, 240)).filter(Boolean).slice(0, 8)
        : undefined,
      patchSummary: clipForAgentServerPrompt(attempt.patchSummary, 800),
      diffRef: typeof attempt.diffRef === 'string' ? attempt.diffRef : undefined,
      scenarioPackageRef: isRecord(attempt.scenarioPackageRef) ? attempt.scenarioPackageRef : undefined,
      skillPlanRef: typeof attempt.skillPlanRef === 'string' ? attempt.skillPlanRef : undefined,
      uiPlanRef: typeof attempt.uiPlanRef === 'string' ? attempt.uiPlanRef : undefined,
      createdAt: typeof attempt.createdAt === 'string' ? attempt.createdAt : undefined,
    }));
}

function buildAgentServerCompactContext(
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

function contextEnvelopeMode(
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

function summarizeUiStateForAgentServer(uiState: unknown, mode: AgentServerContextMode) {
  if (!isRecord(uiState)) return undefined;
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
    scopeCheck: isRecord(uiState.scopeCheck) ? clipForAgentServerJson(uiState.scopeCheck, 3) : undefined,
    selectedComponentIds: toStringList(uiState.selectedComponentIds),
    recentRuns: Array.isArray(uiState.recentRuns)
      ? uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2))
      : undefined,
    contextMode: mode,
  };
}

function summarizeArtifactRefs(artifacts: Array<Record<string, unknown>>) {
  return artifacts.slice(-8).map((artifact) => {
    const id = typeof artifact.id === 'string' ? artifact.id : undefined;
    const type = typeof artifact.type === 'string' ? artifact.type : undefined;
    const title = typeof artifact.title === 'string'
      ? artifact.title
      : typeof artifact.name === 'string'
        ? artifact.name
        : undefined;
    return {
      id,
      type,
      title: clipForAgentServerPrompt(title, 240),
      ref: typeof artifact.ref === 'string' ? artifact.ref : undefined,
      path: typeof artifact.path === 'string' ? artifact.path : undefined,
      outputRef: typeof artifact.outputRef === 'string' ? artifact.outputRef : undefined,
      keys: Object.keys(artifact).slice(0, 12),
      hash: hashJson(artifact),
    };
  });
}

function summarizeExecutionRefs(refs: Array<Record<string, unknown>>) {
  return refs.slice(-12).map((entry) => ({
    id: typeof entry.id === 'string' ? entry.id : undefined,
    status: typeof entry.status === 'string' ? entry.status : undefined,
    tool: typeof entry.tool === 'string' ? entry.tool : undefined,
    codeRef: typeof entry.codeRef === 'string' ? entry.codeRef : undefined,
    inputRef: typeof entry.inputRef === 'string' ? entry.inputRef : undefined,
    outputRef: typeof entry.outputRef === 'string' ? entry.outputRef : undefined,
    stdoutRef: typeof entry.stdoutRef === 'string' ? entry.stdoutRef : undefined,
    stderrRef: typeof entry.stderrRef === 'string' ? entry.stderrRef : undefined,
    failureReason: clipForAgentServerPrompt(entry.failureReason, 480),
    hash: hashJson(entry),
  }));
}

function buildContextEnvelope(
  request: GatewayRequest,
  params: {
    workspace: string;
    workspaceTreeSummary?: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }>;
    priorAttempts?: unknown[];
    selectedSkill?: SkillAvailability;
    repairRefs?: Record<string, unknown>;
    mode?: AgentServerContextMode;
    agentId?: string;
    agentServerCoreSnapshotAvailable?: boolean;
  },
) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const recentExecutionRefs = toRecordList(uiState.recentExecutionRefs);
  const recentConversation = toStringList(uiState.recentConversation);
  const mode = params.mode ?? contextEnvelopeMode(request);
  const workspaceTree = params.workspaceTreeSummary ?? [];
  const artifactRefs = summarizeArtifactRefs(request.artifacts);
  const executionRefs = summarizeExecutionRefs(recentExecutionRefs);
  const visibleRecentConversation = recentConversation
    .slice(mode === 'full' ? -6 : -4)
    .map((entry) => clipForAgentServerPrompt(entry, mode === 'full' ? 900 : 700))
    .filter(Boolean);
  return {
    version: 'bioagent.context-envelope.v1',
    mode,
    createdAt: new Date().toISOString(),
    hashes: {
      workspaceTree: hashJson(workspaceTree),
      artifacts: hashJson(request.artifacts),
      recentExecutionRefs: hashJson(recentExecutionRefs),
      priorAttempts: hashJson(params.priorAttempts ?? []),
    },
    projectFacts: mode === 'full' ? {
      project: 'BioAgent',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      taskCodePolicy: 'Generate or repair task code in the active workspace; do not rely on fixed source-tree scientific task scripts.',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    } : {
      project: 'BioAgent',
      taskCodePolicyRef: 'bioagent.generated-task.v1',
      toolPayloadContractRef: 'bioagent.toolPayload.v1',
    },
    orchestrationBoundary: {
      decisionOwner: 'AgentServer',
      bioAgentRole: 'protocol validation, workspace execution, artifact/ref persistence, repair request dispatch, and UI display only',
      currentUserRequestIsAuthoritative: true,
      agentId: params.agentId,
      agentServerCoreSnapshotAvailable: params.agentServerCoreSnapshotAvailable === true,
      contextModeReason: mode === 'delta'
        ? 'BioAgent sent compact delta refs plus hashes for a multi-turn backend session.'
        : 'BioAgent sent a full handoff because AgentServer Core context was unavailable or the turn had no reusable session refs.',
    },
    workspaceFacts: mode === 'full' ? {
      workspacePath: params.workspace,
      bioagentDir: '.bioagent',
      taskDir: '.bioagent/tasks/',
      taskResultDir: '.bioagent/task-results/',
      logDir: '.bioagent/logs/',
      artifactDir: '.bioagent/artifacts/',
      workspaceTreeSummary: mode === 'full' ? workspaceTree : undefined,
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    } : {
      workspacePath: params.workspace,
      dirs: {
        task: '.bioagent/tasks/',
        result: '.bioagent/task-results/',
        log: '.bioagent/logs/',
        artifact: '.bioagent/artifacts/',
      },
      workspaceTreeHash: hashJson(workspaceTree),
      workspaceTreeEntryCount: workspaceTree.length,
    },
    scenarioFacts: {
      skillDomain: request.skillDomain,
      scenarioPackageRef: request.scenarioPackageRef,
      skillPlanRef: request.skillPlanRef,
      uiPlanRef: request.uiPlanRef,
      expectedArtifactTypes: expectedArtifactTypesForRequest(request),
      selectedComponentIds: selectedComponentIdsForRequest(request),
      selectedSkill: params.selectedSkill ? {
        id: params.selectedSkill.id,
        kind: params.selectedSkill.kind,
        entrypointType: params.selectedSkill.manifest.entrypoint.type,
        manifestPath: params.selectedSkill.manifestPath,
      } : undefined,
    },
    sessionFacts: {
      sessionId: typeof uiState.sessionId === 'string' ? uiState.sessionId : undefined,
      currentPrompt: typeof uiState.currentPrompt === 'string' ? uiState.currentPrompt : request.prompt,
      currentUserRequest: currentUserRequestText(request.prompt),
      recentConversation: visibleRecentConversation,
      recentRuns: Array.isArray(uiState.recentRuns)
        ? (mode === 'full' ? uiState.recentRuns : uiState.recentRuns.slice(-4).map((entry) => clipForAgentServerJson(entry, 2)))
        : undefined,
    },
    longTermRefs: {
      artifacts: artifactRefs,
      recentExecutionRefs: executionRefs,
      priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts ?? []).slice(0, mode === 'full' ? 4 : 2),
      repairRefs: params.repairRefs,
    },
    continuityRules: mode === 'full' ? [
      'Use workspace refs as the source of truth for files, logs, generated code, and artifacts.',
      'Use recentConversation only to infer current intent.',
      'For continuation or repair requests, continue from priorAttempts/artifacts instead of restarting an unrelated task.',
      'If a requested local ref does not exist, say so explicitly and point to the nearest available output/log/artifact ref.',
    ] : [
      'Workspace refs are source of truth.',
      'Continue from recentExecutionRefs/artifacts; answer missing refs honestly.',
    ],
  };
}

async function workspaceTreeSummary(workspace: string) {
  const root = resolve(workspace);
  const out: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }> = [];
  async function walk(dir: string, prefix = '') {
    if (out.length >= 80) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 80) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: rel, kind: 'folder' });
        if (rel.split('/').length < 3) await walk(path, rel);
      } else if (entry.isFile()) {
        let sizeBytes = 0;
        try {
          sizeBytes = (await stat(path)).size;
        } catch {
          // Size is optional.
        }
        out.push({ path: rel, kind: 'file', sizeBytes });
      }
    }
  }
  await walk(root);
  return out;
}

function expectedArtifactSchema(request: GatewayRequest | BioAgentSkillDomain): Record<string, unknown> {
  const skillDomain = typeof request === 'string' ? request : request.skillDomain;
  const types = typeof request === 'string' ? [] : expectedArtifactTypesForRequest(request);
  if (types.length) return { types };
  if (skillDomain === 'literature') return { type: 'paper-list' };
  if (skillDomain === 'structure') return { type: 'structure-summary' };
  if (skillDomain === 'omics') return { type: 'omics-differential-expression' };
  return { type: 'knowledge-graph' };
}

function parseGenerationResponse(value: unknown): AgentServerGenerationResponse | undefined {
  const candidates = [
    value,
    isRecord(value) ? value.result : undefined,
    isRecord(value) ? value.text : undefined,
    isRecord(value) ? value.finalText : undefined,
    isRecord(value) ? value.handoffSummary : undefined,
    isRecord(value) ? value.outputSummary : undefined,
    ...structuredTextCandidates(value),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractStandaloneJson(candidate) ?? extractJson(candidate) : candidate;
    if (isRecord(parsed)) {
      const taskFiles = Array.isArray(parsed.taskFiles)
        ? parsed.taskFiles
          .map((file) => {
            if (!isRecord(file)) return undefined;
            return file;
          })
          .filter(isRecord)
        : [];
      const entrypoint = normalizeGenerationEntrypoint(parsed.entrypoint);
      if (taskFiles.length && typeof entrypoint.path === 'string') {
        return {
          taskFiles: taskFiles.map((file) => ({
            path: String(file.path || ''),
            content: String(file.content || ''),
            language: String(file.language || 'python'),
          })),
          entrypoint: {
            language: entrypoint.language === 'r' || entrypoint.language === 'shell' || entrypoint.language === 'cli' ? entrypoint.language : 'python',
            path: String(entrypoint.path),
            command: typeof entrypoint.command === 'string' ? entrypoint.command : undefined,
            args: Array.isArray(entrypoint.args) ? entrypoint.args.map(String) : undefined,
          },
          environmentRequirements: isRecord(parsed.environmentRequirements) ? parsed.environmentRequirements : {},
          validationCommand: String(parsed.validationCommand || ''),
          expectedArtifacts: normalizeExpectedArtifactNames(parsed.expectedArtifacts),
          patchSummary: typeof parsed.patchSummary === 'string' ? parsed.patchSummary : undefined,
        };
      }
    }
  }
  return undefined;
}

function structuredTextCandidates(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 5 || item === null || item === undefined || seen.has(item)) return;
    if (typeof item === 'string') {
      out.push(item);
      return;
    }
    if (!isRecord(item) && !Array.isArray(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    for (const key of ['finalText', 'handoffSummary', 'outputSummary', 'result', 'text', 'output', 'data', 'run', 'stages']) {
      visit(item[key], depth + 1);
    }
  };
  visit(value, 0);
  return uniqueStrings(out);
}

function normalizeExpectedArtifactNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (isRecord(entry)) return stringField(entry.type) ?? stringField(entry.id) ?? JSON.stringify(entry);
    return String(entry);
  });
}

type NormalizedGenerationEntrypoint = {
  language?: WorkspaceTaskRunResult['spec']['language'] | string;
  path?: string;
  command?: string;
  args?: unknown[];
};

function normalizeGenerationEntrypoint(value: unknown): NormalizedGenerationEntrypoint {
  if (typeof value === 'string' && value.trim()) {
    const command = value.trim();
    const path = extractEntrypointPath(command) ?? command;
    return {
      language: inferLanguageFromEntrypoint(command),
      path,
      command,
      args: extractEntrypointArgs(command, path),
    };
  }
  if (isRecord(value)) {
    const path = typeof value.path === 'string' ? extractEntrypointPath(value.path) ?? value.path : undefined;
    const command = typeof value.command === 'string' ? value.command : undefined;
    const resolvedPath = path ?? extractEntrypointPath(command);
    return {
      path: resolvedPath,
      command,
      args: Array.isArray(value.args) ? value.args : extractEntrypointArgs(command, resolvedPath),
      language: typeof value.language === 'string' ? value.language : inferLanguageFromEntrypoint(resolvedPath ?? command),
    };
  }
  return {};
}

function extractEntrypointArgs(command: unknown, path: unknown) {
  const commandText = typeof command === 'string' ? command.trim() : '';
  if (!commandText) return undefined;
  const tokens = splitCommandLine(commandText);
  if (tokens.length === 0) return undefined;
  const pathText = typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '';
  let start = 0;
  if (tokens[start] && /^(?:python(?:\d(?:\.\d+)?)?|python3|Rscript|bash|sh|node|tsx)$/.test(tokens[start])) {
    start += 1;
  }
  if (tokens[start]) {
    const tokenPath = tokens[start].replace(/^\.\//, '');
    if (!pathText || tokenPath === pathText || tokenPath.endsWith(`/${pathText}`) || pathText.endsWith(`/${tokenPath}`)) {
      start += 1;
    }
  }
  const args = tokens.slice(start);
  return args.length ? args : undefined;
}

function splitCommandLine(command: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function extractEntrypointPath(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  const token = text.match(/(?:^|\s)(\.?\/?\.bioagent\/tasks\/[^\s"'<>]+\.(?:py|R|r|sh))(?:\s|$)/)?.[1]
    ?? text.match(/(?:^|\s)([^\s"'<>]+\.(?:py|R|r|sh))(?:\s|$)/)?.[1];
  return token ? token.replace(/^\.\//, '') : undefined;
}

function inferLanguageFromEntrypoint(value: unknown): WorkspaceTaskRunResult['spec']['language'] {
  const text = typeof value === 'string' ? value : '';
  if (/\.r(?:\s|$)/i.test(text) || /\bRscript\b/.test(text)) return 'r';
  if (/\.sh(?:\s|$)/i.test(text) || /\b(?:bash|sh)\b/.test(text)) return 'shell';
  return 'python';
}

function parseToolPayloadResponse(run: Record<string, unknown>): ToolPayload | undefined {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates: unknown[] = [
    output.payload,
    output.toolPayload,
    output.data,
    output.result,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [
        result.payload,
        result.toolPayload,
        result.finalText,
        result.handoffSummary,
        result.output,
      ];
    }),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractStandaloneJson(candidate) : candidate;
    if (!isRecord(parsed) || !looksLikeToolPayloadCandidate(parsed)) continue;
    const payload = coerceAgentServerToolPayload(parsed);
    if (payload) return payload;
  }
  return undefined;
}

function looksLikeToolPayloadCandidate(value: Record<string, unknown>) {
  return isToolPayload(value)
    || Array.isArray(value.artifacts)
    || Array.isArray(value.executionUnits)
    || Array.isArray(value.claims)
    || Array.isArray(value.uiManifest);
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

function parseJsonErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON; keep the raw text for sanitization.
  }
  return undefined;
}

function sanitizeAgentServerError(text: string) {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || text;
  const providerDiagnostic = classifyAgentServerBackendFailure(firstLine);
  if (providerDiagnostic) return providerRateLimitDiagnosticMessage(providerDiagnostic, false);
  if (/429|too many requests|responseTooManyFailedAttempts|exceeded retry limit/i.test(firstLine)) {
    return '上游模型/AgentServer 返回 429 Too Many Requests 或 exceeded retry limit；这更像速率限制/重试预算耗尽，不是典型 context window 超限。请稍后重试，或降低并发与本轮上下文体积。';
  }
  if (/context window|maximum context|context length|token limit/i.test(firstLine)) {
    return '上游模型报告 context window/token limit 超限；需要压缩历史上下文、减少 artifacts/logs，或改用更大上下文模型。';
  }
  return redactSecretText(firstLine
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'))
    .slice(0, 320);
}

function isContextWindowExceededError(text: string) {
  return /contextWindowExceeded|context window|maximum context|context length|token limit|tokens? exceeded|context.*exceed|input.*too long/i.test(text)
    && !isRateLimitError(text);
}

function isRateLimitError(text: string) {
  return /429|too many requests|responseTooManyFailedAttempts|exceeded retry limit|rate.?limit/i.test(text);
}

function agentServerSessionRef(baseUrl: string, agentId: string) {
  return `${cleanUrl(baseUrl)}/api/agent-server/agents/${encodeURIComponent(agentId)}`;
}

function agentServerRequestFailureMessage(operation: 'generation' | 'repair', error: unknown, timeoutMs: number) {
  const message = errorMessage(error);
  if (isAbortError(error) || /abort|cancel|timeout/i.test(message)) {
    return `AgentServer ${operation} request timed out or was cancelled after ${timeoutMs}ms. Retry can resume with this repair-needed attempt in priorAttempts.`;
  }
  return `AgentServer ${operation} request failed: ${sanitizeAgentServerError(message)}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function redactSecretText(text: string) {
  return text
    .replace(/(api[-_]?key|token|authorization|secret|password|credential)(["'\s]*[:=]\s*["']?)([^"',\s)]+)/gi, '$1$2[redacted]')
    .replace(/\b(sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/g, '$1-[redacted]');
}

function isToolPayload(value: unknown): value is ToolPayload {
  if (!isRecord(value)) return false;
  return typeof value.message === 'string'
    && Array.isArray(value.claims)
    && Array.isArray(value.uiManifest)
    && Array.isArray(value.executionUnits)
    && Array.isArray(value.artifacts);
}

function extractAgentServerOutputText(run: Record<string, unknown>) {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates = [
    output.result,
    output.text,
    output.error,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [result.finalText, result.handoffSummary, result.outputSummary];
    }),
  ];
  return candidates
    .map((candidate) => typeof candidate === 'string' ? candidate.trim() : '')
    .find((candidate) => candidate.length > 40);
}

function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
  const structured = coerceAgentServerToolPayload(extractJson(text));
  if (structured) return ensureDirectAnswerReportArtifact(structured, request, 'agentserver-structured-answer');
  const nested = extractNestedAgentServerPayloadFromText(text);
  if (nested) return ensureDirectAnswerReportArtifact(nested, request, 'agentserver-structured-answer');
  const expected = expectedArtifactTypesForRequest(request);
  const artifacts: Array<Record<string, unknown>> = [];
  if (expected.includes('research-report') || /report|summary|报告|总结/.test(request.prompt.toLowerCase())) {
    artifacts.push({
      id: 'research-report',
      type: 'research-report',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: 'agentserver-direct-text',
        note: 'AgentServer returned a natural-language answer instead of taskFiles; BioAgent preserved it as a report artifact.',
      },
      data: {
        markdown: text,
        sections: [{ title: 'AgentServer Report', content: text }],
      },
    });
  }
  const reportRef = artifacts.some((artifact) => artifact.type === 'research-report') ? 'research-report' : `${request.skillDomain}-runtime-result`;
  return {
    message: text,
    confidence: 0.72,
    claimType: 'evidence-summary',
    evidenceLevel: 'agentserver-direct',
    reasoningTrace: 'AgentServer returned plain text; BioAgent converted it into a ToolPayload so the work remains visible and auditable.',
    claims: [{
      text: text.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
      type: 'inference',
      confidence: 0.72,
      evidenceLevel: 'agentserver-direct',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: artifacts.length ? 'report-viewer' : 'execution-unit-table', artifactRef: reportRef, priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: `${request.skillDomain}-runtime-result`, priority: 2 },
    ],
    executionUnits: [{
      id: `agentserver-direct-${sha1(text).slice(0, 8)}`,
      status: 'done',
      tool: 'agentserver.direct-text',
      params: JSON.stringify({ expectedArtifactTypes: expected, prompt: request.prompt.slice(0, 200) }),
    }],
    artifacts,
  };
}

function mergeExistingContextArtifactsForDirectAnswer(
  payload: ToolPayload,
  request: GatewayRequest,
  referenceArtifacts: Array<Record<string, unknown>>,
): ToolPayload {
  const expected = new Set(expectedArtifactTypesForRequest(request));
  if (!expected.size || !referenceArtifacts.length) return payload;
  const present = new Set(payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  const additions: Array<Record<string, unknown>> = [];
  for (const artifact of referenceArtifacts) {
    const type = String(artifact.type || artifact.id || '');
    if (!expected.has(type) || present.has(type) || artifactNeedsRepair(artifact)) continue;
    additions.push({
      ...artifact,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        source: stringField(isRecord(artifact.metadata) ? artifact.metadata.source : undefined) ?? 'existing-context',
        reusedForContextAnswer: true,
      },
    });
    present.add(type);
  }
  return additions.length ? { ...payload, artifacts: [...payload.artifacts, ...additions] } : payload;
}

async function mergeReusableContextArtifactsForDirectPayload(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  const context = directPayloadReferencesExistingContext(payload, request)
    ? await collectArtifactReferenceContext(request)
    : undefined;
  return mergeExistingContextArtifactsForDirectAnswer(
    payload,
    request,
    context?.combinedArtifacts.length ? context.combinedArtifacts : request.artifacts,
  );
}

function directPayloadReferencesExistingContext(payload: ToolPayload, request: GatewayRequest) {
  const hasRecoverableContext = request.artifacts.length > 0
    || toRecordList(request.uiState?.recentExecutionRefs).length > 0
    || toStringList(request.uiState?.recentConversation).length > 1;
  if (!hasRecoverableContext) return false;
  const text = [
    currentUserRequestText(request.prompt),
    payload.message,
    payload.reasoningTrace,
    payload.claimType,
    payload.evidenceLevel,
    ...payload.claims.map((claim) => typeof claim === 'string' ? claim : JSON.stringify(clipForAgentServerJson(claim, 2))),
  ].join('\n').toLowerCase();
  return /上一轮|上轮|上次|之前|此前|刚才|已有|现有|当前会话|不要重新|别重新|不重新|不要重跑|别重跑|不重跑|不要检索|不要搜索|只读取|只读|prior|previous|last\s+(round|run|turn)|existing|current\s+session|context|refs?|artifacts?|do not rerun|don't rerun|no rerun|without rerun|no new/.test(text);
}

function ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload {
  const expected = expectedArtifactTypesForRequest(request);
  const needsReport = expected.includes('research-report') || /report|summary|报告|总结/.test(request.prompt.toLowerCase());
  if (!needsReport) return payload;
  const message = String(payload.message || '').trim();
  if (!message) return payload;
  const hasUsableReport = payload.artifacts.some((artifact) =>
    String(artifact.type || artifact.id || '') === 'research-report' && !artifactNeedsRepair(artifact)
  );
  if (hasUsableReport) return payload;
  const artifacts = [
    ...payload.artifacts.filter((artifact) =>
      !(String(artifact.type || artifact.id || '') === 'research-report' && artifactNeedsRepair(artifact))
    ),
    directAnswerReportArtifact(message, request.skillDomain, source),
  ];
  const uiManifest = payload.uiManifest.some((slot) => String(slot.componentId || '') === 'report-viewer')
    ? payload.uiManifest
    : [
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 },
      ...payload.uiManifest.map((slot, index) => ({
        ...slot,
        priority: typeof slot.priority === 'number' ? Math.max(slot.priority, index + 2) : index + 2,
      })),
    ];
  return {
    ...payload,
    artifacts,
    uiManifest,
  };
}

function directAnswerReportArtifact(message: string, skillDomain: BioAgentSkillDomain, source: string): Record<string, unknown> {
  return {
    id: 'research-report',
    type: 'research-report',
    producerScenario: skillDomain,
    schemaVersion: '1',
    metadata: {
      source,
      note: 'AgentServer returned a direct answer with user-visible content; BioAgent preserved the answer as a report artifact instead of adding a repair placeholder.',
    },
    data: {
      markdown: message,
      report: message,
      sections: [{ title: 'AgentServer Answer', content: message }],
    },
  };
}

function coerceAgentServerToolPayload(value: unknown): ToolPayload | undefined {
  const normalized = normalizeAgentServerToolPayloadCandidate(value);
  return isToolPayload(normalized) ? normalized : undefined;
}

function coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined {
  if (isToolPayload(value)) return normalizeToolPayloadShape(value);
  if (!isRecord(value)) return undefined;
  const artifactPayload = coerceStandaloneArtifactPayload(value);
  if (artifactPayload) return artifactPayload;
  const looksLikePayload =
    Array.isArray(value.artifacts)
    || Array.isArray(value.executionUnits)
    || Array.isArray(value.claims)
    || value.uiManifest !== undefined;
  return looksLikePayload ? coerceAgentServerToolPayload(value) : undefined;
}

function coerceStandaloneArtifactPayload(value: Record<string, unknown>): ToolPayload | undefined {
  const type = stringField(value.type) ?? stringField(value.artifactType);
  if (!type) return undefined;
  if (type === 'tool-payload' || type === 'ToolPayload') return undefined;
  const id = stringField(value.id) ?? type;
  const entity = stringField(value.entity);
  const artifact = {
    ...value,
    id,
    type,
    schemaVersion: stringField(value.schemaVersion) ?? '1',
    data: isRecord(value.data) ? value.data : artifactDataFromLooseArtifact({ ...value, id, type }),
    metadata: {
      ...(isRecord(value.metadata) ? value.metadata : {}),
      source: stringField(isRecord(value.metadata) ? value.metadata.source : undefined) ?? 'workspace-task-artifact-json',
      wrappedAsToolPayload: true,
    },
  };
  const message = [
    entity,
    `${type} artifact generated from workspace task output.`,
  ].filter(Boolean).join(' ');
  return {
    message,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
    claimType: String(value.claimType || 'artifact-generation'),
    evidenceLevel: String(value.evidenceLevel || 'workspace-artifact'),
    reasoningTrace: 'Workspace task returned a standalone artifact JSON; BioAgent wrapped it into a ToolPayload for display, persistence, and follow-up reuse.',
    claims: [{
      id: `${id}-claim`,
      text: message,
      type: 'fact',
      confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
      evidenceLevel: String(value.evidenceLevel || 'workspace-artifact'),
      supportingRefs: [id],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: componentForStandaloneArtifact(type),
      artifactRef: id,
      priority: 1,
    }],
    executionUnits: [{
      id: `${id}-workspace-artifact-json`,
      status: 'done',
      tool: 'workspace-task.artifact-json',
    }],
    artifacts: [artifact],
  };
}

function componentForStandaloneArtifact(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === 'research-report') return 'report-viewer';
  if (normalized === 'paper-list') return 'paper-card-list';
  if (normalized === 'knowledge-graph') return 'network-graph';
  if (normalized === 'structure-summary') return 'molecule-viewer';
  if (normalized === 'evidence-matrix') return 'evidence-matrix';
  if (normalized === 'notebook-timeline') return 'notebook-timeline';
  return 'unknown-artifact-inspector';
}

function normalizeToolPayloadShape(payload: ToolPayload): ToolPayload {
  return {
    ...payload,
    executionUnits: normalizeAgentServerExecutionUnits(payload.executionUnits),
    artifacts: normalizeAgentServerArtifacts(payload.artifacts, payload.message),
    objectReferences: Array.isArray(payload.objectReferences) ? payload.objectReferences.filter(isRecord) : undefined,
    displayIntent: isRecord(payload.displayIntent) ? payload.displayIntent : undefined,
  };
}

function normalizeAgentServerToolPayloadCandidate(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (isToolPayload(value)) return value;
  if (typeof value === 'string') return normalizeAgentServerToolPayloadCandidate(extractJson(value), depth + 1);
  if (!isRecord(value)) return undefined;

  for (const key of ['payload', 'toolPayload', 'result', 'output', 'data']) {
    const nested = normalizeAgentServerToolPayloadCandidate(value[key], depth + 1);
    if (isToolPayload(nested)) return nested;
  }
  for (const key of ['markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']) {
    const nested = typeof value[key] === 'string'
      ? normalizeAgentServerToolPayloadCandidate(value[key], depth + 1)
      : undefined;
    if (isToolPayload(nested)) return nested;
  }

  const message = firstStringField(value, ['message', 'answer', 'summary', 'markdown', 'report', 'text', 'finalText', 'handoffSummary', 'outputSummary']);
  const artifacts = normalizeAgentServerArtifacts(value.artifacts, message);
  const claims = normalizeAgentServerClaims(value.claims, message);
  const uiManifest = normalizeAgentServerUiManifest(value.uiManifest, artifacts);
  const executionUnits = normalizeAgentServerExecutionUnits(value.executionUnits);
  const objectReferences = Array.isArray(value.objectReferences) ? value.objectReferences.filter(isRecord) : undefined;
  const displayIntent = isRecord(value.displayIntent) ? value.displayIntent : undefined;

  if (!message || !claims.length || !uiManifest.length) return undefined;
  return {
    message,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0.72,
    claimType: String(value.claimType || 'agentserver-answer'),
    evidenceLevel: String(value.evidenceLevel || 'agentserver'),
    reasoningTrace: String(value.reasoningTrace || 'AgentServer returned structured answer JSON; BioAgent normalized it into a ToolPayload.'),
    claims,
    uiManifest,
    executionUnits,
    artifacts,
    displayIntent,
    objectReferences,
  };
}

function extractNestedAgentServerPayloadFromText(text: string): ToolPayload | undefined {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) return undefined;
  for (const key of ['markdown', 'report', 'message', 'text']) {
    const nested = typeof parsed[key] === 'string' ? coerceAgentServerToolPayload(extractJson(parsed[key])) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return stripOuterJsonFence(value.trim());
  }
  return undefined;
}

function normalizeAgentServerClaims(value: unknown, message?: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const claims = value.map((claim) => {
      if (typeof claim === 'string') return { text: claim, type: 'inference', confidence: 0.72, evidenceLevel: 'agentserver' };
      if (isRecord(claim)) return claim;
      return undefined;
    }).filter(isRecord);
    if (claims.length) return claims;
  }
  return [{
    text: (message || 'AgentServer completed the request.').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 240) || 'AgentServer completed the request.',
    type: 'inference',
    confidence: 0.72,
    evidenceLevel: 'agentserver',
    supportingRefs: [],
    opposingRefs: [],
  }];
}

function normalizeAgentServerUiManifest(value: unknown, artifacts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const manifest = value.map((slot) => isRecord(slot) ? slot : undefined).filter(isRecord);
    if (manifest.length) return manifest;
  }
  if (isRecord(value) && Array.isArray(value.components)) {
    const primaryArtifact = String(artifacts[0]?.id || artifacts[0]?.type || 'research-report');
    const manifest = value.components
      .filter((component): component is string => typeof component === 'string' && component.trim().length > 0)
      .map((componentId, index) => ({ componentId, artifactRef: primaryArtifact, priority: index + 1 }));
    if (manifest.length) return manifest;
  }
  if (artifacts.some((artifact) => artifact.type === 'research-report')) {
    return [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }];
  }
  return [{ componentId: 'execution-unit-table', artifactRef: 'agentserver-runtime-result', priority: 1 }];
}

function normalizeAgentServerExecutionUnits(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    const units = value.map((unit) => isRecord(unit) ? unit : undefined).filter(isRecord);
    if (units.length) return units;
  }
  return [{
    id: `agentserver-direct-${sha1(JSON.stringify(value ?? {})).slice(0, 8)}`,
    status: 'done',
    tool: 'agentserver.direct-text',
    params: '{}',
  }];
}

function normalizeAgentServerArtifacts(value: unknown, message?: string): Array<Record<string, unknown>> {
  const artifacts = Array.isArray(value) ? value.map((artifact) => isRecord(artifact) ? artifact : undefined).filter(isRecord) : [];
  if (!artifacts.length && message) {
    return [{
      id: 'research-report',
      type: 'research-report',
      schemaVersion: '1',
      metadata: { source: 'agentserver-structured-answer' },
      data: {
        markdown: message,
        sections: [{ title: 'AgentServer Report', content: message }],
      },
    }];
  }
  return artifacts.map((artifact) => {
    const type = String(artifact.type || artifact.artifactType || artifact.id || '');
    const id = String(artifact.id || type || 'artifact');
    const normalizedArtifact = {
      ...artifact,
      id,
      type,
    };
    const data = isRecord(artifact.data) ? artifact.data : artifactDataFromLooseArtifact(normalizedArtifact);
    if (type !== 'research-report') {
      return Object.keys(data).length ? { ...normalizedArtifact, data } : normalizedArtifact;
    }
    if (isRecord(artifact.data)) return normalizedArtifact;
    return {
      ...normalizedArtifact,
      data: {
        ...data,
        markdown: message || String(artifact.dataRef || artifact.id || ''),
        sections: [{ title: String(isRecord(artifact.metadata) ? artifact.metadata.title || 'AgentServer Report' : 'AgentServer Report'), content: message || '' }],
      },
    };
  });
}

function artifactDataFromLooseArtifact(artifact: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(artifact)) {
    if (['id', 'type', 'artifactType', 'schemaVersion', 'metadata', 'dataRef', 'visibility', 'audience', 'sensitiveDataFlags', 'exportPolicy'].includes(key)) continue;
    data[key] = value;
  }
  return data;
}

function stripOuterJsonFence(text: string) {
  const fenced = text.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || text;
}

function extractStandaloneJson(text: string): unknown {
  const stripped = stripOuterJsonFence(text).trim();
  if (!stripped.startsWith('{')) return undefined;
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

async function validateAndNormalizePayload(
  payload: ToolPayload,
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
) {
  const errors = schemaErrors(payload);
  if (errors.length) {
    return repairNeededPayload(request, skill, `Task output failed schema validation: ${errors.join('; ')}`, refs);
  }
  const workspace = resolve(request.workspacePath || process.cwd());
  const normalizedArtifacts = await normalizeArtifactsForPayload(
    Array.isArray(payload.artifacts) ? payload.artifacts : [],
    workspace,
    refs,
  );
  const persistedArtifacts = await persistArtifactRefsForPayload(
    workspace,
    request,
    normalizedArtifacts,
    refs,
  );
  return {
    message: String(payload.message || `${skill.id} completed.`),
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
    claimType: String(payload.claimType || 'fact'),
    evidenceLevel: String(payload.evidenceLevel || 'runtime'),
    reasoningTrace: [
      String(payload.reasoningTrace || ''),
      `Skill: ${skill.id}`,
      `Runtime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}, stdoutRef=${refs.stdoutRel}, stderrRef=${refs.stderrRel}`,
    ].filter(Boolean).join('\n'),
    claims: Array.isArray(payload.claims) ? payload.claims : [],
    uiManifest: composeRuntimeUiManifest(
      Array.isArray(payload.uiManifest) ? payload.uiManifest : [],
      Array.isArray(payload.artifacts) ? payload.artifacts : [],
      request,
    ),
    executionUnits: (Array.isArray(payload.executionUnits) ? payload.executionUnits : []).map((unit) => isRecord(unit) ? {
      language: 'python',
      codeRef: refs.taskRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      outputRef: refs.outputRel,
      runtimeFingerprint: refs.runtimeFingerprint,
      skillId: skill.id,
      ...attemptPlanRefs(request, skill),
      ...unit,
      status: normalizeExecutionUnitStatus(unit.status),
    } : unit),
    artifacts: persistedArtifacts,
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
  };
}

async function persistArtifactRefsForPayload(
  workspace: string,
  request: GatewayRequest,
  artifacts: Array<Record<string, unknown>>,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string },
) {
  const sessionId = isRecord(request.uiState) && typeof request.uiState.sessionId === 'string'
    ? request.uiState.sessionId
    : 'sessionless';
  const out: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    const id = safeArtifactId(String(artifact.id || artifact.type || 'artifact'));
    const type = safeArtifactId(String(artifact.type || artifact.id || 'artifact'));
    const artifactHash = sha1(JSON.stringify(clipForAgentServerJson(artifact, 4))).slice(0, 12);
    const rel = `.bioagent/artifacts/${safeArtifactId(sessionId)}-${type}-${id}-${artifactHash}.json`;
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const record = {
      ...artifact,
      producerScenario: typeof artifact.producerScenario === 'string' ? artifact.producerScenario : request.skillDomain,
      producerSessionId: sessionId,
      dataRef: typeof artifact.dataRef === 'string' ? artifact.dataRef : refs.outputRel,
      metadata: {
        ...metadata,
        artifactRef: rel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
        persistedAt: new Date().toISOString(),
      },
    };
    try {
      await mkdir(dirname(join(workspace, rel)), { recursive: true });
      await writeFile(join(workspace, rel), JSON.stringify(record, null, 2));
    } catch {
      // Artifact refs improve multi-turn recovery, but a write failure should not hide the task result.
    }
    out.push(record);
  }
  return out;
}

function safeArtifactId(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
}

async function normalizeArtifactsForPayload(
  artifacts: Array<Record<string, unknown>>,
  workspace: string,
  refs?: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string },
) {
  return await Promise.all(artifacts.map(async (artifact): Promise<Record<string, unknown>> => {
    const enriched = await enrichArtifactDataFromFileRefs(artifact, workspace);
    const metadata = isRecord(enriched.metadata) ? enriched.metadata : {};
    return {
      ...enriched,
      dataRef: typeof enriched.dataRef === 'string' ? enriched.dataRef : refs?.outputRel,
      metadata: refs ? {
        ...metadata,
        taskCodeRef: metadata.taskCodeRef ?? refs.taskRel,
        outputRef: metadata.outputRef ?? refs.outputRel,
        stdoutRef: metadata.stdoutRef ?? refs.stdoutRel,
        stderrRef: metadata.stderrRef ?? refs.stderrRel,
      } : metadata,
    };
  }));
}

async function enrichArtifactDataFromFileRefs(artifact: Record<string, unknown>, workspace: string) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const currentData = isPlainDataRecord(artifact.data) ? artifact.data : {};
  const type = String(artifact.type || artifact.id || '');
  const data: Record<string, unknown> = {
    ...await artifactDataFromPayloadRef(artifact, workspace),
    ...await artifactDataFromArtifactPath(artifact, workspace),
    ...currentData,
  };

  if (type === 'omics-differential-expression') {
    const markerRows = await readCsvRef(metadata.markerRef, workspace);
    const qcRows = await readCsvRef(metadata.qcRef, workspace);
    const compositionRows = await readCsvRef(metadata.compositionRef, workspace);
    const volcanoRows = await readCsvRef(metadata.volcanoRef, workspace);
    const umapSvgText = await readTextRef(metadata.umapSvgRef, workspace);
    const heatmapSvgText = await readTextRef(metadata.heatmapSvgRef, workspace);
    if (markerRows.length) data.markers = markerRows;
    if (qcRows.length) data.qc = qcRows;
    if (compositionRows.length) data.composition = compositionRows;
    if (volcanoRows.length) {
      data.volcano = volcanoRows;
      data.points = volcanoRows.map((row, index) => {
        const negLogP = numberFrom(row.negLogP ?? row.neg_log10_pval ?? row.neg_log10_p ?? row.pValue ?? row.pval_adj);
        return {
          gene: String(row.gene || row.label || `Gene${index + 1}`),
          logFC: numberFrom(row.logFC ?? row.log2FC ?? row.logfoldchange) ?? 0,
          negLogP,
          significant: Boolean((negLogP ?? 0) >= 1.3),
          cluster: String(row.cluster || row.cell_type || ''),
        };
      });
    }
    if (umapSvgText) data.umapSvgText = umapSvgText;
    if (heatmapSvgText) data.heatmapSvgText = heatmapSvgText;
  }

  if (type === 'research-report') {
    const markdown = await readTextRef(metadata.reportRef, workspace);
    const realDataPlanText = await readTextRef(metadata.realDataPlanRef, workspace);
    if (markdown) {
      data.markdown = markdown;
      if (!Array.isArray(data.sections)) {
        data.sections = markdownSections(markdown);
      }
    }
    const inlineMarkdown = stringField(data.markdown)
      ?? stringField(data.report)
      ?? stringField(data.content)
      ?? stringField(artifact.data)
      ?? stringField(artifact.markdown)
      ?? stringField(artifact.report)
      ?? stringField(artifact.content);
    if (inlineMarkdown) {
      data.markdown = inlineMarkdown;
      data.report = stringField(data.report) ?? inlineMarkdown;
      if (!Array.isArray(data.sections)) {
        data.sections = markdownSections(inlineMarkdown);
      }
    }
    if (realDataPlanText) {
      try {
        data.realDataPlan = JSON.parse(realDataPlanText);
      } catch {
        data.realDataPlan = realDataPlanText;
      }
    }
  }

  const pathRef = stringField(artifact.path);
  return Object.keys(data).length
    ? { ...artifact, data, dataRef: stringField(artifact.dataRef) ?? pathRef }
    : artifact;
}

async function artifactDataFromArtifactPath(artifact: Record<string, unknown>, workspace: string) {
  const path = safeWorkspaceFilePath(artifact.path, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    const text = await readTextRef(artifact.path, workspace);
    const type = String(artifact.type || artifact.id || '');
    return text && /report|summary|markdown|text/i.test(type) ? { markdown: text, content: text } : {};
  }
  if (!isRecord(parsed)) return {};
  const { type: _type, id: _id, ...rest } = parsed;
  return rest;
}

async function artifactDataFromPayloadRef(artifact: Record<string, unknown>, workspace: string) {
  const ref = typeof artifact.dataRef === 'string'
    ? artifact.dataRef
    : isRecord(artifact.metadata) && typeof artifact.metadata.outputRef === 'string'
      ? artifact.metadata.outputRef
      : undefined;
  if (!ref) return {};
  const path = safeWorkspaceFilePath(ref, workspace);
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.artifacts)) return {};
  const wantedId = typeof artifact.id === 'string' ? artifact.id : undefined;
  const wantedType = typeof artifact.type === 'string' ? artifact.type : wantedId;
  const match = parsed.artifacts
    .filter(isRecord)
    .find((candidate) => {
      const id = typeof candidate.id === 'string' ? candidate.id : undefined;
      const type = typeof candidate.type === 'string' ? candidate.type : undefined;
      return (wantedId && id === wantedId) || (wantedType && type === wantedType);
    });
  if (!match || !isPlainDataRecord(match.data)) return {};
  return match.data;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

async function readTextRef(value: unknown, workspace: string) {
  const path = safeWorkspaceFilePath(value, workspace);
  if (!path) return undefined;
  try {
    return await readFile(path, 'utf8');
  } catch {
    const scanpyFallback = scanpyFigureFallbackPath(path, workspace);
    if (!scanpyFallback) return undefined;
    try {
      return await readFile(scanpyFallback, 'utf8');
    } catch {
      return undefined;
    }
  }
}

async function readCsvRef(value: unknown, workspace: string) {
  const text = await readTextRef(value, workspace);
  return text ? parseCsvRows(text) : [];
}

function safeWorkspaceFilePath(value: unknown, workspace: string) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const candidate = value.trim();
  const workspaceRoot = resolve(workspace);
  const absolute = candidate.startsWith('/') ? resolve(candidate) : resolve(workspaceRoot, candidate);
  return absolute.startsWith(`${workspaceRoot}/`) || absolute === workspaceRoot ? absolute : undefined;
}

function scanpyFigureFallbackPath(path: string, workspace: string) {
  if (!path.replaceAll('\\', '/').includes('/.bioagent/task-results/figures/')) return undefined;
  const basename = path.split('/').pop();
  if (!basename) return undefined;
  const normalizedName = basename.replace(/^rank_genes_groups_/, '');
  const candidate = resolve(workspace, 'figures', normalizedName);
  return candidate.startsWith(`${resolve(workspace)}/`) ? candidate : undefined;
}

function parseCsvRows(text: string) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
  const header = rows[0]?.map((cell) => cell.trim()) ?? [];
  if (!header.length) return [];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, coerceCsvValue(row[index] ?? '')])));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function coerceCsvValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function numberFrom(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function markdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; content: string } | undefined;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push({ ...current, content: current.content.trim() });
      current = { title: heading[1].trim(), content: '' };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) sections.push({ ...current, content: current.content.trim() });
  return sections;
}

function expectedArtifactTypesForRequest(request: GatewayRequest) {
  return uniqueStrings([
    ...(request.expectedArtifactTypes ?? []),
    ...toStringList(request.uiState?.expectedArtifactTypes),
  ]);
}

function selectedComponentIdsForRequest(request: Pick<GatewayRequest, 'selectedComponentIds' | 'uiState'>) {
  return uniqueStrings([
    ...(request.selectedComponentIds ?? []),
    ...toStringList(request.uiState?.selectedComponentIds),
  ]);
}

function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: Partial<{
    taskRel: string;
    outputRel: string;
    stdoutRel: string;
    stderrRel: string;
    blocker: string;
    agentServerRefs: Record<string, unknown>;
    recoverActions: string[];
  }> = {},
): ToolPayload {
  const id = `EU-${request.skillDomain}-${sha1(`${request.prompt}:${reason}`).slice(0, 8)}`;
  return {
    message: `BioAgent runtime gateway needs repair or AgentServer task generation: ${reason}`,
    confidence: 0.2,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      reason,
      `skillDomain=${request.skillDomain}`,
      `skill=${skill.id}`,
      'No demo/default/record-only success payload was substituted.',
    ].join('\n'),
    claims: [{
      text: reason,
      type: 'fact',
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [skill.id],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: `${request.skillDomain}-runtime-result`, priority: 1 },
    ],
    executionUnits: [{
      id,
      tool: 'bioagent.workspace-runtime-gateway',
      params: JSON.stringify({ prompt: request.prompt, skillDomain: request.skillDomain, skillId: skill.id, reason }),
      status: 'repair-needed',
      hash: sha1(`${id}:${reason}`).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'BioAgent workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [],
      artifacts: [],
      codeRef: refs.taskRel,
      outputRef: refs.outputRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      blocker: refs.blocker,
      refs: refs.agentServerRefs,
      failureReason: reason,
      ...attemptPlanRefs(request, skill, reason),
      requiredInputs: requiredInputsForRepair(request, reason),
      recoverActions: refs.recoverActions ?? recoverActionsForRepair(reason),
      nextStep: nextStepForRepair(reason),
      attempt: 1,
    }],
    artifacts: [],
  };
}

function agentServerGenerationFailureReason(error: string, diagnostics?: AgentServerGenerationFailureDiagnostics) {
  if (diagnostics?.kind !== 'contextWindowExceeded') return error;
  const parts = [
    'blocker=contextWindowExceeded: AgentServer/backend exceeded its context window during task generation.',
    `failureReason=${error}`,
    diagnostics.backend ? `backend=${diagnostics.backend}` : undefined,
    diagnostics.provider ? `provider=${diagnostics.provider}` : undefined,
    diagnostics.agentId ? `session=${diagnostics.agentId}` : undefined,
    diagnostics.originalErrorSummary ? `originalError=${diagnostics.originalErrorSummary}` : undefined,
    diagnostics.compaction ? `compact=${diagnostics.compaction.ok ? 'ok' : 'failed'}:${diagnostics.compaction.strategy}:${diagnostics.compaction.message || diagnostics.compaction.reason}` : 'compact=not-run',
    diagnostics.retryAttempted ? 'retry=attempted-once' : 'retry=not-attempted',
    diagnostics.retrySucceeded === false ? 'retryResult=failed' : undefined,
  ];
  return parts.filter(Boolean).join(' | ');
}

function agentServerFailurePayloadRefs(diagnostics?: AgentServerGenerationFailureDiagnostics): Partial<{
  blocker: string;
  agentServerRefs: Record<string, unknown>;
  recoverActions: string[];
}> {
  if (!diagnostics) return {};
  const refs = {
    blocker: diagnostics.kind,
    agentServerRefs: {
      backend: diagnostics.backend,
      provider: diagnostics.provider,
      model: diagnostics.model,
      agentId: diagnostics.agentId,
      sessionRef: diagnostics.sessionRef,
      originalErrorSummary: diagnostics.originalErrorSummary,
      contextCompaction: diagnostics.compaction ? contextCompactionMetadata(diagnostics.compaction) : undefined,
      compactResult: diagnostics.compaction,
      retryAttempted: diagnostics.retryAttempted,
      retrySucceeded: diagnostics.retrySucceeded,
    },
  };
  return diagnostics.kind === 'contextWindowExceeded'
    ? {
      ...refs,
      recoverActions: [
        'Inspect AgentServer/backend context compaction diagnostics in refs.contextCompaction.',
        'Retry after reducing artifacts, priorAttempts, logs, or selected UI state passed into this turn.',
        'Use a backend/model with a larger context window if compaction keeps failing.',
      ],
    }
    : refs;
}

function requiredInputsForRepair(request: GatewayRequest, reason: string) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (/agentserver|base url/i.test(reason)) inputs.push('agentServerBaseUrl');
  if (/User-side model configuration|llmEndpoint|Model Provider|Model Base URL|Model Name/i.test(reason)) inputs.push('modelProvider', 'modelBaseUrl', 'modelName', 'apiKey');
  if (/credential|token|api key/i.test(reason)) inputs.push('credentials');
  if (/file|path|input/i.test(reason)) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

function recoverActionsForRepair(reason: string) {
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) {
    return [
      'Wait for the provider rate-limit/retry budget reset, then retry the same prompt.',
      'Reduce concurrent AgentServer runs or switch to a provider/model with available quota.',
      'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
    ];
  }
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) {
    return [
      'Open BioAgent settings and fill Model Provider, Model Base URL, Model Name, and API Key.',
      'Save config.local.json, then retry the same prompt so BioAgent forwards the request-selected llmEndpoint.',
      'Do not rely on AgentServer openteam.json defaults for generated workspace tasks.',
    ];
  }
  if (/AgentServer|base URL|fetch|ECONNREFUSED/i.test(reason)) {
    return [
      'Start or configure AgentServer, then retry the same prompt.',
      'If a local seed skill should handle this task, verify the skill registry match before using AgentServer fallback.',
    ];
  }
  if (/schema|payload|parsed|validation/i.test(reason)) {
    return [
      'Open stdoutRef, stderrRef, and outputRef to inspect the generated task result.',
      'Retry after the task returns message, claims, uiManifest, executionUnits, and artifacts.',
    ];
  }
  return [
    'Inspect stdoutRef, stderrRef, and outputRef when present.',
    'Attach required inputs or choose a compatible skill/runtime before retrying.',
  ];
}

function nextStepForRepair(reason: string) {
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) return 'Wait for provider quota/reset, then rerun with compact workspace refs; BioAgent has already used its single automatic compact retry.';
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) return 'Configure the user-side model endpoint in BioAgent settings, then retry the same prompt.';
  if (/AgentServer|base URL|fetch|ECONNREFUSED/i.test(reason)) return 'Start AgentServer or choose a local skill/runtime, then retry.';
  if (/schema|payload|parsed|validation/i.test(reason)) return 'Repair the task output contract and rerun validation.';
  return 'Review diagnostics, provide missing inputs, and rerun.';
}

function failedTaskPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  run: Awaited<ReturnType<typeof runWorkspaceTask>>,
  parseReason?: string,
): ToolPayload {
  return repairNeededPayload(
    request,
    skill,
    parseReason ? `Task exited ${run.exitCode} and output could not be parsed: ${parseReason}` : `Task exited ${run.exitCode}: ${run.stderr || 'no stderr'}`,
    {
      taskRel: run.spec.taskRel,
      outputRel: run.outputRef,
      stdoutRel: run.stdoutRef,
      stderrRel: run.stderrRef,
    },
  );
}

function schemaErrors(payload: unknown) {
  if (!isRecord(payload)) return ['payload is not an object'];
  const errors: string[] = [];
  for (const key of ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts']) {
    if (!(key in payload)) errors.push(`missing ${key}`);
  }
  if (!Array.isArray(payload.claims)) errors.push('claims must be an array');
  if (!Array.isArray(payload.uiManifest)) errors.push('uiManifest must be an array');
  if (!Array.isArray(payload.executionUnits)) errors.push('executionUnits must be an array');
  if (!Array.isArray(payload.artifacts)) errors.push('artifacts must be an array');
  return errors;
}
