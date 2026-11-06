// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import { MessageTimeline } from './MessageTimeline'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const original = useChatStore.getState()
let root: Root
let container: HTMLDivElement
const loadHistory = vi.fn(async () => undefined)

beforeEach(() => {
  loadHistory.mockClear()
  useChatStore.setState({
    route: 'chat', workspaceRoot: '/tmp/project', activeThreadId: 'thr_1',
    threads: [{ id: 'thr_1', title: 'Thread', updatedAt: '2026-06-07T00:00:00.000Z', model: 'model-a', mode: 'agent', workspace: '/tmp/project' }],
    busy: false, currentTurnUserId: null, turnStartedAtByUserId: {}, turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {}, turnReasoningLastAtByUserId: {},
    threadHistoryCursor: 'opaque-server-page', threadHistoryLoading: false, loadEarlierThreadHistory: loadHistory
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useChatStore.setState(original, true)
  await i18n.changeLanguage('en')
})

async function renderTimeline(blocks: ChatBlock[], language: 'en' | 'zh') {
  await i18n.changeLanguage(language)
  await act(async () => root.render(<MessageTimeline blocks={blocks} liveReasoning="" live=""
    activeThreadId="thr_1" runtimeConnection="ready" onRetryConnection={() => undefined} onOpenSettings={() => undefined} />))
}

it.each(['en', 'zh'] as const)('loads a server page without inventing its unknown turn count in %s', async language => {
  // A source page can begin halfway through a long turn.
  await renderTimeline([{ kind: 'assistant', id: 'partial-turn', text: 'Partial result' }], language)
  const label = language === 'zh' ? '加载更早的记录' : 'Load earlier history'
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === label)!
  expect(button).toBeDefined()
  expect(container.textContent).not.toContain(language === 'zh' ? '18 轮对话' : '18 earlier turns')
  await act(async () => button.click())
  expect(loadHistory).toHaveBeenCalledOnce()
})

it.each(['en', 'zh'] as const)('reveals the counted local turns before requesting a server page in %s', async language => {
  await renderTimeline(Array.from({ length: 25 }, (_, index) => ({
    kind: 'user' as const, id: `user-${index}`, text: `Turn ${index + 1}`
  })), language)
  const localLabel = language === 'zh' ? '显示更早的 7 轮对话' : 'Show 7 earlier turns'
  const serverLabel = language === 'zh' ? '加载更早的记录' : 'Load earlier history'
  const localButton = [...container.querySelectorAll('button')].find(button => button.textContent === localLabel)!
  expect(localButton).toBeDefined()
  expect(container.textContent).not.toContain(serverLabel)
  await act(async () => localButton.click())
  expect(loadHistory).not.toHaveBeenCalled()
  const serverButton = [...container.querySelectorAll('button')].find(button => button.textContent === serverLabel)!
  expect(serverButton).toBeDefined()
  await act(async () => serverButton.click())
  expect(loadHistory).toHaveBeenCalledOnce()
})


it('opens a folded source turn on the real timeline and reports missing sources honestly', async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  try {
    const blocks = Array.from({ length: 45 }, (_, index) => ({ kind: 'user' as const, id: 'user-' + index, turnId: 'turn-' + index, text: 'Message ' + index }))
    useChatStore.setState({ activeAgentRuntime: 'codex', conversationSourceNavigation: {
      runtimeId: 'codex', threadId: 'thr_1', turnId: 'turn-2', itemId: 'missing-item', requestId: 'source-view',
      status: 'ready', match: { turnKey: 'user-2', turnIndex: 2, itemFound: false }
    } })
    await renderTimeline(blocks, 'en')
    expect(container.querySelector('[data-conversation-turn="user-2"]')).not.toBeNull()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(container.textContent).toContain('Located the turn; the source item was not found')
    await act(async () => useChatStore.setState({ conversationSourceNavigation: {
      runtimeId: 'codex', threadId: 'thr_1', turnId: 'deleted', requestId: 'missing-view', status: 'missing'
    } }))
    expect(container.textContent).toContain('The original turn or item was not found')
    expect(container.querySelector('[data-conversation-turn].ring-2')).toBeNull()
  } finally { scroll.mockRestore() }
})
