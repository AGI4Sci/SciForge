import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import type { AgentRuntimeId, RemoteChannelV1 } from '@shared/app-settings'
import type { NormalizedThread } from '../../agent/types'

type TimelineActiveThread = Pick<
  NormalizedThread,
  | 'id'
  | 'title'
  | 'runtimeId'
  | 'workspace'
  | 'updatedAt'
  | 'latestTurnId'
  | 'latestTurnStatus'
  | 'forkedFromThreadId'
  | 'forkedFromTitle'
  | 'forkedFromTurnCount'
>

/**
 * Snapshot of chat-store fields that `MessageTimeline` needs. Co-locates
 * the (many) `useChatStore` selectors in one place so adding a new field
 * to the timeline only touches this hook + the consuming component.
 */
export type TimelineStores = {
  workspaceRoot: string
  chooseWorkspace: () => Promise<string | null>
  remoteChannels: RemoteChannelV1[]
  activeRemoteChannel: RemoteChannelV1 | null
  activeAgentRuntime: AgentRuntimeId
  busy: boolean
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  activeThread: TimelineActiveThread | null
}

export function useTimelineStores(activeThreadId: string | null): TimelineStores {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const remoteChannels = useChatStore((s) => s.remoteChannels)
  const activeRemoteChannelId = useChatStore((s) => s.activeRemoteChannelId)
  const activeAgentRuntime = useChatStore((s) => s.activeAgentRuntime)
  const busy = useChatStore((s) => s.busy)
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const turnStartedAtByUserId = useChatStore((s) => s.turnStartedAtByUserId)
  const turnDurationByUserId = useChatStore((s) => s.turnDurationByUserId)
  const turnReasoningFirstAtByUserId = useChatStore((s) => s.turnReasoningFirstAtByUserId)
  const turnReasoningLastAtByUserId = useChatStore((s) => s.turnReasoningLastAtByUserId)
  const activeThread = useChatStore(useShallow((s): TimelineActiveThread | null => {
    if (!activeThreadId) return null
    const thread = s.threads.find((item) => item.id === activeThreadId)
    if (!thread) return null
    return {
      id: thread.id,
      title: thread.title,
      runtimeId: thread.runtimeId,
      workspace: thread.workspace,
      updatedAt: thread.updatedAt,
      latestTurnId: thread.latestTurnId,
      latestTurnStatus: thread.latestTurnStatus,
      forkedFromThreadId: thread.forkedFromThreadId,
      forkedFromTitle: thread.forkedFromTitle,
      forkedFromTurnCount: thread.forkedFromTurnCount
    }
  })
  )
  const activeRemoteChannel = useMemo(
    () => remoteChannels.find((channel) => channel.id === activeRemoteChannelId) ?? null,
    [activeRemoteChannelId, remoteChannels]
  )

  return {
    workspaceRoot,
    chooseWorkspace,
    remoteChannels,
    activeRemoteChannel,
    activeAgentRuntime,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThread
  }
}
