import type { GatewayRequest, SkillAvailability, SkillPromotionProposal, ToolPayload, WorkspaceTaskRunResult, WorkspaceTaskSpec } from './runtime-types.js';
import type { WorkEvidence } from './gateway/work-evidence-types.js';
import type {
  TaskProjectStatus as RuntimeTaskProjectStatus,
  TaskStageStatus as RuntimeTaskStageStatus,
} from '@sciforge-ui/runtime-contract';

export {
  TASK_PROJECT_STATUSES,
  TASK_STAGE_STATUSES,
} from '@sciforge-ui/runtime-contract';

export const TASK_PROJECT_SCHEMA_VERSION = 'sciforge.task-project.v1';
export const TASK_PROJECT_PLAN_SCHEMA_VERSION = 'sciforge.task-project-plan.v1';
export const TASK_STAGE_SCHEMA_VERSION = 'sciforge.task-stage.v1';
export const TASK_PROJECT_HANDOFF_SCHEMA_VERSION = 'sciforge.task-project-handoff.v1';
export const TASK_PROJECT_STAGE_HANDOFF_SCHEMA_VERSION = 'sciforge.task-project-stage-handoff.v1';

export type TaskProjectStatus = RuntimeTaskProjectStatus;
export type TaskProjectGuidanceStatus = 'queued' | 'adopted' | 'deferred' | 'rejected';
export type TaskStageKind =
  | 'plan'
  | 'research'
  | 'design'
  | 'implement'
  | 'execute'
  | 'verify'
  | 'repair'
  | 'summarize'
  | (string & {});
export type TaskStageStatus = RuntimeTaskStageStatus;

export interface TaskProjectPaths {
  root: string;
  projectJson: string;
  planJson: string;
  stages: string;
  src: string;
  artifacts: string;
  evidence: string;
  logs: string;
}

