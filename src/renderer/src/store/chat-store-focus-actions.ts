import type { ChatBlock } from '../agent/types'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  AgentFocusLocation,
  AgentFocusNode,
  ChatState,
  ChatStoreGet,
  ChatStoreSet,
  FocusAgentThreadInput,
  SideConversation
} from './chat-store-types'

type FocusActions = Pick<
  ChatState,
  'focusAgentThread' | 'focusAgentBack' | 'focusAgentForward' | 'focusAgentParent' | 'resetAgentFocus'
>

export type FocusedAgentSurface = {
  source: 'root' | 'side'
  threadId: string
  parentThreadId: string | null
  runtimeId?: AgentRuntimeId
  title: string
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  busy: boolean
  turnId: string | null
  input: string
  model: string
  reasoningEffort: string
  error: string | null
}

function rootNode(state: ChatState, threadId: string): AgentFocusNode {
  const thread = state.threads.find((candidate) => candidate.id === threadId)
  const runtimeId = thread?.runtimeId ?? state.activeAgentRuntime
  return {
    threadId,
    parentThreadId: null,
    ...(runtimeId ? { runtimeId } : {}),
    ...(thread?.title ? { title: thread.title } : {})
  }
}

export function rootAgentFocusLocation(state: ChatState, rootThreadId: string): AgentFocusLocation {
  const node = rootNode(state, rootThreadId)
  return {
    threadId: rootThreadId,
    ...(node.runtimeId ? { runtimeId: node.runtimeId } : {}),
    lineage: [node]
  }
}

export function clearedAgentFocusState(): Pick<
  ChatState,
  | 'focusedAgentThreadId'
  | 'focusedAgentRuntimeId'
  | 'agentFocusLineage'
  | 'agentFocusHistory'
  | 'agentFocusHistoryIndex'
> {
  return {
    focusedAgentThreadId: null,
    focusedAgentRuntimeId: null,
    agentFocusLineage: [],
    agentFocusHistory: [],
    agentFocusHistoryIndex: -1
  }
}

export function resetAgentFocusState(
  state: ChatState,
  rootThreadId?: string | null
): ReturnType<typeof clearedAgentFocusState> {
  const normalizedRootId = rootThreadId?.trim() ?? ''
  if (!normalizedRootId) return clearedAgentFocusState()
  const location = rootAgentFocusLocation(state, normalizedRootId)
  return {
    focusedAgentThreadId: location.threadId,
    focusedAgentRuntimeId: location.runtimeId ?? null,
    agentFocusLineage: location.lineage,
    agentFocusHistory: [location],
    agentFocusHistoryIndex: 0
  }
}

function nodeForSide(side: SideConversation): AgentFocusNode {
  return {
    threadId: side.threadId,
    parentThreadId: side.parentThreadId,
    ...(side.runtimeId ? { runtimeId: side.runtimeId } : {}),
    ...(side.title ? { title: side.title } : {})
  }
}

function lineageFromAttachedSides(
  state: ChatState,
  threadId: string,
  target?: FocusAgentThreadInput
): AgentFocusNode[] | null {
  const rootThreadId = state.activeThreadId
  if (!rootThreadId) return null
  if (threadId === rootThreadId) return [rootNode(state, rootThreadId)]

  const reversed: AgentFocusNode[] = []
  const seen = new Set<string>()
  let cursor = threadId
  while (cursor !== rootThreadId) {
    if (seen.has(cursor)) return null
    seen.add(cursor)
    const side = state.sideConversations[cursor]
    if (side) {
      reversed.push(nodeForSide(side))
      cursor = side.parentThreadId
      continue
    }
    if (cursor === threadId && target?.parentThreadId) {
      reversed.push({
        threadId,
        parentThreadId: target.parentThreadId,
        ...(target.runtimeId ? { runtimeId: target.runtimeId } : {}),
        ...(target.title ? { title: target.title } : {})
      })
      cursor = target.parentThreadId
      continue
    }
    return null
  }
  return [rootNode(state, rootThreadId), ...reversed.reverse()]
}

