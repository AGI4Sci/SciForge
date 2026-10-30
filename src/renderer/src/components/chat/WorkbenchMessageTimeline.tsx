import type { ComponentProps, ReactElement } from 'react'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'

type Props = Omit<ComponentProps<typeof MessageTimeline>, 'blocks' | 'liveReasoning' | 'live'>

/**
 * Store-connected boundary for the active thread timeline. Streaming deltas
 * rewrite `blocks`/`liveReasoning`/`liveAssistant` on every chunk; subscribing
 * here keeps those updates out of the Workbench root render.
 */
export function WorkbenchMessageTimeline(props: Props): ReactElement {
  const blocks = useChatStore((state) => state.blocks)
  const liveReasoning = useChatStore((state) => state.liveReasoning)
  const live = useChatStore((state) => state.liveAssistant)
  return <MessageTimeline {...props} blocks={blocks} liveReasoning={liveReasoning} live={live} />
}
