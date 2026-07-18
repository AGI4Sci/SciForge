import { describe, expect, it } from 'vitest'
import type { NormalizedThread, ThreadTodoList } from '../agent/types'
import { threadTodosForSession } from './use-sdd-trace'

function todos(threadId: string, label: string): ThreadTodoList {
  return {
    threadId,
    updatedAt: '2026-07-18T00:00:00.000Z',
    items: [{
      id: `${threadId}-todo`,
      content: label,
      status: 'pending',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z'
    }]
  }
}

describe('threadTodosForSession', () => {
  it('reads a hidden owner Session from its summary instead of the active Session singleton', () => {
    const todosA = todos('session-a', 'A')
    const todosB = todos('session-b', 'B')
    const threads = [
      { id: 'session-a', todos: todosA },
      { id: 'session-b', todos: todosB }
    ] as NormalizedThread[]

    expect(threadTodosForSession({
      activeThreadId: 'session-b',
      activeThreadTodos: todosB,
      threads
    }, 'session-a')).toBe(todosA)
  })

  it('uses the detailed todo snapshot for the active owner Session', () => {
    const summaryTodos = todos('session-a', 'summary')
    const detailedTodos = todos('session-a', 'detailed')

    expect(threadTodosForSession({
      activeThreadId: 'session-a',
      activeThreadTodos: detailedTodos,
      threads: [{ id: 'session-a', todos: summaryTodos } as NormalizedThread]
    }, 'session-a')).toBe(detailedTodos)
  })
})
