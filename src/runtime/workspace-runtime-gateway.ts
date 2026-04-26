import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { agentServerGenerationSkill, loadSkillRegistry, matchSkill } from './skill-registry.js';
import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { AgentServerGenerationResponse, BioAgentSkillDomain, GatewayRequest, LlmEndpointConfig, SkillAvailability, ToolPayload, WorkspaceTaskRunResult } from './runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from './workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';

const SKILL_DOMAIN_SET = new Set<BioAgentSkillDomain>(['literature', 'structure', 'omics', 'knowledge']);

export async function runWorkspaceRuntimeGateway(body: Record<string, unknown>): Promise<ToolPayload> {
  const request = normalizeGatewayRequest(body);
  const skills = await loadSkillRegistry(request);
  const skill = shouldForceAgentServerGeneration(request)
    ? agentServerGenerationSkill(request.skillDomain)
    : matchSkill(request, skills) ?? agentServerGenerationSkill(request.skillDomain);
  if (skill.manifest.entrypoint.type === 'agentserver-generation') {
    return await runAgentServerGeneratedTask(request, skill, skills) ?? repairNeededPayload(request, skill, 'AgentServer task generation did not produce a runnable task.');
  }
  if (shouldAttemptFreshTaskGeneration(request, skill)) {
    const generated = await runAgentServerGeneratedTask(request, skill, skills, { allowFallbackOnGenerationFailure: true });
    if (generated) return generated;
  }
  if (skill.id === 'structure.rcsb_latest_or_entry') {
    return runPythonWorkspaceSkill(request, skill, 'structure');
  }
  if (skill.id === 'literature.pubmed_search') {
    return runPythonWorkspaceSkill(request, skill, 'literature');
  }
  if (skill.id === 'literature.web_search') {
    return runPythonWorkspaceSkill(request, skill, 'literature-web');
  }
  if (skill.id === 'knowledge.uniprot_chembl_lookup') {
    return runPythonWorkspaceSkill(request, skill, 'knowledge');
  }
  if (skill.id === 'sequence.ncbi_blastp_search') {
    return runPythonWorkspaceSkill(request, skill, 'blastp');
  }
  if (skill.id === 'omics.differential_expression') {
    return runPythonWorkspaceSkill(request, skill, 'omics');
  }
  if (isLiveScpSkill(skill.id)) {
    return runLiveScpSkill(request, skill);
  }
  if (skill.manifest.entrypoint.type === 'markdown-skill') {
    return await runAgentServerGeneratedTask(request, skill, skills) ?? repairNeededPayload(request, skill, 'AgentServer markdown-skill task generation did not produce a runnable task.');
  }
  return repairNeededPayload(request, skill, `Skill ${skill.id} is installed but has no gateway adapter yet.`);
}

async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  options: { allowFallbackOnGenerationFailure?: boolean } = {},
): Promise<ToolPayload | undefined> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const baseUrl = request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(workspace);
  if (!baseUrl) {
    if (options.allowFallbackOnGenerationFailure) return undefined;
    return repairNeededPayload(request, skill, 'No validated local skill matched this request and no AgentServer base URL is configured.');
  }
  const generation = await requestAgentServerGeneration({
    baseUrl,
    request,
    skill,
    skills,
    workspace,
  });
  if (!generation.ok) {
    if (options.allowFallbackOnGenerationFailure) return undefined;
    return repairNeededPayload(request, skill, generation.error);
  }
  if ('directPayload' in generation) {
    const normalized = validateAndNormalizePayload(generation.directPayload, request, skill, {
      taskRel: 'agentserver://direct-payload',
      outputRel: `agentserver://${generation.runId || 'unknown'}/output`,
      stdoutRel: `agentserver://${generation.runId || 'unknown'}/stdout`,
      stderrRel: `agentserver://${generation.runId || 'unknown'}/stderr`,
      runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: generation.runId },
    });
    return {
      ...normalized,
      reasoningTrace: [
        normalized.reasoningTrace,
        `AgentServer generation run: ${generation.runId || 'unknown'}`,
        'AgentServer returned a BioAgent ToolPayload directly; no workspace task archive was required.',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(request, skill),
        agentServerGenerated: true,
        agentServerRunId: generation.runId,
      } : unit),
    };
  }

  const taskId = `generated-${request.skillDomain}-${sha1(`${request.prompt}:${Date.now()}`).slice(0, 12)}`;
  const generatedPathMap = new Map<string, string>();
  for (const file of generation.response.taskFiles) {
    const rel = generatedTaskArchiveRel(taskId, file.path);
    generatedPathMap.set(safeWorkspaceRel(file.path), rel);
    await mkdir(dirname(join(workspace, rel)), { recursive: true });
    const content = file.content || await readGeneratedTaskFileIfPresent(workspace, file.path);
    await writeFile(join(workspace, rel), content);
  }
  const entrypointOriginalRel = safeWorkspaceRel(generation.response.entrypoint.path);
  const taskRel = generatedPathMap.get(entrypointOriginalRel) ?? generatedTaskArchiveRel(taskId, generation.response.entrypoint.path);
  const outputRel = `.bioagent/task-results/${taskId}.json`;
  const stdoutRel = `.bioagent/logs/${taskId}.stdout.log`;
  const stderrRel = `.bioagent/logs/${taskId}.stderr.log`;
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: generation.response.entrypoint.language,
    entrypoint: generation.response.entrypoint.command || 'main',
    taskRel,
    input: {
      prompt: request.prompt,
      attempt: 1,
      skillId: skill.id,
      agentServerGenerated: true,
      expectedArtifacts: expectedArtifactTypesForRequest(request).length
        ? expectedArtifactTypesForRequest(request)
        : generation.response.expectedArtifacts,
      selectedComponentIds: selectedComponentIdsForRequest(request),
    },
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
    });
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }

  try {
    const payload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const errors = schemaErrors(payload);
    const normalized = validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: errors.length ? 'repair-needed' : 'done',
      codeRef: taskRel,
      inputRef: `.bioagent/task-inputs/${taskId}.json`,
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
        taskPrefix: 'generated',
        run,
        schemaErrors: errors,
        failureReason: `AgentServer generated task output failed schema validation: ${errors.join('; ')}`,
      });
      if (repaired) return repaired;
    }
    const supplement = await trySupplementMissingArtifacts(request, skill, skills, normalized);
    if (supplement) return supplement;
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
    });
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }
}

