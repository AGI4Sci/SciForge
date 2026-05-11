import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { evaluateRawDataPreExecutionGuard } from '@sciforge-ui/runtime-contract/raw-data-execution-guard';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { errorMessage, generatedTaskArchiveRel, isTaskInputRel, safeWorkspaceRel } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { readGeneratedTaskFileIfPresent, type AgentServerTaskFilesGeneration } from './generated-task-runner-generation-lifecycle.js';
import { expectedArtifactTypesForGeneratedRun, supplementScopeForGeneratedRun } from './generated-task-runner-supplement-lifecycle.js';
import { buildGeneratedTaskRunInputLifecycle, type GeneratedTaskRuntimeRefs } from './generated-task-runner-validation-lifecycle.js';
import type { GeneratedTaskRunnerDeps } from './generated-task-runner.js';
import { AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE } from '../../../packages/skills/runtime-policy';

export interface GeneratedTaskExecutionLifecycleInput {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerTaskFilesGeneration;
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: Pick<GeneratedTaskRunnerDeps, 'repairNeededPayload'>;
}

export interface GeneratedTaskExecutionLifecycleRun extends GeneratedTaskRuntimeRefs {
  taskId: string;
  sessionBundleRel?: string;
  run: WorkspaceTaskRunResult;
  supplementArtifactTypes: string[];
}

export type GeneratedTaskExecutionLifecycleResult =
  | { kind: 'run'; execution: GeneratedTaskExecutionLifecycleRun }
  | { kind: 'payload'; payload: ToolPayload };

export async function runGeneratedTaskExecutionLifecycle(
  input: GeneratedTaskExecutionLifecycleInput,
): Promise<GeneratedTaskExecutionLifecycleResult> {
  const taskId = `generated-${input.request.skillDomain}-${sha1(`${input.request.prompt}:${Date.now()}`).slice(0, 12)}`;
  const sessionBundleRel = sessionBundleRelForRequest(input.request);
  await ensureSessionBundle(input.workspace, sessionBundleRel, {
    sessionId: typeof input.request.uiState?.sessionId === 'string' ? input.request.uiState.sessionId : 'sessionless',
    scenarioId: input.request.scenarioPackageRef?.id || input.request.skillDomain,
    createdAt: typeof input.request.uiState?.sessionCreatedAt === 'string' ? input.request.uiState.sessionCreatedAt : undefined,
    updatedAt: typeof input.request.uiState?.sessionUpdatedAt === 'string' ? input.request.uiState.sessionUpdatedAt : undefined,
  });
  const materialized = await materializeGeneratedTaskFiles({
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    taskId,
    sessionBundleRel,
    generation: input.generation,
    callbacks: input.callbacks,
    deps: input.deps,
  });
  if (materialized.kind === 'payload') return materialized;

  const refs = generatedTaskRuntimeRefs(input.generation, taskId, materialized.generatedPathMap, sessionBundleRel);
  const rawDataGuard = evaluateRawDataPreExecutionGuard({
    taskFiles: input.generation.response.taskFiles,
    artifacts: input.request.artifacts,
    references: input.request.references,
    uiState: input.request.uiState,
    actionSideEffects: input.request.actionSideEffects,
  });
  if (rawDataGuard.blocked) {
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(input.request, input.skill, rawDataGuard.reason ?? 'Raw-data pre-execution guard blocked generated task execution.', {
        rawDataPreExecutionGuard: rawDataGuard,
        taskRel: refs.taskRel,
      }),
    };
  }
  const expectedArtifacts = expectedArtifactTypesForGeneratedRun(input.request, input.generation.response.expectedArtifacts);
  const taskInputLifecycle = await buildGeneratedTaskRunInputLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    generatedInputRels: materialized.generatedInputRels,
    expectedArtifacts,
  });
  const run = await runWorkspaceTask(input.workspace, {
    id: taskId,
    language: input.generation.response.entrypoint.language,
    entrypoint: input.generation.response.entrypoint.command || 'main',
    entrypointArgs: input.generation.response.entrypoint.args,
    taskRel: refs.taskRel,
    input: taskInputLifecycle.taskInput,
    retentionProtectedInputRels: taskInputLifecycle.retentionProtectedInputRels,
    outputRel: refs.outputRel,
    stdoutRel: refs.stdoutRel,
    stderrRel: refs.stderrRel,
    inputRel: refs.inputRel,
    sessionBundleRel,
  });

  return {
    kind: 'run',
    execution: {
      taskId,
      sessionBundleRel,
      run,
      ...refs,
      supplementArtifactTypes: supplementScopeForGeneratedRun(input.request, input.generation.response.expectedArtifacts),
    },
  };
}

async function materializeGeneratedTaskFiles(input: GeneratedTaskExecutionLifecycleInput & { taskId: string; sessionBundleRel: string }): Promise<
  | { kind: 'materialized'; generatedPathMap: Map<string, string>; generatedInputRels: string[] }
  | { kind: 'payload'; payload: ToolPayload }
> {
  const generatedPathMap = new Map<string, string>();
  const generatedInputRels: string[] = [];
  try {
    for (const file of input.generation.response.taskFiles) {
      const declaredRel = safeWorkspaceRel(file.path);
      const rel = generatedTaskArchiveRel(input.taskId, declaredRel, input.sessionBundleRel);
      generatedPathMap.set(declaredRel, rel);
      if (isTaskInputRel(declaredRel)) generatedInputRels.push(declaredRel);
      const content = file.content || await readGeneratedTaskFileIfPresent(input.workspace, file.path);
      if (content === undefined) {
        return {
          kind: 'payload',
          payload: input.deps.repairNeededPayload(
            input.request,
            input.skill,
            `AgentServer returned taskFiles path-only reference but SciForge could not read workspace file: ${declaredRel}`,
          ),
        };
      }
      await mkdir(dirname(join(input.workspace, declaredRel)), { recursive: true });
      await writeFile(join(input.workspace, declaredRel), content);
      await mkdir(dirname(join(input.workspace, rel)), { recursive: true });
      await writeFile(join(input.workspace, rel), content);
      emitWorkspaceRuntimeEvent(input.callbacks, {
        type: AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
        source: 'workspace-runtime',
        message: `Materialized AgentServer task file ${declaredRel}`,
        detail: rel === declaredRel ? declaredRel : `${declaredRel} -> ${rel}`,
      });
    }
  } catch (error) {
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(
        input.request,
        input.skill,
        `AgentServer generated task files could not be archived: ${sanitizeAgentServerError(errorMessage(error))}`,
      ),
    };
  }
  return { kind: 'materialized', generatedPathMap, generatedInputRels };
}

function generatedTaskRuntimeRefs(
  generation: AgentServerTaskFilesGeneration,
  taskId: string,
  generatedPathMap: Map<string, string>,
  sessionBundleRel?: string,
): GeneratedTaskRuntimeRefs {
  const entrypointOriginalRel = safeWorkspaceRel(generation.response.entrypoint.path);
  return {
    taskRel: generatedPathMap.get(entrypointOriginalRel) ?? generatedTaskArchiveRel(taskId, generation.response.entrypoint.path, sessionBundleRel),
    inputRel: sessionBundleResourceRel(sessionBundleRel, 'task-inputs', `${taskId}.json`),
    outputRel: sessionBundleResourceRel(sessionBundleRel, 'task-results', `${taskId}.json`),
    stdoutRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stdout.log`),
    stderrRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stderr.log`),
  };
}
