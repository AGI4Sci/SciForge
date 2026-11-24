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
import { discussionHandoffKey, type DiscussionCheckpoint } from '../../store/discussion-checkpoint'

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
    discussionCheckpoints: {}, chatSessionPersistenceDegraded: false,
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
  const preview = [...container.querySelectorAll('button')].find(button => button.textContent === '带回主对话')!
  await act(async () => preview.click())
  const document = container.querySelector('textarea[aria-label="讨论成果文档"]') as HTMLTextAreaElement
  expect(document.value).toContain('尚未复现。')
  expect(document.value).toContain('讨论范围：独立种子复核')
  expect(document.value).toContain('复核记录')
  expect(document.value).not.toContain(selection)
  expect(document.value).not.toContain('origin')
  expect(document.value).not.toContain('turn-opaque')
  const submit = [...container.querySelectorAll('button')].find(button => button.textContent === '发送到主对话')!
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

it('keeps human edits across panel remount and requires rechecking a new answer before one handoff', async () => {
  useChatStore.setState({ sideConversations: { side: { ...side(), context: { id: 'v1', title: '材料', text: '旧版材料' } } }, sidePanel: { open: true, activeSideId: 'side' } })
  let finish!: (value: boolean) => void
  const handoff = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  const button = (text: string) => [...container.querySelectorAll('button')].find(item => item.textContent === text)!
  await act(async () => button('带回主对话').click())
  const textarea = container.querySelector('textarea[aria-label="讨论成果文档"]') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '人的要求：保留异常点，并进行匹配比较')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => root.render(null))
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  await act(async () => button('带回主对话').click())
  expect((container.querySelector('textarea[aria-label="讨论成果文档"]') as HTMLTextAreaElement).value).toContain('人的要求')
  await act(async () => useChatStore.setState(state => ({ sideConversations: { ...state.sideConversations,
    side: { ...state.sideConversations.side, blocks: [...state.sideConversations.side.blocks, { kind: 'assistant', id: 'new', text: '新回答：结论改变' }] } } })))
  expect(button('发送到主对话').disabled).toBe(true)
  expect(container.textContent).toContain('新回答：结论改变')
  await act(async () => button('已看过，继续编辑').click())
  await act(async () => { button('发送到主对话').click(); button('发送到主对话').click() })
  expect(handoff).toHaveBeenCalledOnce()
  await act(async () => finish(true))
  expect(useChatStore.getState().sideConversations.side.handedOffBasis).toBeTruthy()
  await act(async () => button('带回主对话').click())
  expect(button('已发送').disabled).toBe(true)
  expect(container.textContent).not.toContain('已验证')
})