async function readGeneratedTaskFileIfPresent(workspace: string, path: string) {
  try {
    return await readFile(join(workspace, safeWorkspaceRel(path)), 'utf8');
  } catch {
    return '';
  }
}

function normalizeGatewayRequest(body: Record<string, unknown>): GatewayRequest {
  const skillDomain = String(body.skillDomain || '') as BioAgentSkillDomain;
  if (!SKILL_DOMAIN_SET.has(skillDomain)) throw new Error(`Unsupported BioAgent skill domain: ${String(body.skillDomain || '')}`);
  return {
    skillDomain,
    prompt: String(body.prompt || ''),
    workspacePath: typeof body.workspacePath === 'string' ? body.workspacePath : undefined,
    agentServerBaseUrl: typeof body.agentServerBaseUrl === 'string' ? cleanUrl(body.agentServerBaseUrl) : undefined,
    modelProvider: typeof body.modelProvider === 'string' ? body.modelProvider : undefined,
    modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
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
  if (provider === 'native' && !baseUrl && !modelName) return undefined;
  if (!baseUrl && !modelName) return undefined;
  return {
    provider: provider || undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
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
  if (skill?.manifest.entrypoint.type === 'agentserver-generation') return `agentserver-${agentServerBackend()}`;
  if (skill && isLiveScpSkill(skill.id)) return 'scp-hub';
  if (skill?.manifest.entrypoint.type === 'workspace-task') return 'workspace-python';
  return request.scenarioPackageRef?.source === 'built-in' ? 'seed-skill' : undefined;
}

function selectedRuntimeForSkill(skill?: SkillAvailability) {
  if (!skill) return undefined;
  if (skill.manifest.entrypoint.type === 'agentserver-generation') return 'agentserver-generation';
  if (skill.manifest.entrypoint.type === 'markdown-skill') return 'agentserver-markdown-skill';
  if (skill.manifest.entrypoint.type === 'workspace-task') return 'workspace-python';
  if (isLiveScpSkill(skill.id)) return 'scp-live-adapter';
  return skill.manifest.entrypoint.type;
}

function agentServerBackend() {
  const requested = process.env.BIOAGENT_AGENTSERVER_BACKEND?.trim();
  if (requested && ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw'].includes(requested)) {
    return requested;
  }
  return 'codex';
}

async function runPythonWorkspaceSkill(request: GatewayRequest, skill: SkillAvailability, taskPrefix: string): Promise<ToolPayload> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const runId = sha1(`${taskPrefix}:${request.prompt}:${Date.now()}`).slice(0, 12);
  const outputRel = `.bioagent/task-results/${taskPrefix}-${runId}.json`;
  const inputRel = `.bioagent/task-inputs/${taskPrefix}-${runId}.json`;
  const stdoutRel = `.bioagent/logs/${taskPrefix}-${runId}.stdout.log`;
  const stderrRel = `.bioagent/logs/${taskPrefix}-${runId}.stderr.log`;
  const taskRel = `.bioagent/tasks/${taskPrefix}-${runId}.py`;
  const taskId = `${taskPrefix}-${runId}`;
  if (taskPrefix === 'structure') await mkdir(join(workspace, '.bioagent', 'structures'), { recursive: true });
  const entrypointPath = resolve(dirname(skill.manifestPath), String(skill.manifest.entrypoint.path || ''));
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: 'python',
    entrypoint: 'main',
    codeTemplatePath: entrypointPath,
    input: {
      prompt: request.prompt,
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
  if (run.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    const failureReason = run.stderr || 'Task failed before writing output.';
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
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
    });
    if (repaired) return repaired;
    const payload = failedTaskPayload(request, skill, run);
    return payload;
  }
  try {
    const payload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const errors = schemaErrors(payload);
    const normalized = validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
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
      });
      if (repaired) return repaired;
    }
    const supplement = await trySupplementMissingArtifacts(request, skill, [skill], normalized);
    if (supplement) return supplement;
    return normalized;
  } catch (error) {
    const failureReason = errorMessage(error);
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
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
    });
    if (repaired) return repaired;
    const payload = failedTaskPayload(request, skill, run, failureReason);
    return payload;
  }
}

