import { describe, expect, it } from 'vitest'
import type { ChatState } from '../../store/chat-store-types'
import type { SideConversation } from '../../store/chat-store-types'
import {
  activeThreadTitle,
  visibleRunningSideCount,
  visibleSideIds
} from './side-conversation-selectors'

function makeSide(overrides: Partial<SideConversation>): SideConversation {
  return {
    threadId: 'side_1',
    parentThreadId: 'thr_main',
    title: 'side',
    createdAt: '2026-06-02T00:00:00.000Z',
    inheritedAt: '2026-06-02T00:00:00.000Z',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    input: '',
    model: 'deepseek-chat',
    reasoningEffort: 'medium',
    busy: false,
    turnId: null,
    userItemId: null,
    error: null,
    ...overrides
  }
}

function makeState(
  sideConversations: ChatState['sideConversations'],
  activeThreadId: string | null = 'thr_main'
): ChatState {
  return {
    activeThreadId,
    sideConversations,
    threads: [{ id: 'thr_main', title: 'Parent' }]
  } as unknown as ChatState
}

describe('side conversation selectors', () => {
  it('lists regular sides of the active thread in creation order', () => {
    const state = makeState({
      side_b: makeSide({
        threadId: 'side_b',
        createdAt: '2026-06-02T00:02:00.000Z'
      }),
      side_a: makeSide({
        threadId: 'side_a',
        createdAt: '2026-06-02T00:01:00.000Z'
      }),
      other_parent: makeSide({ threadId: 'other_parent', parentThreadId: 'thr_other' }),
      child: makeSide({ threadId: 'child', source: 'child_agent' })
    })

    expect(visibleSideIds(state)).toEqual(['side_a', 'side_b'])
  })

  it('returns an empty list without an active thread', () => {
    const state = makeState({ side_a: makeSide({ threadId: 'side_a' }) }, null)
    expect(visibleSideIds(state)).toEqual([])
    expect(visibleRunningSideCount(state)).toBe(0)
  })

  it('counts only running regular sides of the active thread', () => {
    const state = makeState({
      side_a: makeSide({ threadId: 'side_a', busy: true }),
      side_b: makeSide({ threadId: 'side_b', busy: false }),
      child: makeSide({ threadId: 'child', source: 'child_agent', busy: true }),
      other_parent: makeSide({ threadId: 'other_parent', parentThreadId: 'thr_other', busy: true })
    })

    expect(visibleRunningSideCount(state)).toBe(1)
  })

  it('resolves the active thread title', () => {
    expect(activeThreadTitle(makeState({}))).toBe('Parent')
    expect(activeThreadTitle(makeState({}, null))).toBeNull()
    expect(activeThreadTitle(makeState({}, 'thr_missing'))).toBeNull()
  })
})