export interface TaskProjectGuidance {
  id: string;
  message: string;
  status: TaskProjectGuidanceStatus;
  source?: string;
  stageId?: string;
  decision?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TaskProject {
  schemaVersion: typeof TASK_PROJECT_SCHEMA_VERSION;
  id: string;
  title: string;
  goal: string;
  status: TaskProjectStatus;
  createdAt: string;
  updatedAt: string;
  paths: TaskProjectPaths;
  stageRefs: string[];
  latestStageRef?: string;
  guidanceQueue?: TaskProjectGuidance[];
  metadata?: Record<string, unknown>;
}

export interface TaskStage {
  schemaVersion: typeof TASK_STAGE_SCHEMA_VERSION;
  id: string;
  projectId: string;
  index: number;
  kind: TaskStageKind;
  status: TaskStageStatus;
  goal: string;
  codeRef?: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  workEvidence?: WorkEvidence[];
  evidenceRefs: string[];
  artifactRefs: string[];
  failureReason?: string;
  diagnostics: string[];
  recoverActions: string[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskProjectPlanStage {
  id: string;
  index: number;
  kind: TaskStageKind;
  status: TaskStageStatus;
  goal: string;
  ref: string;
}

export interface TaskProjectPlan {
  schemaVersion: typeof TASK_PROJECT_PLAN_SCHEMA_VERSION;
  projectId: string;
  stageRefs: string[];
  stages: TaskProjectPlanStage[];
  updatedAt: string;
}

export interface TaskProjectReadResult {
  project: TaskProject;
  plan: TaskProjectPlan;
  stages: TaskStage[];
}

export interface TaskProjectSummaryForHandoff {
  schemaVersion: typeof TASK_PROJECT_HANDOFF_SCHEMA_VERSION;
  project: Pick<TaskProject, 'id' | 'title' | 'goal' | 'status' | 'createdAt' | 'updatedAt'>;
  refs: {
    projectRef: string;
    planRef: string;
    stageRefs: string[];
    latestStageRef?: string;
    dirs: {
      src: string;
      artifacts: string;
      evidence: string;
      logs: string;
    };
  };
  stages: Array<Pick<TaskStage, 'id' | 'index' | 'kind' | 'status' | 'goal' | 'codeRef' | 'inputRef' | 'outputRef' | 'stdoutRef' | 'stderrRef' | 'failureReason' | 'nextStep'> & {
    ref: string;
    workEvidence: WorkEvidence[];
    evidenceRefs: string[];
    artifactRefs: string[];
    diagnostics: string[];
    recoverActions: string[];
  }>;
  omittedStageCount: number;
  truncated: boolean;
}

export interface TaskProjectStageRunOptions {
  runner?: (workspace: string, spec: WorkspaceTaskSpec) => Promise<WorkspaceTaskRunResult>;
  now?: () => string;
  request?: Partial<GatewayRequest>;
}

export interface TaskProjectStageRunResult {
  project: TaskProject;
  plan: TaskProjectPlan;
  stage: TaskStage;
  run: WorkspaceTaskRunResult;
  output?: ToolPayload | WorkEvidence;
  outputKind?: 'tool-payload' | 'work-evidence';
  failureReason?: string;
}

export interface TaskProjectNextStageHandoffSummary {
  schemaVersion: typeof TASK_PROJECT_STAGE_HANDOFF_SCHEMA_VERSION;
  project: Pick<TaskProject, 'id' | 'title' | 'goal' | 'status' | 'updatedAt'>;
  stage: Pick<TaskStage, 'id' | 'index' | 'kind' | 'status' | 'goal' | 'outputRef' | 'stdoutRef' | 'stderrRef' | 'failureReason' | 'nextStep'>;
  stageResult: {
    status: TaskStageStatus;
    outputKind?: 'tool-payload' | 'work-evidence';
    outputSummary?: string;
    exitCode?: number;
  };
  evidenceSummary: {
    refs: string[];
    summaries: string[];
  };
  workEvidenceSummary: Array<Pick<WorkEvidence, 'kind' | 'status' | 'provider' | 'resultCount' | 'outputSummary' | 'failureReason' | 'nextStep'> & {
    evidenceRefs: string[];
    recoverActions: string[];
    diagnostics: string[];
    rawRef?: string;
  }>;
  artifactRefs: string[];
  diagnostics: string[];
  recoverActions: string[];
  failureReason?: string;
  nextStep?: string;
  userGuidanceDecisionContract: {
    requiredStatuses: Array<Exclude<TaskProjectGuidanceStatus, 'queued'>>;
    outputFieldHint: string;
  };
  userGuidanceQueue: Array<Record<string, unknown>>;
  truncated: boolean;
}

export interface TaskProjectContinuationSelection {
  project: TaskProject;
  plan: TaskProjectPlan;
  stages: TaskStage[];
  stage: TaskStage;
  stageRef: string;
  reason:
    | 'latest-failed-stage'
    | 'latest-repair-needed-stage'
    | 'latest-blocked-stage'
    | 'latest-incomplete-stage'
    | 'latest-completed-stage';
  shouldRepair: boolean;
  activeGuidance: TaskProjectGuidance[];
}

export interface TaskProjectStagePromotionOptions {
  request?: Partial<GatewayRequest>;
  skill?: SkillAvailability;
  taskId?: string;
  patchSummary?: string;
  minSuccessfulRuns?: number;
}

export interface CreateTaskProjectInit {
  id: string;
  title?: string;
  goal: string;
  status?: TaskProjectStatus;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AppendTaskProjectGuidanceInit {
  id?: string;
  message: string;
  source?: string;
  stageId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolveTaskProjectGuidancePatch {
  status: Exclude<TaskProjectGuidanceStatus, 'queued'>;
  decision?: string;
  reason?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export type AppendTaskStageInit = {
  kind: TaskStageKind;
  goal: string;
  status?: TaskStageStatus;
  codeRef?: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  evidenceRefs?: string[];
  artifactRefs?: string[];
  workEvidence?: WorkEvidence[];
  failureReason?: string;
  diagnostics?: string[];
  recoverActions?: string[];
  nextStep?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateTaskStagePatch = Partial<Omit<TaskStage, 'schemaVersion' | 'id' | 'projectId' | 'index' | 'kind' | 'createdAt'>> & {
  updatedAt?: string;
};

export type StageEvidenceInput = string | {
  id?: string;
  ref?: string;
  kind?: string;
  title?: string;
  summary?: string;
  data?: unknown;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export interface ListRecentTaskProjectsFilters {
  status?: TaskProjectStatus | TaskProjectStatus[];
  limit?: number;
}