async function runLiveScpSkill(request: GatewayRequest, skill: SkillAvailability): Promise<ToolPayload> {
  const workspace = resolve(request.workspacePath || process.cwd());
  const taskPrefix = 'scp-live';
  const runId = sha1(`${skill.id}:${request.prompt}:${Date.now()}`).slice(0, 12);
  const outputRel = `.bioagent/task-results/${taskPrefix}-${runId}.json`;
  const inputRel = `.bioagent/task-inputs/${taskPrefix}-${runId}.json`;
  const stdoutRel = `.bioagent/logs/${taskPrefix}-${runId}.stdout.log`;
  const stderrRel = `.bioagent/logs/${taskPrefix}-${runId}.stderr.log`;
  const taskRel = `.bioagent/tasks/${taskPrefix}-${runId}.py`;
  const taskId = `${taskPrefix}-${runId}`;
  const entrypointPath = resolve(process.cwd(), 'src', 'runtime', 'python_tasks', 'scp_live_adapter_task.py');
  const run = await runWorkspaceTask(workspace, {
    id: taskId,
    language: 'python',
    entrypoint: 'main',
    codeTemplatePath: entrypointPath,
    input: {
      prompt: request.prompt,
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
    timeoutMs: 180000,
  });
  if (run.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    const failureReason = run.stderr || 'Live SCP adapter failed before writing output.';
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
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
    });
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }
  try {
    const payload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const normalized = validateAndNormalizePayload(payload, request, skill, {
      taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    const errors = schemaErrors(payload);
    const unitStatus = String(normalized.executionUnits[0]?.status || '');
    const requiresGeneration = payloadRequestsAgentServerGeneration(normalized);
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
      skillDomain: request.skillDomain,
      ...attemptPlanRefs(request, skill),
      skillId: skill.id,
      attempt: 1,
      status: errors.length || requiresGeneration || unitStatus === 'repair-needed' ? 'repair-needed' : unitStatus === 'failed-with-reason' ? 'failed-with-reason' : 'done',
      codeRef: taskRel,
      inputRef: inputRel,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: run.exitCode,
      schemaErrors: errors,
      createdAt: new Date().toISOString(),
    });
    if (errors.length || requiresGeneration || unitStatus === 'repair-needed') {
      const reason = errors.length
        ? `Live SCP adapter output failed schema validation: ${errors.join('; ')}`
        : 'Live SCP adapter declared that this request needs task-specific AgentServer generation instead of a fixed adapter script.';
      const repaired = await tryAgentServerRepairAndRerun({
        request,
        skill,
        taskId,
        taskPrefix,
        run,
        schemaErrors: errors,
        failureReason: reason,
      });
      if (repaired) return repaired;
    }
    return normalized;
  } catch (error) {
    const failureReason = `Live SCP adapter output could not be parsed: ${errorMessage(error)}`;
    await appendTaskAttempt(workspace, {
      id: taskId,
      prompt: request.prompt,
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
    });
    if (repaired) return repaired;
    return failedTaskPayload(request, skill, run, failureReason);
  }
}

async function trySupplementMissingArtifacts(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  payload: ToolPayload,
): Promise<ToolPayload | undefined> {
  const missing = missingExpectedArtifactTypes(request, payload);
  if (!missing.length) return undefined;
  const supplementalSkill = agentServerGenerationSkill(request.skillDomain);
  const supplemental = await runAgentServerGeneratedTask({
    ...request,
    prompt: [
      request.prompt,
      '',
      `Supplement the previous local skill result. Missing expected artifact types: ${missing.join(', ')}.`,
      'Write reproducible workspace Python code that emits all missing artifacts and preserves existing artifacts if useful.',
      `Existing artifact types: ${payload.artifacts.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean).join(', ') || 'none'}.`,
    ].join('\n'),
    artifacts: [...request.artifacts, ...payload.artifacts],
    availableSkills: undefined,
    expectedArtifactTypes: missing,
    uiState: {
      ...request.uiState,
      expectedArtifactTypes: missing,
    },
  }, supplementalSkill, [...skills, supplementalSkill], { allowFallbackOnGenerationFailure: true });
  if (!supplemental) return undefined;
  return mergeSupplementalPayload(payload, supplemental);
}

function missingExpectedArtifactTypes(request: GatewayRequest, payload: ToolPayload) {
  const present = new Set(payload.artifacts
    .filter((artifact) => !artifactNeedsRepair(artifact))
    .map((artifact) => String(artifact.type || artifact.id || ''))
    .filter(Boolean));
  return expectedArtifactTypesForRequest(request).filter((artifactType) => !present.has(artifactType));
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
}

function mergeSupplementalPayload(base: ToolPayload, supplement: ToolPayload): ToolPayload {
  return {
    ...base,
    message: [base.message, supplement.message].filter(Boolean).join('\n'),
    confidence: Math.max(base.confidence ?? 0, supplement.confidence ?? 0),
    reasoningTrace: [base.reasoningTrace, 'Supplemental AgentServer/backend generation:', supplement.reasoningTrace].filter(Boolean).join('\n'),
    claims: [...base.claims, ...supplement.claims],
    uiManifest: mergeUiManifest(base.uiManifest, supplement.uiManifest),
    executionUnits: [...base.executionUnits, ...supplement.executionUnits],
    artifacts: mergeArtifacts(base.artifacts, supplement.artifacts),
    logs: [...base.logs ?? [], ...supplement.logs ?? []],
  };
}

function mergeArtifacts(left: Array<Record<string, unknown>>, right: Array<Record<string, unknown>>) {
  const byType = new Map<string, Record<string, unknown>>();
  for (const artifact of [...left, ...right]) {
    const key = String(artifact.type || artifact.id || byType.size);
    const existing = byType.get(key);
    const existingNeedsRepair = isRecord(existing?.metadata) && existing.metadata.status === 'repair-needed';
    if (!existing || existingNeedsRepair) byType.set(key, artifact);
  }
  return Array.from(byType.values());
}

