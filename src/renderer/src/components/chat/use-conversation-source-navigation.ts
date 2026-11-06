import { useEffect, useLayoutEffect, type RefObject } from 'react'
import { useChatStore } from '../../store/chat-store'
import type { ConversationSourceNavigation } from '../../lib/conversation-source-navigation'

/** Expand the canonical timeline and acknowledge only an actually mounted turn. */
export function useConversationSourceNavigation(navigation: ConversationSourceNavigation | null, container: RefObject<HTMLDivElement | null>, revealTurn: (index: number) => void, hiddenTurnCount: number): void {
  useEffect(() => {
    if (navigation?.status !== 'ready' || !navigation.match) return
    revealTurn(navigation.match.turnIndex)
    const timer = setTimeout(() => {
      useChatStore.setState(state => state.conversationSourceNavigation?.requestId === navigation.requestId && state.conversationSourceNavigation.status === 'ready'
        ? { conversationSourceNavigation: { ...navigation, status: 'unavailable' } } : {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [navigation, revealTurn])
  useLayoutEffect(() => {
    if (navigation?.status !== 'ready' || !navigation.match || !container.current) return
    const element = [...container.current.querySelectorAll<HTMLElement>('[data-conversation-turn]')]
      .find(node => node.dataset.conversationTurn === navigation.match!.turnKey)
    if (!element) return
    element.scrollIntoView({ block: 'center', behavior: 'auto' })
    useChatStore.setState(state => state.conversationSourceNavigation?.requestId === navigation.requestId
      ? { conversationSourceNavigation: { ...navigation, status: 'located' } } : {})
  }, [navigation, container, hiddenTurnCount])
}
