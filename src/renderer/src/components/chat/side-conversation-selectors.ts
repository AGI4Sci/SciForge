import type { ChatState } from '../../store/chat-store-types'

function isRegularVisibleSide(
  side: ChatState['sideConversations'][string],
  parentThreadId: string
): boolean {
  return side.parentThreadId === parentThreadId && (side.source ?? 'side') === 'side'
}

/**
 * Ids of the regular side conversations shown for the active thread, in
 * creation order. Elements are strings, so a shallow compare keeps the result
 * stable while background side streams patch their own slices.
 */
export function visibleSideIds(state: ChatState): string[] {
  const parentThreadId = state.activeThreadId
  if (!parentThreadId) return []
  return Object.values(state.sideConversations)
    .filter((side) => isRegularVisibleSide(side, parentThreadId))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((side) => side.threadId)
}

export function visibleRunningSideCount(state: ChatState): number {
  const parentThreadId = state.activeThreadId
  if (!parentThreadId) return 0
  let count = 0
  for (const side of Object.values(state.sideConversations)) {
    if (isRegularVisibleSide(side, parentThreadId) && side.busy) count += 1
  }
  return count
}

export function activeThreadTitle(state: ChatState): string | null {
  const id = state.activeThreadId
  if (!id) return null
  const thread = state.threads.find((item) => item.id === id)
  return thread ? thread.title : null
}