function mergeUiManifest(left: Array<Record<string, unknown>>, right: Array<Record<string, unknown>>) {
  const keyFor = (slot: Record<string, unknown>) => `${String(slot.componentId || '')}:${String(slot.artifactRef || '')}`;
  const out = [...left];
  const seen = new Set(out.map(keyFor));
  for (const slot of right) {
    const key = keyFor(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out.map((slot, index) => ({ ...slot, priority: typeof slot.priority === 'number' ? slot.priority : index + 1 }));
}

function isLiveScpSkill(skillId: string) {
  return skillId.startsWith('scp.');
}

function shouldAttemptFreshTaskGeneration(request: GatewayRequest, skill: SkillAvailability) {
  if (request.uiState?.freshTaskGeneration !== true) return false;
  if (skill.manifest.entrypoint.type === 'agentserver-generation') return false;
  if (skill.manifest.entrypoint.type === 'inspector') return false;
  if (/capability[_\s-]*probe\s*[:=]\s*true/i.test(request.prompt)) return false;
  if (/\btool\s*=\s*["']?[A-Za-z0-9_.-]+["']?/i.test(request.prompt) && request.prompt.length < 240) return false;
  return true;
}

function shouldForceAgentServerGeneration(request: GatewayRequest) {
  if (request.uiState?.forceAgentServerGeneration === true) return true;
  const expectedArtifacts = expectedArtifactTypesForRequest(request);
  const selectedComponents = selectedComponentIdsForRequest(request);
  const prompt = request.prompt.toLowerCase();
  const wantsReport = expectedArtifacts.includes('research-report')
    || selectedComponents.includes('report-viewer')
    || /report|summary|summari[sz]e|systematic|read|reading|review|报告|总结|系统性|阅读|综述/.test(prompt);
  const wantsFreshExternalResearch = /\barxiv\b|\blatest\b|\btoday\b|\bweb\b|\bbrowser\b|最新|今天|今日|网页|浏览器/.test(prompt);
  const hasPriorContext = request.artifacts.length > 0 || toStringList(request.uiState?.recentConversation).length > 1;
  return wantsReport && (wantsFreshExternalResearch || hasPriorContext);
}

function payloadRequestsAgentServerGeneration(payload: ToolPayload) {
  if (payload.executionUnits.some((unit) => isRecord(unit) && unit.status === 'repair-needed')) return true;
  return payload.artifacts.some((artifact) => {
    if (!isRecord(artifact)) return false;
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    return metadata.requiresAgentServerGeneration === true || data.requiresAgentServerGeneration === true;
  });
}

async function tryAgentServerRepairAndRerun(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskPrefix: string;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
}): Promise<ToolPayload | undefined> {
  const baseUrl = params.request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(params.run.workspace);
  if (!baseUrl || process.env.BIOAGENT_ENABLE_AGENTSERVER_REPAIR === '0') return undefined;
  const workspace = params.run.workspace;
  const taskPath = join(workspace, params.run.spec.taskRel);
  const beforeCode = await readTextIfExists(taskPath);
  const priorAttempts = await readTaskAttempts(workspace, params.taskId);
  const repair = await requestAgentServerRepair({
    baseUrl,
    request: params.request,
    skill: params.skill,
    run: params.run,
    schemaErrors: params.schemaErrors,
    failureReason: params.failureReason,
    priorAttempts,
  });
  const afterCode = await readTextIfExists(taskPath);
  const diffSummary = repair.ok
    ? summarizeTextChange(beforeCode, afterCode, repair.diffSummary)
    : repair.error;
  const diffRel = `.bioagent/task-diffs/${params.taskId}-attempt-2.diff.txt`;
  await mkdir(dirname(join(workspace, diffRel)), { recursive: true });
  await writeFile(join(workspace, diffRel), diffSummary || 'AgentServer repair produced no diff summary.');

  if (!repair.ok) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt: 2,
      parentAttempt: 1,
      selfHealReason: params.failureReason,
      patchSummary: repair.error,
      diffRef: diffRel,
      status: 'failed',
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

  const outputRel = `.bioagent/task-results/${params.taskId}-attempt-2.json`;
  const stdoutRel = `.bioagent/logs/${params.taskId}-attempt-2.stdout.log`;
  const stderrRel = `.bioagent/logs/${params.taskId}-attempt-2.stderr.log`;
  const rerun = await runWorkspaceTask(workspace, {
    id: `${params.taskId}-attempt-2`,
    language: 'python',
    entrypoint: 'main',
    taskRel: params.run.spec.taskRel,
    input: {
      prompt: params.request.prompt,
      attempt: 2,
      parentAttempt: 1,
      skillId: params.skill.id,
      selfHealReason: params.failureReason,
      agentServerRunId: repair.runId,
    },
    outputRel,
    stdoutRel,
    stderrRel,
  });

  if (rerun.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt: 2,
      parentAttempt: 1,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed',
      codeRef: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-2.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: rerun.stderr || 'AgentServer repair rerun failed before writing output.',
      createdAt: new Date().toISOString(),
    });
    return undefined;
  }

  try {
    const payload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const errors = schemaErrors(payload);
    const normalized = validateAndNormalizePayload(payload, params.request, params.skill, {
      taskRel: params.run.spec.taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: rerun.runtimeFingerprint,
    });
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt: 2,
      parentAttempt: 1,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: errors.length ? 'repair-needed' : 'done',
      codeRef: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-2.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      schemaErrors: errors,
      createdAt: new Date().toISOString(),
    });
    if (errors.length) return undefined;
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request: params.request,
      skill: params.skill,
      taskId: params.taskId,
      taskRel: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-2.json`,
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
        `AgentServer repair run: ${repair.runId || 'unknown'}`,
        `Self-heal reason: ${params.failureReason}`,
        `Diff ref: ${diffRel}`,
        proposal ? `Skill promotion proposal: .bioagent/skill-proposals/${proposal.id}` : '',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(params.request, params.skill, params.failureReason),
        status: 'self-healed',
        attempt: 2,
        parentAttempt: 1,
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
      attempt: 2,
      parentAttempt: 1,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed',
      codeRef: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.taskId}-attempt-2.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`,
      createdAt: new Date().toISOString(),
    });
    return undefined;
  }
}

