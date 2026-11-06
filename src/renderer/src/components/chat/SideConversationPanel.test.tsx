// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SideConversationPanel } from './SideConversationPanel'
import { useChatStore } from '../../store/chat-store'
import type { SideConversation } from '../../store/chat-store-types'
import i18n from '../../i18n'
import { createSideActions, teardownAllSideSubscriptions } from '../../store/chat-store-side-actions'
import { dispatchAgentRuntimeEvent } from '../../agent/agent-runtime-event-dispatcher'
import { agentRuntimeClient } from '../../agent/agent-runtime-client'
import type { AgentProvider, ThreadEventSink } from '../../agent/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const original = useChatStore.getState()
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  get length() { return storage.size }, getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key), clear: () => storage.clear(), key: (i: number) => [...storage.keys()][i] ?? null
} })

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  storage.clear()
  useChatStore.setState({ activeThreadId: 'main', workspaceRoot: '/workspace', runtimeConnection: 'ready',
    activeAgentRuntime: 'codex', threads: [{ id: 'main', title: 'Main', runtimeId: 'codex', updatedAt: '2026-11-03T00:00:00Z', model: 'model-a', mode: 'agent' }], blocks: [],
    sideConversations: {}, sidePanel: { open: false, activeSideId: null }, composerPickList: ['model-a'],
    composerModel: 'model-a', composerModelGroups: [], setSidePanelOpen: open => useChatStore.setState(s => ({ sidePanel: { ...s.sidePanel, open } }))
  })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); teardownAllSideSubscriptions(); container.remove(); useChatStore.setState(original, true); storage.clear(); vi.restoreAllMocks() })

function side(): SideConversation {
  return { threadId: 'side', parentThreadId: 'origin', runtimeId: 'codex', workspaceRoot: '/origin', title: '范围讨论',
    inheritedAt: '2026-11-03T00:00:00Z', createdAt: '2026-11-03T00:00:00Z', lastSeq: 0,
    input: '尚未发送的草稿', blocks: [{ id: 'u', kind: 'user', text: '复验如何？' }, { id: 'a', kind: 'assistant', text: '尚未复现。' }],
    liveAssistant: '', liveReasoning: '', model: 'model-a', reasoningEffort: '', busy: false, turnId: null, userItemId: null, error: null }
}

it('mounts the standard composer without starting a side request and preserves its draft while hidden', async () => {
  const spawn = vi.fn(async () => null)
  const send = vi.fn(async () => true)
  useChatStore.setState({ spawnSideConversation: spawn, sendSideMessage: send })
  await act(async () => root.render(<SideConversationPanel />))
  const panel = container.querySelector('[role="complementary"]')!
  expect(panel.getAttribute('aria-hidden')).toBe('true')
  await act(async () => useChatStore.getState().setSidePanelOpen(true))
  expect(container.textContent).toContain('轻量旁问')
  const textarea = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '继续讨论的草稿')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => useChatStore.getState().setSidePanelOpen(false))
  await act(async () => useChatStore.getState().setSidePanelOpen(true))
  expect(container.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('继续讨论的草稿')
  expect(spawn).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
})

it('reserves layout space only for an open fixed panel with sufficient room and preserves its draft through resize', async () => {
  await act(async () => {
    useChatStore.getState().setSidePanelOpen(true)
    root.render(<SideConversationPanel dockAvailable />)
  })
  const panel = container.querySelector('[role="complementary"]') as HTMLDivElement
  const textarea = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '窗口变化后继续讨论')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(panel.dataset.sideChatPresentation).toBe('docked')
  expect(panel.classList.contains('fixed')).toBe(false)
  expect(panel.style.width).toBe('440px')
  await act(async () => root.render(<SideConversationPanel dockAvailable={false} />))
  expect(panel.dataset.sideChatPresentation).toBe('overlay')
  expect(panel.classList.contains('absolute')).toBe(true)
  expect(panel.style.maxWidth).toBe('calc(100% - 24px)')
  await act(async () => root.render(<SideConversationPanel dockAvailable />))
  expect(panel.dataset.sideChatPresentation).toBe('docked')
  await act(async () => useChatStore.getState().setSidePanelOpen(false))
  expect(panel.dataset.sideChatPresentation).toBe('overlay')
  expect(panel.getAttribute('aria-hidden')).toBe('true')
  await act(async () => useChatStore.getState().setSidePanelOpen(true))
  expect(panel.dataset.sideChatPresentation).toBe('docked')
  expect(container.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('窗口变化后继续讨论')
})

