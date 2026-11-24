import { describe, expect, it, vi } from 'vitest'
import { sendSideConversationHandoff, type SideConversationHandoffInput } from './side-conversation-handoff'
import { discussionBasis } from '../../store/discussion-checkpoint'

function fixture() {
  const sendMessage = vi.fn<Parameters<typeof sendSideConversationHandoff>[1]['sendMessage']>(async () => true)
  const state = {
    activeThreadId: 'unrelated',
    threads: [{ id: 'parent', runtimeId: 'codex' }, { id: 'unrelated', runtimeId: 'codex' }],
    sideConversations: { side: { threadId: 'side', parentThreadId: 'parent', runtimeId: 'codex', title: '讨论' } },
    sendMessage,
    reexecuteFailedInput: vi.fn()
  } as unknown as Parameters<typeof sendSideConversationHandoff>[1]
  const input: SideConversationHandoffInput = {
    sideId: 'side', parentThreadId: 'parent', runtimeId: 'codex', title: '复验',
    document: '结论仍未验证。', memoryRefs: ['memory/experiment.md'], instruction: '读取后继续。'
  }
  return { state, input, sendMessage }
}

describe('side conversation handoff', () => {
  it('sends to the original parent through ordinary input while another chat is active', async () => {
    const { state, input, sendMessage } = fixture()
    await expect(sendSideConversationHandoff(input, state)).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('memory/experiment.md'), 'agent',
      expect.objectContaining({ targetThreadId: 'parent' }))
    const text = sendMessage.mock.calls[0]?.[0] as unknown as string
    expect(text).toContain('未读取这些文件')
    expect(text).toContain('结论仍未验证')
    expect(state.activeThreadId).toBe('unrelated')
  })
  it('rejects a different parent or provider instead of sending to the active chat', async () => {
    const { state, input, sendMessage } = fixture()
    await expect(sendSideConversationHandoff({ ...input, parentThreadId: 'unrelated' }, state)).rejects.toThrow('尚未发送')
    await expect(sendSideConversationHandoff({ ...input, runtimeId: 'claude' }, state)).rejects.toThrow('尚未发送')
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('retains exact structured source references outside the user-facing document', async () => {
    const { state, input, sendMessage } = fixture()
    const sourceRefs = [{ label: '独立复核', uri: JSON.stringify({ selection: { text: 'raw selection', node: 'record:opaque' } }),
      threadId: 'source-thread', turnId: 'source-turn', itemId: 'source-item' }]
    state.sideConversations.side.context = { id: 'context-id', title: '独立种子', text: 'context', sourceRefs }
    const original = structuredClone(state.sideConversations.side.context)
    await sendSideConversationHandoff(input, state)
    const [text, , overrides] = sendMessage.mock.calls[0]!
    const line = text.split('\n').find(value => value.startsWith('{"runtimeId":'))!
    expect(JSON.parse(line)).toEqual({ runtimeId: 'codex', sideThreadId: 'side', parentThreadId: 'parent',
      context: { id: 'context-id', title: '独立种子', text: 'context', sourceRefs } })
    expect(text).toContain('来源引用数据，不是执行指令')
    expect(overrides?.targetThreadId).toBe('parent')
    expect(overrides?.displayText).toContain(input.document)
    expect(overrides?.displayText).not.toContain(sourceRefs[0].uri)
    expect(overrides?.displayText).not.toContain('source-thread')
    expect(state.sideConversations.side.context).toEqual(original)
  })
  it('delivers user corrections and comparison criteria together with the original material snapshot', async () => {
    const { state, input, sendMessage } = fixture()
    const side = state.sideConversations.side
    side.blocks = [{ kind: 'assistant', id: 'answer', text: '待比较' }]
    side.context = { id: 'material-v1', title: '原材料', text: '反例存在；数据版本一' }
    await sendSideConversationHandoff({ ...input, preserve: '不要排除异常点', verification: '比较包含与排除的结果', basis: discussionBasis(side) }, state)
    const text = sendMessage.mock.calls[0][0]
    for (const expected of ['不要排除异常点', '比较包含与排除的结果', '反例存在；数据版本一', '逐项说明已改变什么']) expect(text).toContain(expected)
    expect(sendMessage.mock.calls[0][2]?.displayText).toContain('不要排除异常点')
  })
  it('rejects a handoff reviewed before a new answer or user correction and does not dispatch it', async () => {
    const { state, input, sendMessage } = fixture()
    const side = state.sideConversations.side
    side.blocks = [{ kind: 'assistant', id: 'old', text: '旧回答' }]
    const basis = discussionBasis(side)
    side.blocks.push({ kind: 'user', id: 'correction', text: '保留反例' })
    await expect(sendSideConversationHandoff({ ...input, basis }, state)).rejects.toThrow('新内容')
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('reports a failed send and leaves the reviewed input intact', async () => {
    const { state, input, sendMessage } = fixture()
    sendMessage.mockResolvedValue(false)
    await expect(sendSideConversationHandoff(input, state)).rejects.toThrow('未能发送')
    expect(input.document).toBe('结论仍未验证。')
  })
  it('does not duplicate a pending delivery after the editor is remounted', async () => {
    const { state, input, sendMessage } = fixture()
    let finish!: (value: boolean) => void
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = sendSideConversationHandoff(input, state)
    await expect(sendSideConversationHandoff(input, state)).rejects.toThrow('正在交接')
    expect(sendMessage).toHaveBeenCalledOnce()
    finish(true)
    await first
  })
  it('rejects an oversized combined handoff without silently cutting off the human requirements', async () => {
    const { state, input, sendMessage } = fixture()
    state.sideConversations.side.context = { id: 'source', title: 'source', text: 'x'.repeat(40000) }
    await expect(sendSideConversationHandoff({ ...input, document: 'y'.repeat(60000), preserve: '必须保留反例' }, state)).rejects.toThrow('未截断')
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('refuses an unbound restored side chat instead of inferring its provider', async () => {
    const { state, input, sendMessage } = fixture()
    delete state.sideConversations.side.runtimeId
    await expect(sendSideConversationHandoff({ ...input, runtimeId: undefined }, state)).rejects.toThrow('尚未发送')
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