async function requestAgentServerGeneration(params: {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
}): Promise<{ ok: true; runId?: string; response: AgentServerGenerationResponse } | { ok: true; runId?: string; directPayload: ToolPayload } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.BIOAGENT_AGENTSERVER_GENERATION_TIMEOUT_MS || 300000));
  try {
    const backend = agentServerBackend();
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(params.request, params.workspace);
    const generationRequest = {
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      workspaceTreeSummary: await workspaceTreeSummary(params.workspace),
      availableSkills: params.skills.map((skill) => ({
        id: skill.id,
        kind: skill.kind,
        available: skill.available,
        reason: skill.reason,
        description: skill.manifest.description,
        entrypointType: skill.manifest.entrypoint.type,
        manifestPath: skill.manifestPath,
        scopeDeclaration: skill.manifest.scopeDeclaration,
      })),
      artifactSchema: expectedArtifactSchema(params.request),
      uiManifestContract: { expectedKeys: ['componentId', 'artifactRef', 'encoding', 'layout', 'compare'] },
      uiStateSummary: params.request.uiState,
      expectedArtifactTypes: expectedArtifactTypesForRequest(params.request),
      selectedComponentIds: params.request.selectedComponentIds ?? toStringList(params.request.uiState?.selectedComponentIds),
      priorAttempts: await readRecentTaskAttempts(params.workspace, params.request.skillDomain),
    };
    const response = await fetch(`${params.baseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        agent: {
          id: `bioagent-${params.request.skillDomain}-task-generation`,
          name: `BioAgent ${params.request.skillDomain} Task Generation`,
          backend,
          workspace: params.workspace,
          workingDirectory: params.workspace,
          reconcileExisting: true,
          systemPrompt: [
            'You generate BioAgent workspace-local task code.',
            'Write task files that accept inputPath and outputPath argv values and write a BioAgent ToolPayload JSON object.',
            'Do not create demo/default success artifacts; if the real task cannot be generated, explain the missing condition.',
          ].join(' '),
        },
        input: {
          text: buildAgentServerGenerationPrompt(generationRequest),
          metadata: {
            project: 'BioAgent',
            purpose: 'workspace-task-generation',
            skillDomain: params.request.skillDomain,
            skillId: params.skill.id,
          },
        },
        runtime: {
          backend,
          cwd: params.workspace,
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
          task: 'generation',
        },
      }),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text in the failure message below.
    }
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      return { ok: false, error: detail || `AgentServer generation HTTP ${response.status}: ${String(text).slice(0, 500)}` };
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    const run = isRecord(data.run) ? data.run : {};
    const runFailure = agentServerRunFailure(run);
    if (runFailure) {
      return { ok: false, error: runFailure };
    }
    const parsed = parseGenerationResponse(run.output);
    if (!parsed) {
      const directPayload = parseToolPayloadResponse(run);
      if (directPayload) {
        return {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload,
        };
      }
      const directText = extractAgentServerOutputText(run);
      if (directText && !looksLikeAgentServerFailure(directText)) {
        const parsedTextGeneration = parseGenerationResponse(extractJson(directText));
        if (parsedTextGeneration) {
          return {
            ok: true,
            runId: typeof run.id === 'string' ? run.id : undefined,
            response: parsedTextGeneration,
          };
        }
        return {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload: toolPayloadFromPlainAgentOutput(directText, params.request),
        };
      }
      return { ok: false, error: 'AgentServer generation response did not include taskFiles and entrypoint or a BioAgent ToolPayload.' };
    }
    return {
      ok: true,
      runId: typeof run.id === 'string' ? run.id : undefined,
      response: parsed,
    };
  } catch (error) {
    return { ok: false, error: `AgentServer generation request failed: ${errorMessage(error)}` };
  } finally {
    clearTimeout(timeout);
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
  const timeout = setTimeout(() => controller.abort(), Number(process.env.BIOAGENT_AGENTSERVER_REPAIR_TIMEOUT_MS || 300000));
  try {
    const backend = agentServerBackend();
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(params.request, params.run.workspace);
    const response = await fetch(`${params.baseUrl}/api/agent-server/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        agent: {
          id: `bioagent-${params.request.skillDomain}-runtime-repair`,
          name: `BioAgent ${params.request.skillDomain} Runtime Repair`,
          backend,
          workspace: params.run.workspace,
          workingDirectory: params.run.workspace,
          reconcileExisting: true,
          systemPrompt: [
            'You repair BioAgent workspace-local task code.',
            'Edit the referenced task file or adjacent helper files in the workspace, then stop.',
            'Preserve the task contract: task receives inputPath and outputPath argv values and writes a BioAgent ToolPayload JSON object.',
            'Do not create demo/default success artifacts; if the real task cannot be repaired, explain the missing condition.',
          ].join(' '),
        },
        input: {
          text: buildAgentServerRepairPrompt(params),
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
          },
        },
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
        },
      }),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text in the failure message below.
    }
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      return { ok: false, error: detail || `AgentServer repair HTTP ${response.status}: ${String(text).slice(0, 500)}` };
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
    return { ok: false, error: `AgentServer repair request failed: ${errorMessage(error)}` };
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

async function agentServerLlmRuntime(request: GatewayRequest, workspace: string): Promise<{
  modelProvider?: string;
  modelName?: string;
  llmEndpoint?: LlmEndpointConfig;
  llmEndpointSource?: string;
}> {
  const fromLocal = await readConfiguredLlmEndpoint(join(process.cwd(), 'config.local.json'), 'config.local.json');
  if (fromLocal) return fromLocal;
  const fromRequest = normalizeLlmEndpoint(request.llmEndpoint);
  if (fromRequest) {
    return {
      modelProvider: request.modelProvider?.trim() || fromRequest.provider,
      modelName: request.modelName?.trim() || fromRequest.modelName,
      llmEndpoint: fromRequest,
      llmEndpointSource: 'request',
    };
  }
  const fromWorkspace = await readConfiguredLlmEndpoint(join(workspace, '.bioagent', 'config.json'), 'workspace-config');
  if (fromWorkspace) return fromWorkspace;
  return {};
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
}) {
  return [
    'Repair this BioAgent workspace task and leave the workspace ready for BioAgent to rerun it.',
    '',
    JSON.stringify({
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      codeRef: params.run.spec.taskRel,
      inputRef: `.bioagent/task-inputs/${params.run.spec.id}.json`,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      exitCode: params.run.exitCode,
      schemaErrors: params.schemaErrors,
      failureReason: params.failureReason,
      uiStateSummary: params.request.uiState,
      artifacts: params.request.artifacts,
      priorAttempts: params.priorAttempts,
      expectedPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'uiManifest', 'executionUnits', 'artifacts'],
    }, null, 2),
    '',
    'Return a concise summary of files changed, tests or commands run, and any remaining blocker.',
  ].join('\n');
}

