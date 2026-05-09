export const TASK_PROJECT_STATUSES = ['planned', 'running', 'done', 'failed', 'repair-needed', 'blocked'] as const;
export type TaskProjectStatus = typeof TASK_PROJECT_STATUSES[number];

export const TASK_STAGE_STATUSES = ['planned', 'running', 'done', 'failed', 'repair-needed', 'skipped', 'blocked'] as const;
export type TaskStageStatus = typeof TASK_STAGE_STATUSES[number];
