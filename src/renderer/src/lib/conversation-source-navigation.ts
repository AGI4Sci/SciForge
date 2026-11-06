import type { DomainWorkbenchOpenSessionInput } from '@sciforge/domain-sdk/host'
import type { ChatBlock } from '../agent/types'
import type { ChatState } from '../store/chat-store-types'
import { groupTurns, stableTurnKey } from '../components/chat/message-timeline-turns'

export type ConversationSourceMatch = { turnKey: string; turnIndex: number; itemFound: boolean }
export type ConversationSourceNavigation = Pick<DomainWorkbenchOpenSessionInput, 'runtimeId' | 'threadId' | 'turnId' | 'itemId'> & {
  requestId: string
  status: 'loading' | 'ready' | 'located' | 'missing' | 'limited' | 'unavailable'
  match?: ConversationSourceMatch
}

/** Uses persisted identity only. Never infer a source from text or DOM order. */
export function findConversationSource(blocks: ChatBlock[], target: Pick<DomainWorkbenchOpenSessionInput, 'turnId' | 'itemId'>): ConversationSourceMatch | null {
  const turns = groupTurns(blocks)
  let turnMatch: ConversationSourceMatch | null = null
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]
    const items = [...(turn.user ? [turn.user] : []), ...turn.blocks]
    const turnIds = items.map(block => Reflect.get(block, 'turnId')).filter((id): id is string => typeof id === 'string')
    const itemFound = Boolean(target.itemId && items.some(block => block.id === target.itemId))
    if (target.turnId && turnIds.length && !turnIds.includes(target.turnId)) continue
    const match = { turnKey: stableTurnKey(turn, index), turnIndex: index, itemFound }
    if (itemFound) return match
    // A steer can split one runtime turn into several user sections. Prefer an
    // exact item in a later section before falling back to the turn's start.
    if (!turnMatch && target.turnId && turnIds.includes(target.turnId)) turnMatch = match
  }
  return turnMatch
}

type HistoryState = Pick<ChatState, 'activeThreadId' | 'blocks' | 'threadHistoryCursor' | 'threadHistoryLoading' | 'loadEarlierThreadHistory'>
/** The same history reader used by the timeline, bounded in pages and wall time. */
export async function locateConversationSource(target: ConversationSourceNavigation, get: () => HistoryState, isCurrent: () => boolean,
  limits: { maxPages?: number; timeoutMs?: number } = {}): Promise<Pick<ConversationSourceNavigation, 'status' | 'match'>> {
  const deadline = Date.now() + (limits.timeoutMs ?? 12000)
  const seen = new Set<string>()
  for (let page = 0; page <= (limits.maxPages ?? 20); page++) {
    if (!isCurrent() || get().activeThreadId !== target.threadId) return { status: 'unavailable' }
    const state = get()
    const match = findConversationSource(state.blocks, target)
    if (match) return { status: 'ready', match }
    if (!state.threadHistoryCursor) return { status: 'missing' }
    if (page === (limits.maxPages ?? 20) || seen.has(state.threadHistoryCursor) || state.threadHistoryLoading || Date.now() >= deadline) return { status: 'limited' }
    const cursor = state.threadHistoryCursor
    seen.add(cursor)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const completed = await Promise.race([
        state.loadEarlierThreadHistory().then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())) })
      ])
      if (!completed) return { status: 'limited' }
      if (get().threadHistoryCursor === cursor) return { status: 'unavailable' }
    } catch { return { status: 'unavailable' } }
    finally { if (timer) clearTimeout(timer) }
  }
  return { status: 'limited' }
}