function buildAgentServerGenerationPrompt(request: {
  prompt: string;
  skillDomain: BioAgentSkillDomain;
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
  expectedArtifactTypes?: string[];
  selectedComponentIds?: string[];
  priorAttempts: unknown[];
}) {
  return [
    'Generate a BioAgent workspace task for this request.',
    'Return JSON matching AgentServerGenerationResponse: taskFiles, entrypoint, environmentRequirements, validationCommand, expectedArtifacts, and patchSummary.',
    'Generate fresh task code for this specific user request; do not reuse a prior run as the implementation source.',
    'Put generated task paths under .bioagent/tasks when possible. BioAgent will archive any returned taskFiles under .bioagent/tasks/<run-id>/ before execution.',
    'Prefer installed or workspace tools when they genuinely fit, but write adapter code as needed so the run is reproducible from inputPath and outputPath.',
    'If expectedArtifactTypes contains multiple artifacts, generate a coordinated Python task or small Python module set that emits every requested artifact type. A partial seed skill result is not enough unless the missing artifact has a clear failed-with-reason ExecutionUnit.',
    'Use the selectedComponentIds/UI contract to preserve promised UI slots; do not drop report, table, graph, structure, omics, or execution outputs just because one local skill only produces a subset.',
    'If a required input, remote file, credential, or executable is missing, write a valid ToolPayload with executionUnits.status="failed-with-reason" and a precise failureReason instead of fabricating outputs.',
    '',
    JSON.stringify({
      ...request,
      taskContract: {
        argv: ['inputPath', 'outputPath'],
        outputPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'uiManifest', 'executionUnits', 'artifacts'],
      },
    }, null, 2),
  ].join('\n');
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
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractJson(candidate) : candidate;
    if (!isRecord(parsed)) continue;
    const taskFiles = Array.isArray(parsed.taskFiles)
      ? parsed.taskFiles
        .map((file) => typeof file === 'string' ? { path: file, content: '', language: 'python' } : file)
        .filter(isRecord)
      : [];
    const entrypoint = normalizeGenerationEntrypoint(parsed.entrypoint);
    if (!taskFiles.length || typeof entrypoint.path !== 'string') continue;
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
      expectedArtifacts: Array.isArray(parsed.expectedArtifacts) ? parsed.expectedArtifacts.map(String) : [],
      patchSummary: typeof parsed.patchSummary === 'string' ? parsed.patchSummary : undefined,
    };
  }
  return undefined;
}

function normalizeGenerationEntrypoint(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return { language: 'python', path: value.trim() };
  }
  return isRecord(value) ? value : {};
}

function parseToolPayloadResponse(run: Record<string, unknown>): ToolPayload | undefined {
  const output = isRecord(run.output) ? run.output : {};
  const stages = Array.isArray(run.stages) ? run.stages.filter(isRecord) : [];
  const candidates: unknown[] = [
    output,
    output.result,
    output.text,
    ...stages.flatMap((stage) => {
      const result = isRecord(stage.result) ? stage.result : {};
      return [
        result.finalText,
        result.handoffSummary,
        result.output,
      ];
    }),
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'string' ? extractJson(candidate) : candidate;
    if (isToolPayload(parsed)) return parsed;
  }
  return undefined;
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
  return firstLine
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url')
    .slice(0, 320);
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

function looksLikeAgentServerFailure(text: string) {
  return /failed|error|exception|timeout|cannot|unable|无法|失败|错误|超时/i.test(text)
    && !/report|summary|artifact|报告|总结|结论|文献/i.test(text);
}

function toolPayloadFromPlainAgentOutput(text: string, request: GatewayRequest): ToolPayload {
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

function safeWorkspaceRel(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error(`Unsafe workspace-relative path: ${path}`);
  return normalized;
}

function generatedTaskArchiveRel(taskId: string, path: string) {
  const rel = safeWorkspaceRel(path);
  const archivePrefix = '.bioagent/tasks/';
  const withoutArchivePrefix = rel.startsWith(archivePrefix) ? rel.slice(archivePrefix.length) : rel;
  const withoutTaskPrefix = withoutArchivePrefix.startsWith(`${taskId}/`)
    ? withoutArchivePrefix.slice(taskId.length + 1)
    : withoutArchivePrefix;
  const archived = withoutTaskPrefix || 'task.py';
  return `${archivePrefix}${taskId}/${archived}`;
}

function validateAndNormalizePayload(
  payload: ToolPayload,
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
): ToolPayload {
  const errors = schemaErrors(payload);
  if (errors.length) {
    return repairNeededPayload(request, skill, `Task output failed schema validation: ${errors.join('; ')}`, refs);
  }
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
    } : unit),
    artifacts: normalizedArtifactsWithPlaceholders(Array.isArray(payload.artifacts) ? payload.artifacts : [], request),
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
  };
}

