import { describe, expect, it } from 'vitest'
import {
  defaultScheduleSettings,
  defaultWorkflowSettings,
  mergeScheduleSettings,
  reconcileScheduleWorkflows,
  scheduleTaskWorkflowId,
  type ScheduledTaskV1,
  type WorkflowV1
} from './app-settings'

function task(patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    id: 'task-1',
    title: 'Daily review',
    enabled: true,
    prompt: 'Review new papers.',
    workspaceRoot: '/tmp/workspace',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    ...patch
  }
}

describe('schedule workflow compiler', () => {
  it('compiles scheduled tasks into workflow trigger-agent-output graphs', () => {
    const sourceTask = task({ runtimeId: 'codex' })
    const schedule = mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      tasks: [sourceTask]
    })
    const workflow = reconcileScheduleWorkflows(defaultWorkflowSettings(), schedule, '2026-06-02T00:00:00.000Z')

    expect(workflow.enabled).toBe(true)
    expect(workflow.workflows).toHaveLength(1)
    expect(workflow.workflows[0]).toMatchObject({
      id: scheduleTaskWorkflowId(sourceTask.id),
      name: '[Schedule] Daily review',
      enabled: true,
      callableByAgent: false,
      env: [
        { key: 'SCIFORGE_WORKFLOW_SOURCE', value: 'schedule' },
        { key: 'SCIFORGE_SCHEDULE_TASK_ID', value: sourceTask.id }
      ]
    })
    expect(workflow.workflows[0].nodes.map((node) => node.type)).toEqual([
      'schedule-trigger',
      'ai-agent',
      'output'
    ])
    const agent = workflow.workflows[0].nodes.find((node) => node.type === 'ai-agent')
    expect(agent?.type === 'ai-agent' ? agent.config : null).toMatchObject({
      prompt: sourceTask.prompt,
      workspaceRoot: '/tmp/workspace',
      runtimeId: 'codex',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent'
    })
  })

  it('preserves schedule-owned workflow run history during reconciliation', () => {
    const sourceTask = task()
    const existing: WorkflowV1 = {
      id: scheduleTaskWorkflowId(sourceTask.id),
      name: '[Schedule] Daily review',
      enabled: true,
      callableByAgent: false,
      env: [
        { key: 'SCIFORGE_WORKFLOW_SOURCE', value: 'schedule', type: 'string' },
        { key: 'SCIFORGE_SCHEDULE_TASK_ID', value: sourceTask.id, type: 'string' }
      ],
      nodes: [],
      connections: [],
      createdAt: sourceTask.createdAt,
      updatedAt: sourceTask.updatedAt,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      runs: [{
        id: 'run-1',
        trigger: 'schedule',
        status: 'success',
        startedAt: '2026-06-02T09:00:00.000Z',
        finishedAt: '2026-06-02T09:01:00.000Z',
        message: 'Completed',
        nodeResults: []
      }]
    }
    const schedule = mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      tasks: [sourceTask]
    })

    const reconciled = reconcileScheduleWorkflows({
      ...defaultWorkflowSettings(),
      workflows: [existing]
    }, schedule)

    expect(reconciled.workflows[0].runs).toEqual(existing.runs)
  })
})
