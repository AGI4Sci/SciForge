import { describe, expect, it, vi } from 'vitest'
import { findConversationSource, locateConversationSource, type ConversationSourceNavigation } from './conversation-source-navigation'
import type { ChatBlock } from '../agent/types'

const target: ConversationSourceNavigation = { runtimeId: 'codex', threadId: 'source', turnId: 'turn-old', itemId: 'item-old', requestId: 'request', status: 'loading' }
const user = (id: string, turnId: string): ChatBlock => ({ id, turnId, kind: 'user', text: 'identical text' })
describe('conversation source lookup', () => {
  it('uses exact turn/item IDs and rejects a matching item in another turn', () => {
    expect(findConversationSource([user('item-old', 'other')], target)).toBeNull()
    expect(findConversationSource([user('same-text', 'other')], target)).toBeNull()
    expect(findConversationSource([user('user-old', 'turn-old'), { id: 'item-old', kind: 'assistant', text: 'result' }], target)).toEqual({ turnKey: 'user-old', turnIndex: 0, itemFound: true })
    expect(findConversationSource([user('user-old', 'turn-old')], target)?.itemFound).toBe(false)
  })
  it('loads through the canonical history reader to an older turn', async () => {
    const state = { activeThreadId: 'source', blocks: [user('recent', 'recent')], threadHistoryCursor: 'page-1', threadHistoryLoading: false,
      loadEarlierThreadHistory: vi.fn(async () => { state.blocks = [user('item-old', 'turn-old'), ...state.blocks]; state.threadHistoryCursor = '' }) }
    const result = await locateConversationSource(target, () => state, () => true)
    expect(result).toEqual({ status: 'ready', match: { turnKey: 'item-old', turnIndex: 0, itemFound: true } })
    expect(state.loadEarlierThreadHistory).toHaveBeenCalledTimes(1)
  })
  it('prefers the exact item after a steer within the same runtime turn', () => {
    const blocks: ChatBlock[] = [user('first-section', 'turn-old'), user('steer-section', 'turn-old'),
      { id: 'item-old', kind: 'assistant', text: 'result after steering' }]
    expect(findConversationSource(blocks, target)).toEqual({ turnKey: 'steer-section', turnIndex: 1, itemFound: true })
  })
  it('reports missing, stalled history and a page budget separately', async () => {
    const state = { activeThreadId: 'source', blocks: [], threadHistoryCursor: null as string | null, threadHistoryLoading: false, loadEarlierThreadHistory: vi.fn(async () => undefined) }
    expect(await locateConversationSource(target, () => state, () => true)).toEqual({ status: 'missing' })
    state.threadHistoryCursor = 'cursor'
    expect(await locateConversationSource(target, () => state, () => true, { maxPages: 0 })).toEqual({ status: 'limited' })
    expect(await locateConversationSource(target, () => state, () => true)).toEqual({ status: 'unavailable' })
  })
  it('bounds a hung history read and does not follow a superseded session', async () => {
    vi.useFakeTimers()
    try {
      const state = { activeThreadId: 'source', blocks: [], threadHistoryCursor: 'cursor', threadHistoryLoading: false, loadEarlierThreadHistory: vi.fn(() => new Promise<void>(() => {})) }
      const result = locateConversationSource(target, () => state, () => true, { timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(100)
      expect(await result).toEqual({ status: 'limited' })
      state.activeThreadId = 'another'
      expect(await locateConversationSource(target, () => state, () => true)).toEqual({ status: 'unavailable' })
      expect(state.loadEarlierThreadHistory).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})
