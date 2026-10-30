import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId, ScheduledTaskV1 } from '@shared/app-settings'
import {
  filterScheduledTasks,
  newScheduledTask,
  ScheduleTaskEnabledCheckbox,
  ScheduleTaskFilterSelect,
  scheduledTaskLastThreadRuntimeId,
  scheduleReasoningLabel,
  scheduleTaskSummary,
  scheduledTaskLastThreadId,
  scheduledTaskResultIsExpandable,
  validateScheduledTaskDraft
} from './ScheduleTasksView'

const t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key

function task(id: string, patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    ...newScheduledTask('/tmp/workspace'),
    id,
    title: `Task ${id}`,
    prompt: 'Run',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...patch,
    schedule: {
      ...newScheduledTask('/tmp/workspace').schedule,
      ...patch.schedule
    }
  }
}

describe('ScheduleTasksView helpers', () => {
  it('names the task status filter for assistive technology', () => {
    const html = renderToStaticMarkup(createElement(ScheduleTaskFilterSelect, {
      value: 'all',
      onChange: vi.fn(),
      t
    }))

    expect(html).toContain('aria-label="scheduleFilterLabel"')
  })

  it('names each task enabled toggle with its task title', () => {
    const html = renderToStaticMarkup(createElement(ScheduleTaskEnabledCheckbox, {
      checked: true,
      taskTitle: 'Daily literature review',
      onChange: vi.fn(),
      t
    }))

    expect(html).toContain('aria-label="scheduleTaskEnabledFor:{&quot;title&quot;:&quot;Daily literature review&quot;}"')
    expect(html).toContain('checked=""')
  })

  it('creates Codex tasks by default and rejects legacy runtime defaults', () => {
    expect(newScheduledTask('/tmp/workspace').runtimeId).toBe('codex')
    expect(newScheduledTask('/tmp/workspace', { runtimeId: 'legacy-runtime' as unknown as AgentRuntimeId }).runtimeId).toBe('codex')
    expect(newScheduledTask('/tmp/workspace', { runtimeId: 'claude' }).runtimeId).toBe('claude')
  })

  it('keeps DSH out of selectable schedule runtimes until schedule support is declared', () => {
    expect(newScheduledTask('/tmp/workspace', { runtimeId: 'dsh' }).runtimeId).toBe('codex')
    expect(scheduledTaskLastThreadId(task('dsh-ran', {
      runtimeId: 'dsh',
      agentThreadIds: { dsh: 'dsh-thread' }
    }))).toBe('')
    expect(scheduledTaskLastThreadRuntimeId(task('dsh-ran', {
      runtimeId: 'dsh',
      agentThreadIds: { dsh: 'dsh-thread' }
    }))).toBeUndefined()
  })

  it('validates task form drafts', () => {
    const now = new Date('2026-06-02T00:00:00.000Z')

    expect(validateScheduledTaskDraft(task('missing-title', { title: '' }), t, now))
      .toBe('scheduleTaskNameRequired')
    expect(validateScheduledTaskDraft(task('missing-prompt', { prompt: '' }), t, now))
      .toBe('scheduleTaskPromptRequired')
    expect(validateScheduledTaskDraft(task('bad-interval', {
      schedule: { kind: 'interval', everyMinutes: 0, timeOfDay: '09:00', atTime: '' }
    }), t, now)).toBe('scheduleIntervalInvalid')
    expect(validateScheduledTaskDraft(task('bad-daily', {
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '24:00', atTime: '' }
    }), t, now)).toBe('scheduleDailyTimeInvalid')
    expect(validateScheduledTaskDraft(task('past-once', {
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-01T00:00:00.000Z'
      }
    }), t, now)).toBe('scheduleAtTimePast')
    expect(validateScheduledTaskDraft(task('ok', {
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-03T00:00:00.000Z'
      }
    }), t, now)).toBeNull()
  })

  it('filters and sorts tasks by next run before updated time', () => {
    const tasks = [
      task('older', { updatedAt: '2026-06-01T00:00:00.000Z' }),
      task('next-2', { nextRunAt: '2026-06-03T00:00:00.000Z' }),
      task('next-1', { nextRunAt: '2026-06-02T12:00:00.000Z' }),
      task('newer', { updatedAt: '2026-06-04T00:00:00.000Z' })
    ]

    expect(filterScheduledTasks(tasks, 'all').map((item) => item.id))
      .toEqual(['next-1', 'next-2', 'newer', 'older'])
    expect(filterScheduledTasks([
      task('enabled', { enabled: true }),
      task('disabled', { enabled: false })
    ], 'enabled').map((item) => item.id)).toEqual(['enabled'])
    expect(filterScheduledTasks([
      task('running', { lastStatus: 'running' }),
      task('idle', { lastStatus: 'idle' })
    ], 'running').map((item) => item.id)).toEqual(['running'])
    expect(filterScheduledTasks([
      task('success', { lastStatus: 'success' }),
      task('error', { lastStatus: 'error' }),
      task('idle', { lastStatus: 'idle' })
    ], 'done').map((item) => item.id)).toEqual(['success', 'error'])
  })

  it('summarizes schedule timing for the list UI', () => {
    expect(scheduleTaskSummary(task('daily', {
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '08:30', atTime: '' }
    }), t)).toBe('scheduleDailyAt:{"time":"08:30"}')
    expect(scheduleTaskSummary(task('interval', {
      schedule: { kind: 'interval', everyMinutes: 45, timeOfDay: '09:00', atTime: '' }
    }), t)).toBe('scheduleEvery:{"minutes":45}')
    expect(scheduleTaskSummary(task('manual', {
      schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' }
    }), t)).toBe('scheduleManual')
  })

  it('normalizes the task thread link shown in the list UI', () => {
    expect(scheduledTaskLastThreadId(task('never-ran'))).toBe('')
    expect(scheduledTaskLastThreadId(task('claude-ran', {
      runtimeId: 'claude',
      agentThreadIds: { claude: '  thr_123  ' }
    }))).toBe('thr_123')
    expect(scheduledTaskLastThreadId(task('codex-ran', {
      runtimeId: 'codex',
      agentThreadIds: {
        claude: 'claude-thread',
        codex: ' codex-thread '
      }
    }))).toBe('codex-thread')
    expect(scheduledTaskLastThreadId(task('codex-missing', {
      runtimeId: 'codex',
      agentThreadIds: { claude: 'claude-thread' }
    }))).toBe('')
    expect(scheduledTaskLastThreadRuntimeId(task('codex-ran', {
      runtimeId: 'codex',
      agentThreadIds: { codex: 'codex-thread' }
    }))).toBe('codex')
    expect(scheduledTaskLastThreadRuntimeId(task('claude-ran', {
      runtimeId: 'claude',
      agentThreadIds: { claude: 'claude-thread' }
    }))).toBe('claude')
  })

  it('detects when a task result needs expansion', () => {
    expect(scheduledTaskResultIsExpandable('')).toBe(false)
    expect(scheduledTaskResultIsExpandable('short result')).toBe(false)
    expect(scheduledTaskResultIsExpandable('line 1\nline 2\nline 3\nline 4\nline 5\nline 6')).toBe(true)
    expect(scheduledTaskResultIsExpandable('x'.repeat(361))).toBe(true)
  })

  it('defaults scheduled reasoning to unset and labels it as upstream default', () => {
    expect(newScheduledTask('/tmp/workspace').reasoningEffort).toBe('')
    expect(scheduleReasoningLabel('', t)).toBe('scheduleReasoningUnset')
    expect(scheduleReasoningLabel('high', t)).toBe('scheduleReasoning_high')
  })
})