function resolveFocusLocation(state: ChatState, target: FocusAgentThreadInput): AgentFocusLocation | null {
  const threadId = target.threadId.trim()
  if (!threadId || !state.activeThreadId) return null
  const existingIndex = state.agentFocusLineage.findIndex((node) => node.threadId === threadId)
  const suppliedLineage = target.lineage?.filter((node) => node.threadId.trim())
  const validSuppliedLineage = suppliedLineage?.[0]?.threadId === state.activeThreadId
    && suppliedLineage.at(-1)?.threadId === threadId
    ? suppliedLineage
    : null
  const lineage = validSuppliedLineage ?? (existingIndex >= 0
    ? state.agentFocusLineage.slice(0, existingIndex + 1)
    : lineageFromAttachedSides(state, threadId, target))
  if (!lineage?.length) return null
  const leaf = lineage[lineage.length - 1]
  if (target.runtimeId || target.title) {
    lineage[lineage.length - 1] = {
      ...leaf,
      ...(target.runtimeId ? { runtimeId: target.runtimeId } : {}),
      ...(target.title ? { title: target.title } : {})
    }
  }
  return {
    threadId,
    ...(lineage[lineage.length - 1]?.runtimeId
      ? { runtimeId: lineage[lineage.length - 1].runtimeId }
      : {}),
    lineage
  }
}

function focusPatch(location: AgentFocusLocation): Pick<
  ChatState,
  'focusedAgentThreadId' | 'focusedAgentRuntimeId' | 'agentFocusLineage'
> {
  return {
    focusedAgentThreadId: location.threadId,
    focusedAgentRuntimeId: location.runtimeId ?? null,
    agentFocusLineage: location.lineage
  }
}

export function createFocusActions(set: ChatStoreSet, get: ChatStoreGet): FocusActions {
  const travelTo = (index: number): boolean => {
    const state = get()
    const location = state.agentFocusHistory[index]
    if (!location) return false
    set({ ...focusPatch(location), agentFocusHistoryIndex: index })
    return true
  }

  return {
    focusAgentThread: (target) => {
      const state = get()
      const location = resolveFocusLocation(state, target)
      if (!location) return false
      const current = state.agentFocusHistory[state.agentFocusHistoryIndex]
      if (current?.threadId === location.threadId) {
        set(focusPatch(location))
        return true
      }
      const history = [
        ...state.agentFocusHistory.slice(0, state.agentFocusHistoryIndex + 1),
        location
      ]
      set({ ...focusPatch(location), agentFocusHistory: history, agentFocusHistoryIndex: history.length - 1 })
      return true
    },
    focusAgentBack: () => travelTo(get().agentFocusHistoryIndex - 1),
    focusAgentForward: () => travelTo(get().agentFocusHistoryIndex + 1),
    focusAgentParent: () => {
      const state = get()
      const parent = state.agentFocusLineage.at(-2)
      return parent ? get().focusAgentThread(parent) : false
    },
    resetAgentFocus: (rootThreadId) => {
      const state = get()
      set(resetAgentFocusState(state, rootThreadId === undefined ? state.activeThreadId : rootThreadId))
    }
  }
}

/**
 * Selects the content model for the center workbench without changing the
 * root thread subscription. Descendants reuse their isolated side snapshot,
 * including its draft and live stream.
 */
export function selectFocusedAgentSurface(state: ChatState): FocusedAgentSurface | null {
  const threadId = state.focusedAgentThreadId ?? state.activeThreadId
  if (!threadId) return null
  if (threadId === state.activeThreadId) {
    const thread = state.threads.find((candidate) => candidate.id === threadId)
    return {
      source: 'root',
      threadId,
      parentThreadId: null,
      ...(thread?.runtimeId ? { runtimeId: thread.runtimeId } : {}),
      title: thread?.title ?? '',
      blocks: state.blocks,
      liveReasoning: state.liveReasoning,
      liveAssistant: state.liveAssistant,
      busy: state.busy,
      turnId: state.currentTurnId,
      input: '',
      model: state.composerModel,
      reasoningEffort: '',
      error: state.error
    }
  }
  const side = state.sideConversations[threadId]
  if (!side) return null
  return {
    source: 'side',
    threadId,
    parentThreadId: side.parentThreadId,
    ...(side.runtimeId ? { runtimeId: side.runtimeId } : {}),
    title: side.title,
    blocks: side.blocks,
    liveReasoning: side.liveReasoning,
    liveAssistant: side.liveAssistant,
    busy: side.busy,
    turnId: side.turnId,
    input: side.input,
    model: side.model,
    reasoningEffort: side.reasoningEffort,
    error: side.error
  }
}