it('keeps a revealed auto panel floating even when fixed chat would fit', async () => {
  await act(async () => {
    useChatStore.getState().setSidePanelOpen(true)
    root.render(<SideConversationPanel dockAvailable />)
  })
  const layout = container.querySelector(`select[aria-label="${i18n.t('sideChatLayout')}"]`) as HTMLSelectElement
  await act(async () => {
    layout.value = 'auto'
    layout.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(useChatStore.getState().sidePanel.open).toBe(false)
  await act(async () => useChatStore.getState().setSidePanelOpen(true))
  const panel = container.querySelector('[role="complementary"]') as HTMLDivElement
  expect(panel.dataset.sideChatPresentation).toBe('overlay')
  expect(panel.classList.contains('absolute')).toBe(true)
  expect(panel.style.maxWidth).toBe('calc(100% - 24px)')
})

it('opens an explicitly selected side of another parent, previews the real result, and preserves a failed handoff', async () => {
  const selection = JSON.stringify({ selection: { text: 'raw selected text', nodeId: 'record:opaque' } })
  useChatStore.setState({ sideConversations: { side: { ...side(), context: {
    id: 'context-opaque', title: '独立种子复核', text: '已提供的讨论范围',
    sourceRefs: [{ label: '复核记录', uri: selection, threadId: 'origin', turnId: 'turn-opaque' }]
  } } }, sidePanel: { open: true, activeSideId: 'side' } })
  const handoff = vi.fn(async () => { throw new Error('原会话暂不可用') })
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  expect(container.textContent).toContain('尚未复现。')
  const preview = [...container.querySelectorAll('button')].find(button => button.textContent === '加入主对话')!
  await act(async () => preview.click())
  const document = container.querySelector('textarea[aria-label="讨论成果文档"]') as HTMLTextAreaElement
  expect(document.value).toContain('尚未复现。')
  expect(document.value).toContain('讨论范围：独立种子复核')
  expect(document.value).toContain('复核记录')
  expect(document.value).not.toContain(selection)
  expect(document.value).not.toContain('origin')
  expect(document.value).not.toContain('turn-opaque')
  const submit = [...container.querySelectorAll('button')].find(button => button.textContent === '发送到原主会话')!
  await act(async () => submit.click())
  expect(handoff).toHaveBeenCalledWith(expect.objectContaining({ sideId: 'side', parentThreadId: 'origin' }))
  expect(container.textContent).toContain('原会话暂不可用')
  expect(document.value).toContain('尚未复现。')
  expect(useChatStore.getState().activeThreadId).toBe('main')
})

it('recalls only the selected side history rather than the active main conversation', async () => {
  useChatStore.setState({ blocks: [{ kind: 'user', id: 'main-u', text: '主任务的输入，不应出现在侧聊' }],
    sideConversations: { side: { ...side(), input: '' } }, sidePanel: { open: true, activeSideId: 'side' },
    setSideInput: (id, input) => useChatStore.setState(s => ({ sideConversations: { ...s.sideConversations, [id]: { ...s.sideConversations[id], input } } }))
  })
  await act(async () => root.render(<SideConversationPanel />))
  const textarea = container.querySelector('textarea')!
  await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
  expect(textarea.value).toBe('复验如何？')
  expect(useChatStore.getState().blocks[0]).toMatchObject({ text: '主任务的输入，不应出现在侧聊' })
})

it('keeps an empty side focused on conversation and preserves its actual send error', async () => {
  useChatStore.setState({ sideConversations: { side: { ...side(), blocks: [], error: '请求格式被拒绝' } },
    sidePanel: { open: true, activeSideId: 'side' } })
  await act(async () => root.render(<SideConversationPanel />))
  expect(container.textContent).toContain('请求格式被拒绝')
  expect(container.querySelector('.ds-usage-chart')).toBeNull()
  expect(container.querySelector('.ds-runtime-wake-hero')).toBeNull()
  expect(container.querySelector('textarea')).not.toBeNull()
})

it('renders the captured Codex token sequence through the real side reducer as one live and one final answer', async () => {
  vi.spyOn(agentRuntimeClient, 'readQueuedInputs').mockResolvedValue([])
  vi.spyOn(agentRuntimeClient, 'completeInputRecovery').mockResolvedValue(undefined)
  useChatStore.setState({ sideConversations: { side: { ...side(), input: '', blocks: [{ id: 'u', kind: 'user', text: '校验码是什么？' }], userItemId: 'u' } },
    sidePanel: { open: true, activeSideId: 'side' } })
  let sink!: ThreadEventSink
  const provider = { subscribeThreadEvents: async (_id: string, _seq: number, target: ThreadEventSink) => { sink = target } } as unknown as AgentProvider
  const actions = createSideActions({ set: partial => useChatStore.setState(partial), get: useChatStore.getState,
    getProvider: () => provider, t: key => key, formatRuntimeError: String, shouldOpenSettingsForError: () => false })
  await actions.attachSideConversation({ threadId: 'side', parentThreadId: 'origin', openPanel: true })
  await act(async () => root.render(<SideConversationPanel />))
  let expected = ''
  for (const [seq, text] of [[5, 'light'], [7, '-memory'], [8, '-'], [9, '526'], [10, '7']] as const) {
    await act(async () => dispatchAgentRuntimeEvent({ kind: 'assistant_delta', threadId: 'side', itemId: `agent_message-${seq}-0`, text, seq }, sink))
    expected += text
    const answers = container.querySelectorAll('.ds-chat-answer')
    expect(answers).toHaveLength(1)
    expect(answers[0].textContent).toBe(expected)
  }
  await act(async () => {
    dispatchAgentRuntimeEvent({ kind: 'item_snapshot', threadId: 'side', seq: 11,
      item: { id: 'agent_message-11-0', kind: 'assistant_message', text: 'light-memory-5267' } }, sink)
    sink.onTurnComplete()
  })
  expect(container.querySelectorAll('.ds-chat-answer')).toHaveLength(1)
  expect(container.querySelector('.ds-chat-answer')!.textContent).toBe('light-memory-5267')
})
