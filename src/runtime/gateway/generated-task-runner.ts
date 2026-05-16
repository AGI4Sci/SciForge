import { resolve } from 'node:path';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import {
  completeAgentServerGenerationFailureLifecycle,
  completeAgentServerDirectPayloadLifecycle,
  resolveGeneratedTaskGenerationRetryLifecycle,
  type AgentServerGenerationResult,
} from './generated-task-runner-generation-lifecycle.js';
import { runGeneratedTaskExecutionLifecycle } from './generated-task-runner-execution-lifecycle.js';
import { completeGeneratedTaskRunOutputLifecycle } from './generated-task-runner-output-lifecycle.js';

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
  failedTaskPayload(
    request: GatewayRequest,
    skill: SkillAvailability,
    run: WorkspaceTaskRunResult,
    parseReason?: string,
    refs?: Record<string, unknown>,
  ): ToolPayload;
  coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined;
  normalizeToolPayloadShape(payload: ToolPayload): ToolPayload;
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
    readConfiguredAgentServerBaseUrl,
    repairNeededPayload,
    requestAgentServerGeneration,
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
    return await completeAgentServerGenerationFailureLifecycle({
      workspace,
      request,
      skill,
      generation,
      callbacks,
      deps,
    });
  }
  if ('directPayload' in generation) {
    return await completeAgentServerDirectPayloadLifecycle({
      workspace,
      request,
      skill,
      generation,
      deps,
      kind: 'initial',
      stableTaskKind: 'direct',
      logLine: `AgentServer direct ToolPayload run: ${generation.runId || 'unknown'}\n`,
      source: 'agentserver-direct-payload',
      callbacks,
    });
  }

  const generationLifecycle = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl,
    request,
    skill,
    skills,
    workspace,
    callbacks,
    generation,
    deps,
  });
  if (generationLifecycle.kind === 'payload') return generationLifecycle.payload;
  generation = generationLifecycle.generation;

  const executionLifecycle = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation,
    callbacks,
    deps,
  });
  if (executionLifecycle.kind === 'payload') return executionLifecycle.payload;
  const { run, supplementArtifactTypes, taskId, taskRel, inputRel, outputRel, stdoutRel, stderrRel } = executionLifecycle.execution;

  return await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills,
    callbacks,
    deps,
    options,
    taskId,
    generation,
    run,
    taskRel,
    inputRel,
    outputRel,
    stdoutRel,
    stderrRel,
    supplementArtifactTypes,
    runGeneratedTask: runAgentServerGeneratedTask,
  });
}