function normalizedArtifactsWithPlaceholders(artifacts: Array<Record<string, unknown>>, request: GatewayRequest) {
  const out = [...artifacts];
  const present = new Set(out.map((artifact) => String(artifact.type || artifact.id || '')).filter(Boolean));
  for (const artifactType of expectedArtifactTypesForRequest(request)) {
    if (present.has(artifactType)) continue;
    out.push({
      id: artifactType,
      type: artifactType,
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        status: 'repair-needed',
        reason: 'Compiled scenario expected this artifact but the selected local skill did not emit it.',
        recoverActions: ['agentserver-generate-python-task', 'repair-current-task', 'select-capable-skill'],
      },
      data: {
        rows: [],
        markdown: '',
        missingArtifactType: artifactType,
        requiresAgentServerGeneration: true,
      },
    });
  }
  return out;
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

const REGISTERED_COMPONENTS = new Set([
  'report-viewer',
  'paper-card-list',
  'molecule-viewer',
  'volcano-plot',
  'heatmap-viewer',
  'umap-viewer',
  'network-graph',
  'data-table',
  'evidence-matrix',
  'execution-unit-table',
  'notebook-timeline',
  'unknown-artifact-inspector',
]);

const COMPONENT_ALIASES: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'report-viewer', patterns: [/report[-\s]?viewer/i, /research[-\s]?report/i, /报告|总结|系统性整理/i] },
  { id: 'paper-card-list', patterns: [/paper[-\s]?card/i, /paper[-\s]?list/i, /文献卡片|文献列表|论文列表/i] },
  { id: 'molecule-viewer', patterns: [/molecule[-\s]?viewer/i, /structure viewer/i, /mol\*/i, /分子|结构查看|蛋白结构/i] },
  { id: 'volcano-plot', patterns: [/volcano/i, /火山图/i] },
  { id: 'heatmap-viewer', patterns: [/heatmap/i, /热图/i] },
  { id: 'umap-viewer', patterns: [/umap/i, /降维/i] },
  { id: 'network-graph', patterns: [/network[-\s]?graph/i, /drug[-\s]?target network/i, /knowledge graph/i, /网络图|知识图谱|关系网络/i] },
  { id: 'data-table', patterns: [/data[-\s]?table/i, /\btable\b/i, /blast/i, /alignment hits?/i, /数据表|表格|证据表|知识卡片|比对结果/i] },
  { id: 'evidence-matrix', patterns: [/evidence[-\s]?matrix/i, /证据矩阵|证据表/i] },
  { id: 'execution-unit-table', patterns: [/execution[-\s]?unit/i, /可复现|执行单元/i] },
  { id: 'notebook-timeline', patterns: [/notebook[-\s]?timeline/i, /研究记录|时间线/i] },
  { id: 'unknown-artifact-inspector', patterns: [/inspector/i, /原始\s*json|raw json|日志/i] },
];

const DOMAIN_DEFAULT_COMPONENTS: Record<string, string[]> = {
  literature: ['paper-card-list', 'evidence-matrix', 'execution-unit-table'],
  structure: ['molecule-viewer', 'evidence-matrix', 'execution-unit-table'],
  omics: ['volcano-plot', 'heatmap-viewer', 'umap-viewer', 'execution-unit-table'],
  knowledge: ['network-graph', 'data-table', 'evidence-matrix', 'execution-unit-table'],
};

export function composeRuntimeUiManifest(
  incoming: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  request: Pick<GatewayRequest, 'prompt' | 'skillDomain' | 'uiState' | 'selectedComponentIds'>,
): Array<Record<string, unknown>> {
  const override = isRecord(request.uiState?.scenarioOverride) ? request.uiState.scenarioOverride : undefined;
  const overrideComponents = toStringList(override?.defaultComponents).filter((id) => REGISTERED_COMPONENTS.has(id));
  const selectedComponents = selectedComponentIdsForRequest(request).filter((id) => REGISTERED_COMPONENTS.has(id));
  const promptComponents = componentsRequestedByPrompt(request.prompt);
  const incomingComponents = incoming
    .map((slot) => typeof slot.componentId === 'string' ? slot.componentId : undefined)
    .filter((id): id is string => typeof id === 'string' && REGISTERED_COMPONENTS.has(id));
  const componentIds = uniqueStrings([
    ...overrideComponents,
    ...selectedComponents,
    ...promptComponents,
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length ? [] : incomingComponents),
    ...(overrideComponents.length || selectedComponents.length || promptComponents.length || incomingComponents.length ? [] : DOMAIN_DEFAULT_COMPONENTS[request.skillDomain] ?? []),
    ...(componentNegated(request.prompt, 'execution-unit-table') ? [] : ['execution-unit-table']),
  ]).slice(0, 6);
  const sourceByComponent = new Map(incoming.map((slot) => [String(slot.componentId || ''), slot]));
  return componentIds.map((componentId, index) => {
    const base = sourceByComponent.get(componentId) ?? {};
    return {
      ...base,
      componentId,
      title: typeof base.title === 'string' && base.title.trim() ? base.title : titleForComponent(componentId),
      artifactRef: typeof base.artifactRef === 'string' && base.artifactRef.trim()
        ? base.artifactRef
        : inferArtifactRef(componentId, artifacts),
      priority: typeof base.priority === 'number' ? base.priority : index + 1,
      encoding: isRecord(base.encoding) ? base.encoding : inferEncoding(request.prompt, componentId),
      layout: isRecord(base.layout) ? base.layout : inferLayout(request.prompt),
    };
  });
}

function componentsRequestedByPrompt(prompt: string) {
  return COMPONENT_ALIASES
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(prompt)))
    .filter((entry) => !componentNegated(prompt, entry.id))
    .map((entry) => entry.id);
}

