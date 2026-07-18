import type { ChatBlock } from '../agent/types'
import type { StateSetter } from '../lib/performance-monitor'
import type { ChatState } from './chat-store-types'

export function cacheThreadBlocks(
  threadBlocksById: Record<string, ChatBlock[]>,
  threadId: string | null | undefined,
  blocks: ChatBlock[]
): Record<string, ChatBlock[]> {
  const normalizedThreadId = threadId?.trim()
  if (!normalizedThreadId || threadBlocksById[normalizedThreadId] === blocks) {
    return threadBlocksById
  }
  return { ...threadBlocksById, [normalizedThreadId]: blocks }
}

export function forgetThreadBlocks(
  threadBlocksById: Record<string, ChatBlock[]>,
  threadIds: Iterable<string>
): Record<string, ChatBlock[]> {
  let next = threadBlocksById
  for (const threadId of threadIds) {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId || !(normalizedThreadId in next)) continue
    if (next === threadBlocksById) next = { ...threadBlocksById }
    delete next[normalizedThreadId]
  }
  return next
}

export function moveThreadBlocks(
  threadBlocksById: Record<string, ChatBlock[]>,
  previousThreadId: string,
  nextThreadId: string
): Record<string, ChatBlock[]> {
  const previousId = previousThreadId.trim()
  const nextId = nextThreadId.trim()
  if (!previousId || !nextId || previousId === nextId || !(previousId in threadBlocksById)) {
    return threadBlocksById
  }
  const next = { ...threadBlocksById }
  if (!(nextId in next)) next[nextId] = next[previousId]
  delete next[previousId]
  return next
}

/**
 * Keep the active-thread `blocks` projection and the Session-keyed timeline
 * cache on one write path. Every existing action already writes through this
 * setter, so loads, live events, optimistic sends, and maintenance edits all
 * update the owning Session without per-action mirrors.
 */
export function withThreadBlockCache(set: StateSetter<ChatState>): StateSetter<ChatState> {
  return (partial) => {
    set((state) => {
      const patch = typeof partial === 'function' ? partial(state) : partial
      if (!Array.isArray(patch.blocks)) return patch
      const threadId = patch.activeThreadId === undefined
        ? state.activeThreadId
        : patch.activeThreadId
      const threadBlocksById = cacheThreadBlocks(
        state.threadBlocksById,
        threadId,
        patch.blocks
      )
      return threadBlocksById === state.threadBlocksById
        ? patch
        : { ...patch, threadBlocksById }
    })
  }
}
