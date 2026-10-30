import { describe, expect, it } from 'vitest'
import type { ThreadTodoList } from '../agent/types'
import { extractPlanTodos, mergePlanTodosForRenderer } from './plan-todo-sync'

describe('plan todo sync', () => {
  it('preserves completed runtime todos when merging plan markdown', () => {
    const planItems = extractPlanTodos({
      markdown: '- [ ] Ship feature\n- [x] Add tests\n',
      threadId: 'thread-1',
      planId: 'plan-1',
      relativePath: '.sciforge/plan/feature.md',
      now: '2026-07-01T10:00:00.000Z'
    })
    const existing: ThreadTodoList = {
      threadId: 'thread-1',
      updatedAt: '2026-07-01T09:30:00.000Z',
      items: [
        {
          ...planItems[0],
          id: 'existing-ship-feature',
          status: 'completed',
          createdAt: '2026-07-01T09:00:00.000Z',
          updatedAt: '2026-07-01T09:15:00.000Z'
        },
        {
          id: 'manual-follow-up',
          content: 'Manual follow-up',
          status: 'pending',
          createdAt: '2026-07-01T09:05:00.000Z',
          updatedAt: '2026-07-01T09:05:00.000Z'
        }
      ]
    }

    const merged = mergePlanTodosForRenderer({
      threadId: 'thread-1',
      existing,
      planItems,
      now: '2026-07-01T10:05:00.000Z'
    })

    expect(merged.items).toEqual([
      expect.objectContaining({
        id: 'existing-ship-feature',
        content: 'Ship feature',
        status: 'completed',
        createdAt: '2026-07-01T09:00:00.000Z',
        updatedAt: '2026-07-01T09:15:00.000Z'
      }),
      expect.objectContaining({
        content: 'Add tests',
        status: 'completed'
      }),
      expect.objectContaining({
        id: 'manual-follow-up',
        content: 'Manual follow-up',
        status: 'pending'
      })
    ])
  })

  it('resets in-progress runtime plan todos to the current plan markdown status', () => {
    const planItems = extractPlanTodos({
      markdown: '- [ ] Pending again\n- [x] Completed in markdown\n',
      threadId: 'thread-1',
      planId: 'plan-1',
      relativePath: '.sciforge/plan/feature.md',
      now: '2026-07-01T10:00:00.000Z'
    })
    const existing: ThreadTodoList = {
      threadId: 'thread-1',
      updatedAt: '2026-07-01T09:30:00.000Z',
      items: [
        {
          ...planItems[0],
          id: 'existing-pending-again',
          status: 'in_progress',
          createdAt: '2026-07-01T09:00:00.000Z',
          updatedAt: '2026-07-01T09:15:00.000Z'
        },
        {
          ...planItems[1],
          id: 'existing-completed-in-markdown',
          status: 'in_progress',
          createdAt: '2026-07-01T09:00:00.000Z',
          updatedAt: '2026-07-01T09:15:00.000Z'
        }
      ]
    }

    const merged = mergePlanTodosForRenderer({
      threadId: 'thread-1',
      existing,
      planItems,
      now: '2026-07-01T10:05:00.000Z'
    })

    expect(merged.items).toEqual([
      expect.objectContaining({
        id: 'existing-pending-again',
        content: 'Pending again',
        status: 'pending',
        updatedAt: '2026-07-01T10:05:00.000Z'
      }),
      expect.objectContaining({
        id: 'existing-completed-in-markdown',
        content: 'Completed in markdown',
        status: 'completed',
        updatedAt: '2026-07-01T10:05:00.000Z'
      })
    ])
  })

  it('keeps removed plan todos as manual todos', () => {
    const oldPlanItems = extractPlanTodos({
      markdown: '- [ ] Renamed step\n- [ ] Removed step\n',
      threadId: 'thread-1',
      planId: 'plan-1',
      relativePath: '.sciforge/plan/feature.md',
      now: '2026-07-01T09:00:00.000Z'
    })
    const nextPlanItems = extractPlanTodos({
      markdown: '- [ ] New step\n',
      threadId: 'thread-1',
      planId: 'plan-1',
      relativePath: '.sciforge/plan/feature.md',
      now: '2026-07-01T10:00:00.000Z'
    })

    const merged = mergePlanTodosForRenderer({
      threadId: 'thread-1',
      existing: {
        threadId: 'thread-1',
        updatedAt: '2026-07-01T09:00:00.000Z',
        items: oldPlanItems
      },
      planItems: nextPlanItems,
      now: '2026-07-01T10:05:00.000Z'
    })

    expect(merged.items).toEqual([
      expect.objectContaining({
        content: 'New step',
        source: expect.objectContaining({ kind: 'plan' })
      }),
      expect.objectContaining({
        content: 'Removed step',
        source: undefined,
        updatedAt: '2026-07-01T10:05:00.000Z'
      })
    ])
  })
})
