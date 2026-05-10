import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord, safeWorkspaceRel } from '../gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sha1 } from '../workspace-task-runner.js';
import { materializeBackendPayloadOutput, type RuntimeRefBundle } from './artifact-materializer.js';
import {
  appendGeneratedTaskDirectPayloadAttemptLifecycle,
  assessGeneratedTaskDirectPayloadLifecycle,
} from './generated-task-runner-validation-lifecycle.js';
import {
  AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
  agentServerGeneratedEntrypointContractReason,
  agentServerGeneratedTaskInterfaceContractReason,
  agentServerGeneratedTaskRetryDetail,
  agentServerPathOnlyStrictRetryDirectPayloadReason,
  agentServerPathOnlyStrictRetryStillMissingReason,
  agentServerPathOnlyTaskFilesReason,
  agentServerStablePayloadTaskId,
} from '../../../packages/skills/runtime-policy';

export const AGENTSERVER_DIRECT_PAYLOAD_TASK_REF = 'agentserver://direct-payload' as const;

export type AgentServerGenerationResult =
  | AgentServerTaskFilesGeneration
  | AgentServerDirectPayloadGeneration
  | { ok: false; error: string; diagnostics?: any };

export interface AgentServerTaskFilesGeneration {
  ok: true;
  runId?: string;
  response: AgentServerGenerationResponse;
}

export interface AgentServerDirectPayloadGeneration {
  ok: true;
  runId?: string;
  directPayload: ToolPayload;
}

type AttemptPlanRefs = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;

export interface GeneratedTaskGenerationLifecycleDeps {
  requestAgentServerGeneration(params: {
    baseUrl: string;
    request: GatewayRequest;
    skill: SkillAvailability;
    skills: SkillAvailability[];
    workspace: string;
    callbacks?: WorkspaceRuntimeCallbacks;
    strictTaskFilesReason?: string;
  }): Promise<AgentServerGenerationResult>;
  attemptPlanRefs: AttemptPlanRefs;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload;
  mergeReusableContextArtifactsForDirectPayload(payload: ToolPayload, request: GatewayRequest): Promise<ToolPayload>;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
  firstPayloadFailureReason(payload: ToolPayload): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
}

export interface ResolveGeneratedTaskGenerationLifecycleInput {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  generation: AgentServerTaskFilesGeneration;
  deps: GeneratedTaskGenerationLifecycleDeps;
}

export type ResolveGeneratedTaskGenerationLifecycleResult =
  | { kind: 'task-files'; generation: AgentServerTaskFilesGeneration }
  | { kind: 'payload'; payload: ToolPayload };

export async function resolveGeneratedTaskGenerationRetryLifecycle(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  let generation = input.generation;
  const entrypointResult = await retryGeneratedTaskEntrypointContract(input, generation);
  if (entrypointResult.kind === 'payload') return entrypointResult;
  generation = entrypointResult.generation;

  const pathOnlyResult = await retryGeneratedTaskPathOnlyContract(input, generation);
  if (pathOnlyResult.kind === 'payload') return pathOnlyResult;
  generation = pathOnlyResult.generation;

  const interfaceResult = await retryGeneratedTaskInterfaceContract(input, generation);
  if (interfaceResult.kind === 'payload') return interfaceResult;
  return interfaceResult;
}

export async function completeAgentServerDirectPayloadLifecycle(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerDirectPayloadGeneration;
  deps: Omit<GeneratedTaskGenerationLifecycleDeps, 'requestAgentServerGeneration'>;
  kind: 'initial' | 'strict-retry';
  stableTaskKind: string;
  logLine: string;
  source: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}): Promise<ToolPayload> {
  const refs = backendPayloadRefs(
    stableAgentServerPayloadTaskId(input.stableTaskKind, input.request, input.skill, input.generation.runId),
    AGENTSERVER_DIRECT_PAYLOAD_TASK_REF,
  );
  await writeBackendPayloadLogs(input.workspace, refs, input.logLine);
  const directPayload = await input.deps.mergeReusableContextArtifactsForDirectPayload(
    input.deps.ensureDirectAnswerReportArtifact(
      input.generation.directPayload,
      input.request,
      input.source,
    ),
    input.request,
  );
  let normalized = await input.deps.validateAndNormalizePayload(directPayload, input.request, input.skill, {
    ...refs,
    runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: input.generation.runId },
  });
  normalized = await materializeBackendPayloadOutput(input.workspace, input.request, normalized, refs);
  if (input.kind === 'strict-retry') return normalized;

  const lifecycle = assessGeneratedTaskDirectPayloadLifecycle({
    payload: normalized,
    request: input.request,
    firstPayloadFailureReason: input.deps.firstPayloadFailureReason,
    payloadHasFailureStatus: input.deps.payloadHasFailureStatus,
  });
  await appendGeneratedTaskDirectPayloadAttemptLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    runId: input.generation.runId,
    refs,
    lifecycle,
    attemptPlanRefs: input.deps.attemptPlanRefs,
  });
  if (lifecycle.guardFailureReason) {
    return input.deps.repairNeededPayload(input.request, input.skill, lifecycle.guardFailureReason);
  }
  if (lifecycle.payloadFailureStatus) return normalized;
  const completed = {
    ...normalized,
    reasoningTrace: [
      normalized.reasoningTrace,
      `AgentServer generation run: ${input.generation.runId || 'unknown'}`,
      'AgentServer returned a SciForge ToolPayload directly; no workspace task archive was required.',
    ].filter(Boolean).join('\n'),
    executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
      ...unit,
      ...input.deps.attemptPlanRefs(input.request, input.skill),
      agentServerGenerated: true,
      agentServerRunId: input.generation.runId,
    } : unit),
  };
  return await materializeBackendPayloadOutput(input.workspace, input.request, completed, refs);
}

