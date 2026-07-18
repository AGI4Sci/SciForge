import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  cacheThreadBlocks,
  forgetThreadBlocks,
  moveThreadBlocks,
  withThreadBlockCache
} from './chat-store-thread-blocks'
import type { ChatState } from './chat-store-types'

const sourceBlocks: ChatBlock[] = [{ kind: 'assistant', id: 'source', text: 'source' }]
const targetBlocks: ChatBlock[] = [{ kind: 'assistant', id: 'target', text: 'target' }]

describe('Session thread block cache', () => {
  it('mirrors active projection writes through the common state setter', () => {
    let state = {
      activeThreadId: 'session-1',
      blocks: [],
      threadBlocksById: {}
    } as unknown as ChatState
    const set = withThreadBlockCache((partial) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...patch }
    })

    set({ blocks: sourceBlocks })
    set({ activeThreadId: 'session-2', blocks: targetBlocks })

    expect(state.threadBlocksById).toEqual({
      'session-1': sourceBlocks,
      'session-2': targetBlocks
    })
  })

  it('updates and forgets only the addressed Session', () => {
    const cached = cacheThreadBlocks({}, 'session-1', sourceBlocks)
    const withTarget = cacheThreadBlocks(cached, 'session-2', targetBlocks)

    expect(forgetThreadBlocks(withTarget, ['session-1'])).toEqual({
      'session-2': targetBlocks
    })
  })

  it('moves into an empty owner but preserves an existing canonical target', () => {
    expect(moveThreadBlocks({ 'session-1': sourceBlocks }, 'session-1', 'session-2'))
      .toEqual({ 'session-2': sourceBlocks })
    expect(moveThreadBlocks({
      'session-1': sourceBlocks,
      'session-2': targetBlocks
    }, 'session-1', 'session-2')).toEqual({ 'session-2': targetBlocks })
  })
})