it('keeps an interrupted handoff unverified after remount until the user checks the original task', async () => {
  useChatStore.setState({ sideConversations: { side: { ...side(), handoffPending: 'previous-pending-send',
    handoffDraft: { document: '保留反例', memory: '', instruction: '比较两种结果' } } }, sidePanel: { open: true, activeSideId: 'side' } })
  const handoff = vi.fn(async () => true)
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  const button = (text: string) => [...container.querySelectorAll('button')].find(item => item.textContent === text)!
  await act(async () => button('带回主对话').click())
  expect(button('发送到主对话').disabled).toBe(true)
  expect(container.textContent).toContain('上次发送结果不确定')
  expect(handoff).not.toHaveBeenCalled()
  await act(async () => button('已查看，确认需要重发').click())
  expect(button('发送到主对话').disabled).toBe(false)
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

function savedDiscussion(patch: Partial<DiscussionCheckpoint> = {}): DiscussionCheckpoint {
  return { threadId: 'saved', parentThreadId: 'main', runtimeId: 'codex', workspaceRoot: '/workspace',
    title: '继续比较材料', createdAt: '2026-11-08', context: { id: 'material-v1', title: '材料', text: '异常点仍保留' },
    input: '未发送的问题', ...patch }
}

function restoreHarness(checkpoints: DiscussionCheckpoint[] = [savedDiscussion()]) {
  vi.spyOn(agentRuntimeClient, 'readQueuedInputs').mockResolvedValue([])
  vi.spyOn(agentRuntimeClient, 'completeInputRecovery').mockResolvedValue(undefined)
  const detail = vi.fn(async (_id: string) => ({ blocks: side().blocks, latestSeq: 0 }))
  const provider = { getRecentThreadView: detail, subscribeThreadEvents: vi.fn(async () => undefined),
    rememberThreadRuntime: vi.fn() } as unknown as AgentProvider
  const actions = createSideActions({ set: partial => useChatStore.setState(partial), get: useChatStore.getState,
    getProvider: () => provider, t: key => key, formatRuntimeError: String, shouldOpenSettingsForError: () => false })
  useChatStore.setState(state => ({ ...actions,
    threads: state.threads.map(thread => ({ ...thread, workspace: '/workspace' })),
    discussionCheckpoints: Object.fromEntries(checkpoints.map(item => [item.threadId, item])),
    sidePanel: { open: true, activeSideId: null }
  }))
  const send = vi.spyOn(useChatStore.getState(), 'sendSideMessage')
  const spawn = vi.spyOn(useChatStore.getState(), 'spawnSideConversation')
  return { detail, send, spawn }
}

const resumeButton = () => container.querySelector<HTMLButtonElement>('[data-discussion-resume]')
const discussionPicker = () => container.querySelector<HTMLSelectElement>(`select[aria-label="${i18n.t('sidePanelTitle')}"]`)!
async function chooseDiscussion(id: string): Promise<void> {
  await act(async () => {
    const picker = discussionPicker(); picker.value = id
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('offers a saved unfinished discussion only on explicit click and focuses its exact unsent input', async () => {
  const { detail, send, spawn } = restoreHarness()
  await act(async () => root.render(<SideConversationPanel />))
  expect(resumeButton()?.textContent).toContain('继续未完成讨论')
  expect(detail).not.toHaveBeenCalled()
  await act(async () => { resumeButton()!.click(); resumeButton()!.click() })
  expect(detail).toHaveBeenCalledExactlyOnceWith('saved')
  const input = container.querySelector('textarea')!
  expect(input.value).toBe('未发送的问题')
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(input.value.length)
  expect(useChatStore.getState().sidePanel.activeSideId).toBe('saved')
  expect(send).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled()
})

it('returns directly to the exact human handoff draft without sending or dropping its question', async () => {
  const handoffDraft = { document: '人的交接草稿', instruction: '先比较，再继续', memory: 'memory/test.md',
    preserve: '保留异常点', verification: '使用匹配对照' }
  const { send, spawn } = restoreHarness([savedDiscussion({ handoffDraft })])
  const handoff = vi.fn(async () => true)
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  expect(resumeButton()?.textContent).toContain('继续编辑要带回的内容')
  await act(async () => resumeButton()!.click())
  const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="讨论成果文档"]')!
  expect(editor.value).toBe(handoffDraft.document)
  expect(document.activeElement).toBe(editor)
  expect(useChatStore.getState().sideConversations.saved.handoffDraft).toEqual(handoffDraft)
  expect(useChatStore.getState().sideConversations.saved.input).toBe('未发送的问题')
  expect(handoff).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === i18n.t('cancel'))!.click())
  await act(async () => useChatStore.getState().setSidePanelOpen(false))
  await act(async () => useChatStore.getState().setSidePanelOpen(true))
  expect(container.querySelector('textarea[aria-label="讨论成果文档"]')).toBeNull()
  expect(container.querySelector('textarea')?.value).toBe('未发送的问题')
})

it('does not recommend a sent handoff again, but keeps other saved discussions in the picker', async () => {
  const handoffDraft = { document: '已经发送', memory: '', instruction: '继续' }
  const { detail } = restoreHarness([savedDiscussion({ input: '', handoffDraft, handedOffBasis: discussionHandoffKey(handoffDraft) }),
    savedDiscussion({ threadId: 'history', title: '其他已存讨论', input: '' })])
  await act(async () => root.render(<SideConversationPanel />))
  expect(resumeButton()).toBeNull()
  expect(discussionPicker().textContent).toContain('其他已存讨论')
  expect(detail).not.toHaveBeenCalled()
  await act(async () => useChatStore.setState(state => ({ discussionCheckpoints: { ...state.discussionCheckpoints,
    saved: { ...state.discussionCheckpoints.saved, input: '新问题' } } })))
  expect(resumeButton()?.textContent).toContain('继续写未发送的问题')
  await act(async () => resumeButton()!.click())
  expect(container.querySelector('textarea[aria-label="讨论成果文档"]')).toBeNull()
  expect(container.querySelector('textarea')?.value).toBe('新问题')
})

it('restores an unknown handoff into its existing check-before-resend flow', async () => {
  const handoffDraft = { document: '结果未知的草稿', memory: '', instruction: '保留约束' }
  restoreHarness([savedDiscussion({ handoffDraft, handoffPending: discussionHandoffKey(handoffDraft) })])
  const handoff = vi.fn(async () => true)
  await act(async () => root.render(<SideConversationPanel onHandoff={handoff} />))
  expect(resumeButton()?.textContent).toContain('上次发送结果待确认')
  await act(async () => resumeButton()!.click())
  expect(container.textContent).toContain('上次发送结果不确定')
  const send = [...container.querySelectorAll('button')].find(button => button.textContent === '发送到主对话')!
  expect(send.disabled).toBe(true)
  expect(useChatStore.getState().sideConversations.saved.handoffPending).toBe(discussionHandoffKey(handoffDraft))
  expect(handoff).not.toHaveBeenCalled()
})

it('hides the continuation when task, active runtime or workspace identity does not match', async () => {
  const { detail } = restoreHarness()
  await act(async () => root.render(<SideConversationPanel />))
  for (const patch of [{ activeThreadId: 'other' }, { activeThreadId: 'main', activeAgentRuntime: 'dsh' as const },
    { activeAgentRuntime: 'codex' as const, workspaceRoot: '/other' }]) {
    await act(async () => useChatStore.setState(patch))
    expect(resumeButton()).toBeNull()
  }
  expect(detail).not.toHaveBeenCalled()
})

it('keeps a failed restoration visible and preserves the new and saved drafts until an explicit retry', async () => {
  const { detail } = restoreHarness()
  detail.mockRejectedValueOnce(new Error('synthetic history failure'))
  await act(async () => root.render(<SideConversationPanel />))
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新的旁问草稿')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    resumeButton()!.click()
  })
  expect(container.textContent).toContain('暂时无法恢复原讨论')
  expect(useChatStore.getState().sidePanel.activeSideId).toBeNull()
  expect(input.value).toBe('新的旁问草稿')
  expect(useChatStore.getState().discussionCheckpoints.saved.input).toBe('未发送的问题')
  expect(detail).toHaveBeenCalledTimes(1)
  await act(async () => resumeButton()!.click())
  expect(useChatStore.getState().sidePanel.activeSideId).toBe('saved')
  expect(detail).toHaveBeenCalledTimes(2)
  await chooseDiscussion('')
  expect(container.querySelector('textarea')?.value).toBe('新的旁问草稿')
})