export function backendPayloadRefs(taskId: string, taskRel: string): RuntimeRefBundle {
  return {
    taskRel,
    outputRel: `.sciforge/task-results/${taskId}.json`,
    stdoutRel: `.sciforge/logs/${taskId}.stdout.log`,
    stderrRel: `.sciforge/logs/${taskId}.stderr.log`,
  };
}

export function stableAgentServerPayloadTaskId(
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

export async function writeBackendPayloadLogs(
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

export async function readGeneratedTaskFileIfPresent(workspace: string, path: string) {
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

async function retryGeneratedTaskEntrypointContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const nonExecutableEntrypointReason = agentServerGeneratedEntrypointContractReason(generation.response, { normalizePath: safeWorkspaceRel });
  if (!nonExecutableEntrypointReason) return { kind: 'task-files', generation };
  emitGenerationRetryEvent(input.callbacks, nonExecutableEntrypointReason, 'entrypoint');
  const retriedGeneration = await requestStrictGenerationRetry(input, nonExecutableEntrypointReason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-entrypoint',
        logLine: `AgentServer strict retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retryReason = agentServerGeneratedEntrypointContractReason(retriedGeneration.response, { normalizePath: safeWorkspaceRel });
  if (retryReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${nonExecutableEntrypointReason}. Strict retry still returned invalid entrypoint: ${retryReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskPathOnlyContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const missingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(input.workspace, generation.response.taskFiles);
  if (!missingPathOnlyTaskFiles.length) return { kind: 'task-files', generation };
  const reason = agentServerPathOnlyTaskFilesReason(missingPathOnlyTaskFiles);
  emitGenerationRetryEvent(input.callbacks, reason, 'path-only-task-files');
  const retriedGeneration = await requestStrictGenerationRetry(input, reason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return repairNeeded(input, agentServerPathOnlyStrictRetryDirectPayloadReason(reason));
  }
  const stillMissingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(input.workspace, retriedGeneration.response.taskFiles);
  if (stillMissingPathOnlyTaskFiles.length) {
    const contractReason = agentServerPathOnlyStrictRetryStillMissingReason(reason, stillMissingPathOnlyTaskFiles);
    return repairNeeded(input, `AgentServer generation contract violation: ${contractReason}`);
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskInterfaceContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const taskInterfaceReason = await generatedTaskInterfaceContractReason(input.workspace, generation.response);
  if (!taskInterfaceReason) return { kind: 'task-files', generation };
  emitGenerationRetryEvent(input.callbacks, taskInterfaceReason, 'task-interface');
  const retriedGeneration = await requestStrictGenerationRetry(input, taskInterfaceReason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-interface',
        logLine: `AgentServer interface retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retryInterfaceReason = await generatedTaskInterfaceContractReason(input.workspace, retriedGeneration.response);
  if (retryInterfaceReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${taskInterfaceReason}. Strict retry still returned a static/non-interface task: ${retryInterfaceReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function generatedTaskInterfaceContractReason(workspace: string, response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content === undefined) return undefined;
  const language = String(response.entrypoint.language || '').toLowerCase();
  return agentServerGeneratedTaskInterfaceContractReason({ entryRel, language, source: content });
}

function directPayloadCompletionInput(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerDirectPayloadGeneration,
) {
  return {
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    generation,
    deps: input.deps,
    callbacks: input.callbacks,
  };
}

function emitGenerationRetryEvent(
  callbacks: WorkspaceRuntimeCallbacks | undefined,
  message: string,
  kind: Parameters<typeof agentServerGeneratedTaskRetryDetail>[0],
) {
  emitWorkspaceRuntimeEvent(callbacks, {
    type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
    source: 'workspace-runtime',
    status: 'running',
    message,
    detail: agentServerGeneratedTaskRetryDetail(kind),
  });
}

function requestStrictGenerationRetry(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  strictTaskFilesReason: string,
) {
  return input.deps.requestAgentServerGeneration({
    baseUrl: input.baseUrl,
    request: input.request,
    skill: input.skill,
    skills: input.skills,
    workspace: input.workspace,
    callbacks: input.callbacks,
    strictTaskFilesReason,
  });
}

function repairNeeded(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  reason: string,
): { kind: 'payload'; payload: ToolPayload } {
  return {
    kind: 'payload',
    payload: input.deps.repairNeededPayload(input.request, input.skill, reason),
  };
}
