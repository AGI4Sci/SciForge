import { describe, expect, it } from 'vitest'
import type { AgentRuntimeChild } from '../../../shared/agent-runtime-contract'
import {
  AGENT_RUNTIME_CHILD_CACHE_THREAD_LIMIT,
  AGENT_RUNTIME_RECENT_CHILD_LIMIT,
  BoundedAgentRuntimeChildHistory,
  touchBoundedThreadCache
} from './bounded-child-history'

describe('bounded child history', () => {
  it.each([40, 200, 400, 1_000])('bounds %i terminal children while retaining active children and exact recent lookup', (size) => {
    const history = new BoundedAgentRuntimeChildHistory()
    for (let index = 0; index < size; index += 1) history.upsert(child(index, 'completed'))
    history.upsert(child(-1, 'running'))

    const first = history.page({ runtimeId: 'codex', threadId: 'parent', limit: 40 })
    expect(first.children[0]?.id).toBe('active-child')
    expect(first.children.length).toBeLessThanOrEqual(41)
    expect(history.activeSize).toBe(1)
    expect(history.terminalSize).toBe(Math.min(size, AGENT_RUNTIME_RECENT_CHILD_LIMIT))
    expect(history.get(`child-${Math.max(0, size - 1)}`)).not.toBeNull()
    expect(first.metadata).toMatchObject({
      terminalHistoryLimit: AGENT_RUNTIME_RECENT_CHILD_LIMIT,
      historyTruncated: size > 40
    })

    if (first.nextCursor) {
      const second = history.page({
        runtimeId: 'codex',
        threadId: 'parent',
        cursor: first.nextCursor,
        limit: 40
      })
      expect(second.children[0]?.id).toBe('active-child')
      const firstTerminal = new Set(first.children.slice(1).map((item) => item.id))
      expect(second.children.slice(1).some((item) => firstTerminal.has(item.id))).toBe(false)
    }
  })

  it('bounds the number of resident conversation indexes with LRU touch semantics', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 100; index += 1) touchBoundedThreadCache(cache, `thread-${index}`, index)
    expect(cache.size).toBe(AGENT_RUNTIME_CHILD_CACHE_THREAD_LIMIT)
    expect(cache.has('thread-0')).toBe(false)
    expect(cache.get('thread-99')).toBe(99)
  })
})

function child(index: number, status: AgentRuntimeChild['status']): AgentRuntimeChild {
  const active = index < 0
  const id = active ? 'active-child' : `child-${index}`
  return {
    id,
    runtimeId: 'codex',
    parentThreadId: 'parent',
    parentTurnId: active ? 'active-turn' : `turn-${Math.floor(index / 4)}`,
    kind: 'agent',
    status,
    updatedAt: active
      ? '2025-01-01T00:00:00.000Z'
      : new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
  }
}