function componentNegated(prompt: string, componentId: string) {
  const labels: Record<string, string[]> = {
    'paper-card-list': ['paper', '文献', '论文'],
    'molecule-viewer': ['molecule', 'structure', '结构', '分子'],
    'volcano-plot': ['volcano', '火山图'],
    'heatmap-viewer': ['heatmap', '热图'],
    'umap-viewer': ['umap'],
    'network-graph': ['network', '网络图', '知识图谱'],
    'data-table': ['table', '表格', '数据表'],
    'evidence-matrix': ['evidence matrix', '证据矩阵'],
    'execution-unit-table': ['execution unit', '执行单元', '可复现'],
    'notebook-timeline': ['timeline', 'notebook', '时间线', '研究记录'],
  };
  return (labels[componentId] ?? []).some((label) => {
    const escaped = escapeRegExp(label);
    return new RegExp(`(?:不需要|不要|无需|\\bwithout\\b|\\bno\\b)[^。；;,.，\\n]{0,32}${escaped}`, 'i').test(prompt)
      || new RegExp(`${escaped}[^。；;,.，\\n]{0,16}(?:不需要|不要|无需|\\bwithout\\b|\\bno\\b)`, 'i').test(prompt);
  });
}

function inferArtifactRef(componentId: string, artifacts: Array<Record<string, unknown>>) {
  if (componentId === 'evidence-matrix' || componentId === 'execution-unit-table' || componentId === 'notebook-timeline') {
    return firstArtifactRef(artifacts);
  }
  const targetType = componentTargetType(componentId, artifacts);
  if (targetType === 'research-report') return 'research-report';
  const direct = artifacts.find((artifact) => artifact.type === targetType || artifact.id === targetType);
  return refForArtifact(direct) ?? firstArtifactRef(artifacts);
}

function componentTargetType(componentId: string, artifacts: Array<Record<string, unknown>>) {
  if (componentId === 'paper-card-list') return 'paper-list';
  if (componentId === 'report-viewer') return 'research-report';
  if (componentId === 'molecule-viewer') return 'structure-summary';
  if (componentId === 'volcano-plot' || componentId === 'heatmap-viewer' || componentId === 'umap-viewer') return 'omics-differential-expression';
  if (componentId === 'network-graph') return 'knowledge-graph';
  if (componentId === 'data-table') {
    return artifacts.find((artifact) => artifact.type === 'sequence-alignment') ? 'sequence-alignment' : 'knowledge-graph';
  }
  return undefined;
}

function firstArtifactRef(artifacts: Array<Record<string, unknown>>) {
  return refForArtifact(artifacts[0]);
}

function refForArtifact(artifact?: Record<string, unknown>) {
  if (!artifact) return undefined;
  return typeof artifact.id === 'string' ? artifact.id : typeof artifact.type === 'string' ? artifact.type : undefined;
}

function inferEncoding(prompt: string, componentId: string) {
  const encoding: Record<string, unknown> = {};
  const colorBy = prompt.match(/(?:colorBy|按)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:着色|color)/i)?.[1];
  const splitBy = prompt.match(/(?:splitBy|按)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:分组|拆分|split|facet)/i)?.[1];
  const highlight = prompt.match(/(?:highlight|高亮|标记)\s*([A-Za-z0-9_,\-\s]+)/i)?.[1];
  if (colorBy && (componentId === 'umap-viewer' || componentId === 'network-graph')) encoding.colorBy = colorBy;
  if (splitBy) encoding.splitBy = splitBy;
  if (highlight) encoding.highlightSelection = highlight.split(/[\s,，]+/).filter(Boolean).slice(0, 12);
  return Object.keys(encoding).length ? encoding : undefined;
}

function inferLayout(prompt: string) {
  if (/side[-\s]?by[-\s]?side|并排|对比/.test(prompt)) return { mode: 'side-by-side', columns: 2 };
  if (/grid|网格/.test(prompt)) return { mode: 'grid', columns: 2 };
  return undefined;
}

function titleForComponent(componentId: string) {
  const titles: Record<string, string> = {
    'paper-card-list': '文献卡片',
    'molecule-viewer': '分子结构查看器',
    'volcano-plot': '火山图',
    'heatmap-viewer': '热图',
    'umap-viewer': 'UMAP',
    'network-graph': '知识网络',
    'data-table': '数据表',
    'evidence-matrix': '证据矩阵',
    'execution-unit-table': '可复现执行单元',
    'notebook-timeline': '研究记录',
    'unknown-artifact-inspector': 'Artifact Inspector',
  };
  return titles[componentId] ?? componentId;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: Partial<{ taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string }> = {},
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
      failureReason: reason,
      ...attemptPlanRefs(request, skill, reason),
      requiredInputs: requiredInputsForRepair(request, reason),
      recoverActions: recoverActionsForRepair(reason),
      nextStep: nextStepForRepair(reason),
      attempt: 1,
    }],
    artifacts: [],
  };
}

function requiredInputsForRepair(request: GatewayRequest, reason: string) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (/agentserver|base url/i.test(reason)) inputs.push('agentServerBaseUrl');
  if (/credential|token|api key/i.test(reason)) inputs.push('credentials');
  if (/file|path|input/i.test(reason)) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

function recoverActionsForRepair(reason: string) {
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cleanUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

async function readTextIfExists(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function summarizeTextChange(before: string, after: string, agentSummary?: string) {
  const lines = [
    agentSummary ? `AgentServer summary:\n${agentSummary}` : '',
    before === after
      ? 'No direct change detected in the task code file.'
      : [
          'Task code changed.',
          `Before SHA1: ${sha1(before).slice(0, 12)}`,
          `After SHA1: ${sha1(after).slice(0, 12)}`,
          simpleLineDiff(before, after),
        ].join('\n'),
  ].filter(Boolean);
  return lines.join('\n\n');
}

function simpleLineDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const changes: string[] = [];
  for (let index = 0; index < max && changes.length < 80; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (beforeLines[index] !== undefined) changes.push(`-${index + 1}: ${beforeLines[index]}`);
    if (afterLines[index] !== undefined) changes.push(`+${index + 1}: ${afterLines[index]}`);
  }
  if (changes.length === 80) changes.push('...diff truncated...');
  return changes.join('\n') || 'Content changed, but no line-level preview was produced.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
