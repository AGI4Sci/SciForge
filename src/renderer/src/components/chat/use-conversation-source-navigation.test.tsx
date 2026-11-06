// @vitest-environment happy-dom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useTimelineScroll } from './use-timeline-scroll'
import { useConversationSourceNavigation } from './use-conversation-source-navigation'
import type { ConversationSourceNavigation } from '../../lib/conversation-source-navigation'

const store = vi.hoisted(() => ({ state: { conversationSourceNavigation: null as ConversationSourceNavigation | null }, setState: vi.fn() }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { setState: (update: (state: typeof store.state) => Partial<typeof store.state>) => { store.setState(update); Object.assign(store.state, update(store.state)) } } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('reveals a folded old turn and acknowledges its stable anchor only after rendering', async () => {
  const mount = document.createElement('div')
  const root = createRoot(mount)
  const scroll = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = scroll
  const navigation: ConversationSourceNavigation = { requestId: 'nav', runtimeId: 'codex', threadId: 'thread', turnId: 'turn-2', status: 'ready', match: { turnKey: 'user-2', turnIndex: 2, itemFound: false } }
  store.state.conversationSourceNavigation = navigation
  function Harness() {
    const containerRef = useRef<HTMLDivElement>(null)
    const { hiddenTurnCount, revealTurn } = useTimelineScroll({ containerRef, activeThreadId: 'thread', pageSize: 18, autoCollapseThreshold: 24,
      totalTurns: 70, busy: true, autoScrollEnabled: false, scrollDeps: { contentKey: 'history', streaming: true, userTurnKey: '' } })
    useConversationSourceNavigation(navigation, containerRef, revealTurn, hiddenTurnCount)
    return <div ref={containerRef}>{Array.from({ length: 70 - hiddenTurnCount }, (_, n) => n + hiddenTurnCount).map(index => <div key={index} data-conversation-turn={'user-' + index} />)}</div>
  }
  try {
    await act(async () => root.render(<Harness />))
    expect(mount.querySelector('[data-conversation-turn="user-2"]')).not.toBeNull()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(store.state.conversationSourceNavigation?.status).toBe('located')
  } finally {
    await act(async () => root.unmount())
    HTMLElement.prototype.scrollIntoView = original
  }
})
