import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { runWorkspaceTask } from '../workspace-task-runner.js';

export interface WorkspaceRunnerAdapter {
  runGeneratedTask(workspace: string, spec: Parameters<typeof runWorkspaceTask>[1]): Promise<WorkspaceTaskRunResult>;
  runPythonWorkspaceSkill?(
    request: GatewayRequest,
    skill: SkillAvailability,
    taskPrefix: string,
    callbacks?: WorkspaceRuntimeCallbacks,
  ): Promise<ToolPayload>;
}

export function createWorkspaceRunnerAdapter(): WorkspaceRunnerAdapter {
  return {
    runGeneratedTask: runWorkspaceTask,
  };
}
