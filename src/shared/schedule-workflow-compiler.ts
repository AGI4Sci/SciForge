import type {
  ScheduleSettingsV1,
  ScheduledTaskV1,
  WorkflowConnectionV1,
  WorkflowNodeV1,
  WorkflowSettingsV1,
  WorkflowV1
} from './app-settings-types'

export const SCHEDULE_WORKFLOW_ID_PREFIX = 'schedule-task:'
export const SCHEDULE_WORKFLOW_SOURCE_KEY = 'SCIFORGE_WORKFLOW_SOURCE'
export const SCHEDULE_WORKFLOW_TASK_ID_KEY = 'SCIFORGE_SCHEDULE_TASK_ID'

export function scheduleTaskWorkflowId(taskId: string): string {
  return `${SCHEDULE_WORKFLOW_ID_PREFIX}${taskId.trim()}`
}

export function scheduleTaskIdFromWorkflow(workflow: WorkflowV1): string {
  const envTaskId = workflow.env.find((item) => item.key === SCHEDULE_WORKFLOW_TASK_ID_KEY)?.value.trim()
  if (envTaskId) return envTaskId
  return workflow.id.startsWith(SCHEDULE_WORKFLOW_ID_PREFIX)
    ? workflow.id.slice(SCHEDULE_WORKFLOW_ID_PREFIX.length)
    : ''
}

export function isScheduleOwnedWorkflow(workflow: WorkflowV1): boolean {
  return workflow.id.startsWith(SCHEDULE_WORKFLOW_ID_PREFIX) ||
    workflow.env.some((item) =>
      item.key === SCHEDULE_WORKFLOW_SOURCE_KEY &&
      item.value === 'schedule'
    )
}

export function reconcileScheduleWorkflows(
  workflow: WorkflowSettingsV1,
  schedule: ScheduleSettingsV1,
  now = new Date().toISOString()
): WorkflowSettingsV1 {
  const existingByTaskId = new Map<string, WorkflowV1>()
  for (const existing of workflow.workflows) {
    if (!isScheduleOwnedWorkflow(existing)) continue
    const taskId = scheduleTaskIdFromWorkflow(existing)
    if (taskId) existingByTaskId.set(taskId, existing)
  }
  const taskWorkflows = schedule.tasks.map((task, index) =>
    compileScheduledTaskWorkflow(task, {
      scheduleEnabled: schedule.enabled,
      defaultWorkspaceRoot: schedule.defaultWorkspaceRoot,
      defaultModel: schedule.model,
      defaultMode: schedule.mode,
      index,
      now,
      previous: existingByTaskId.get(task.id)
    })
  )
  return {
    ...workflow,
    enabled: workflow.enabled || (schedule.enabled && taskWorkflows.some((item) => item.enabled)),
    workflows: [
      ...workflow.workflows.filter((item) => !isScheduleOwnedWorkflow(item)),
      ...taskWorkflows
    ]
  }
}

function compileScheduledTaskWorkflow(
  task: ScheduledTaskV1,
  options: {
    scheduleEnabled: boolean
    defaultWorkspaceRoot: string
    defaultModel: string
    defaultMode: ScheduledTaskV1['mode']
    index: number
    now: string
    previous?: WorkflowV1
  }
): WorkflowV1 {
  const workflowId = scheduleTaskWorkflowId(task.id)
  const triggerId = `${workflowId}:trigger`
  const agentId = `${workflowId}:agent`
  const outputId = `${workflowId}:output`
  const workspaceRoot = task.workspaceRoot.trim() || options.defaultWorkspaceRoot.trim()
  const title = task.title.trim() || `Task ${options.index + 1}`
  const nodes: WorkflowNodeV1[] = [
    {
      id: triggerId,
      type: 'schedule-trigger',
      name: 'Schedule',
      position: { x: 0, y: 0 },
      disabled: false,
      config: {
        schedule: {
          kind: task.schedule.kind,
          everyMinutes: task.schedule.everyMinutes,
          timeOfDay: task.schedule.timeOfDay,
          atTime: task.schedule.atTime,
          cron: ''
        },
        workspaceRoot
      }
    },
    {
      id: agentId,
      type: 'ai-agent',
      name: title,
      position: { x: 280, y: 0 },
      disabled: false,
      config: {
        prompt: task.prompt,
        workspaceRoot,
        ...(task.runtimeId ? { runtimeId: task.runtimeId } : {}),
        providerId: '',
        model: task.model.trim() || options.defaultModel,
        reasoningEffort: task.reasoningEffort,
        mode: task.mode || options.defaultMode
      }
    },
    {
      id: outputId,
      type: 'output',
      name: 'Result',
      position: { x: 560, y: 0 },
      disabled: false,
      config: {
        mode: 'auto',
        textTemplate: '',
        jsonPath: ''
      }
    }
  ]
  const connections: WorkflowConnectionV1[] = [
    {
      id: `${workflowId}:trigger-agent`,
      source: triggerId,
      sourceHandle: 'out',
      target: agentId,
      targetHandle: 'in'
    },
    {
      id: `${workflowId}:agent-output`,
      source: agentId,
      sourceHandle: 'out',
      target: outputId,
      targetHandle: 'in'
    }
  ]
  return {
    id: workflowId,
    name: `[Schedule] ${title}`,
    enabled: options.scheduleEnabled && task.enabled,
    callableByAgent: false,
    env: [
      { key: SCHEDULE_WORKFLOW_SOURCE_KEY, value: 'schedule', type: 'string' },
      { key: SCHEDULE_WORKFLOW_TASK_ID_KEY, value: task.id, type: 'string' }
    ],
    nodes,
    connections,
    createdAt: task.createdAt || options.now,
    updatedAt: task.updatedAt || options.now,
    lastRunAt: task.lastRunAt,
    nextRunAt: task.nextRunAt,
    lastStatus: task.lastStatus === 'idle' ? 'idle' : task.lastStatus,
    lastMessage: task.lastMessage,
    runs: options.previous?.runs ?? []
  }
}
