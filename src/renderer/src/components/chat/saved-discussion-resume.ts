import type { ChatState } from '../../store/chat-store-types'
import { discussionHandoffKey, type DiscussionCheckpoint } from '../../store/discussion-checkpoint'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'

type DiscussionDraft = Pick<DiscussionCheckpoint, 'input' | 'handoffDraft' | 'handedOffBasis' | 'handoffPending'>
export type DiscussionResumeTarget = 'handoff' | 'input'

export function discussionResumeTarget(discussion: DiscussionDraft): DiscussionResumeTarget | null {
  const draft = discussion.handoffDraft
  if (draft && (discussion.handoffPending || (
    [draft.document, draft.memory, draft.instruction, draft.preserve, draft.verification].some(value => value?.trim()) &&
    discussion.handedOffBasis !== discussionHandoffKey(draft)
  ))) return 'handoff'
  return discussion.input.trim() ? 'input' : null
}

/** Only offer the original task in its currently selected runtime and workspace. */
export function savedDiscussionsForActiveThread(state: ChatState): DiscussionCheckpoint[] {
  const parent = state.threads.find(thread => thread.id === state.activeThreadId)
  if (!parent || parent.runtimeId !== state.activeAgentRuntime) return []
  const workspace = workspaceRootIdentityKey(parent.workspace)
  if (workspace !== workspaceRootIdentityKey(state.workspaceRoot)) return []
  return Object.values(state.discussionCheckpoints ?? {}).filter(item =>
    item.parentThreadId === parent.id && item.runtimeId === parent.runtimeId &&
    workspaceRootIdentityKey(item.workspaceRoot) === workspace &&
    (!state.sideConversations[item.threadId] || (
      state.sideConversations[item.threadId].parentThreadId === parent.id &&
      state.sideConversations[item.threadId].runtimeId === item.runtimeId &&
      workspaceRootIdentityKey(state.sideConversations[item.threadId].workspaceRoot) === workspace &&
      (state.sideConversations[item.threadId].source ?? 'side') === 'side'
    ))
  )
}

/** Keep checkpoint order; createdAt is not a last-edit timestamp. */
export function unfinishedDiscussion(state: ChatState): DiscussionCheckpoint | undefined {
  return savedDiscussionsForActiveThread(state).find(item =>
    discussionResumeTarget(state.sideConversations[item.threadId] ?? item)
  )
}