it('keeps the latest explicit discussion selection when earlier restore results arrive late', async () => {
  const { detail } = restoreHarness([savedDiscussion(), savedDiscussion({ threadId: 'second', title: '另一份材料', input: '另一个问题' })])
  let first!: (value: Awaited<ReturnType<typeof detail>>) => void
  let second!: (value: Awaited<ReturnType<typeof detail>>) => void
  detail.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
  await act(async () => root.render(<SideConversationPanel />))
  await act(async () => resumeButton()!.click())
  await chooseDiscussion('second')
  await act(async () => second({ blocks: side().blocks, latestSeq: 0 }))
  expect(useChatStore.getState().sidePanel.activeSideId).toBe('second')
  await act(async () => first({ blocks: side().blocks, latestSeq: 0 }))
  expect(useChatStore.getState().sidePanel.activeSideId).toBe('second')
  expect(container.querySelector('textarea')?.value).toBe('另一个问题')
  expect(container.textContent).not.toContain('暂时无法恢复原讨论')
})

it.each(['close', 'new', 'thread', 'runtime', 'workspace', 'parent-workspace', 'selection', 'unmount'] as const)(
  'ignores a late restore failure in the side panel after %s', async change => {
    const { detail } = restoreHarness()
    let reject!: (error: Error) => void
    detail.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await act(async () => root.render(<SideConversationPanel />))
    await act(async () => resumeButton()!.click())
    await act(async () => {
      if (change === 'close') useChatStore.getState().setSidePanelOpen(false)
      if (change === 'new') container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('sidePanelNew')}"]`)!.click()
      if (change === 'thread') useChatStore.setState({ activeThreadId: 'other' })
      if (change === 'runtime') useChatStore.setState({ activeAgentRuntime: 'dsh' })
      if (change === 'workspace') useChatStore.setState({ workspaceRoot: '/other' })
      if (change === 'parent-workspace') useChatStore.setState(s => ({ threads: s.threads.map(thread => ({ ...thread, workspace: '/other' })) }))
      if (change === 'selection') useChatStore.setState({ sideConversations: { other: { ...side(), threadId: 'other' } }, sidePanel: { open: true, activeSideId: 'other' } })
      if (change === 'unmount') root.render(null)
    })
    await act(async () => useChatStore.setState({ error: 'current task notice' }))
    await act(async () => reject(new Error('synthetic late failure')))
    if (change === 'close') await act(async () => useChatStore.getState().setSidePanelOpen(true))
    if (change === 'unmount') await act(async () => root.render(<SideConversationPanel />))
    expect(useChatStore.getState().sidePanel.activeSideId).toBe(change === 'selection' ? 'other' : null)
    expect(container.textContent).not.toContain('暂时无法恢复原讨论')
    expect(useChatStore.getState().error).toBe('current task notice')
    expect(useChatStore.getState().discussionCheckpoints.saved.input).toBe('未发送的问题')
  }
)

