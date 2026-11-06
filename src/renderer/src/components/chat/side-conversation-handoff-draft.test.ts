import { describe, expect, it } from 'vitest'
import { sideConversationHandoffDraft } from './side-conversation-handoff-draft'
import type { SideConversation } from '../../store/chat-store-types'

describe('discussion outcome draft', () => {
  it('starts from a real answer with readable source labels and leaves pending work explicit', () => {
    const side = {
      threadId: 'side-7', parentThreadId: 'main-4', title: '复验',
      context: { id: 'node-3', title: '对照实验', text: 'raw context', sourceRefs: [{ label: '失败记录', threadId: 'main-4', turnId: 'turn-2', itemId: 'exec-7' }] },
      blocks: [
        { kind: 'assistant', id: 'a1', text: '旧回答' },
        { kind: 'reasoning', id: 'r1', text: '内部分析不应进入成果' },
        { kind: 'tool', id: 't1', summary: '工具日志不应自动转发', detail: 'raw tool output' },
        { kind: 'assistant', id: 'a2', text: '目前结论尚未验证。' }
      ]
    } as unknown as SideConversation
    const draft = sideConversationHandoffDraft(side)
    expect(draft).toContain('目前结论尚未验证。')
    expect(draft).toContain('讨论范围：对照实验')
    expect(draft).toContain('失败记录')
    for (const id of ['side-7', 'main-4', 'turn-2', 'exec-7']) expect(draft).not.toContain(id)
    expect(draft).toContain('待验证与下一步')
    expect(draft).not.toContain('旧回答')
    expect(draft).not.toContain('内部分析')
    expect(draft).not.toContain('raw tool output')
  })
  it('omits opaque selection and research identities while retaining ordinary locations', () => {
    const selection = JSON.stringify({ selection: { text: 'selected data', nodeId: 'record:abc123' } })
    const sourceRefs = [
      { label: '独立复核', uri: selection },
      { label: '独立复核', uri: 'research-record:abc123' },
      { label: 'record:0123456789abcdef0123456789abcdef', uri: 'vctx_target.opaque' },
      { label: '报告', uri: 'F:\\research\\result.md' },
      { label: '日志', uri: '/workspace/results/log.txt' },
      { label: '项目记忆', uri: 'memory/context.md' },
      { label: '参考资料', uri: 'https://example.org/paper?id=2' }
    ]
    const side = { title: '复核', threadId: 'side', parentThreadId: 'main', blocks: [],
      context: { id: 'context-opaque', title: '独立种子复核', text: 'context', sourceRefs }
    } as unknown as SideConversation
    const before = structuredClone(side.context)
    const draft = sideConversationHandoffDraft(side)
    expect(draft).toContain('- 独立复核')
    expect(draft.match(/- 独立复核/g)).toHaveLength(1)
    for (const location of ['F:\\research\\result.md', '/workspace/results/log.txt', 'memory/context.md', 'https://example.org/paper?id=2']) {
      expect(draft).toContain(location)
    }
    for (const opaque of [selection, 'research-record:abc123', 'record:0123456789abcdef0123456789abcdef', 'vctx_target.opaque', 'context-opaque']) {
      expect(draft).not.toContain(opaque)
    }
    expect(side.context).toEqual(before)
  })
  it('does not invent an outcome or claim that project memory has been read', () => {
    const draft = sideConversationHandoffDraft({ title: '讨论', threadId: 's', parentThreadId: 'p', blocks: [] } as unknown as SideConversation)
    expect(draft).toContain('请填写')
    expect(draft).not.toContain('已验证')
    expect(draft).not.toContain('已读取')
  })
})