it.each(['close', 'new', 'thread', 'runtime', 'workspace', 'selection', 'unmount'] as const)(
  'does not select a late restored discussion after %s', async change => {
    const { detail, send, spawn } = restoreHarness()
    let finish!: (value: Awaited<ReturnType<typeof detail>>) => void
    detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => root.render(<SideConversationPanel />))
    await act(async () => resumeButton()!.click())
    await act(async () => {
      if (change === 'close') useChatStore.getState().setSidePanelOpen(false)
      if (change === 'new') container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t('sidePanelNew')}"]`)!.click()
      if (change === 'thread') useChatStore.setState({ activeThreadId: 'other' })
      if (change === 'runtime') useChatStore.setState({ activeAgentRuntime: 'dsh' })
      if (change === 'workspace') useChatStore.setState({ workspaceRoot: '/other' })
      if (change === 'selection') useChatStore.setState({ sideConversations: { other: { ...side(), threadId: 'other' } }, sidePanel: { open: true, activeSideId: 'other' } })
      if (change === 'unmount') root.render(null)
    })
    await act(async () => finish({ blocks: side().blocks, latestSeq: 0 }))
    expect(useChatStore.getState().sidePanel.activeSideId).toBe(change === 'selection' ? 'other' : null)
    expect(useChatStore.getState().sidePanel.open).toBe(change !== 'close')
    expect(useChatStore.getState().discussionCheckpoints.saved.input).toBe('未发送的问题')
    expect(send).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled()
  }
)

it('shows a failed picker restore while preserving the selected live discussion and its draft', async () => {
  const { detail } = restoreHarness()
  detail.mockRejectedValueOnce(new Error('synthetic restore failure'))
  useChatStore.setState({ sideConversations: { other: { ...side(), threadId: 'other' } }, sidePanel: { open: true, activeSideId: 'other' } })
  await act(async () => root.render(<SideConversationPanel />))
  await chooseDiscussion('saved')
  expect(useChatStore.getState().sidePanel.activeSideId).toBe('other')
  expect(container.textContent).toContain('暂时无法恢复原讨论')
  expect(container.querySelector('textarea')?.value).toBe('尚未发送的草稿')
})
