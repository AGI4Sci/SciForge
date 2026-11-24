import { describe, expect, it } from 'vitest'
import { checkpointDiscussions, discussionBasis, discussionHandoffKey, normalizeDiscussionCheckpoints } from './discussion-checkpoint'
import type { SideConversation } from './chat-store-types'

export function savedDiscussionFixture(): SideConversation {
  return { threadId: 'side', parentThreadId: 'parent', runtimeId: 'codex', workspaceRoot: '/study', title: '材料讨论',
    source: 'side', createdAt: '2026-11-08T00:00:00Z', input: '尚未发送', inheritedAt: '2026-11-08T00:00:00Z',
    liveReasoning: '', liveAssistant: '', lastSeq: 1, model: 'configured-model', reasoningEffort: '', busy: false,
    turnId: null, userItemId: null, error: null,
    context: { id: 'version-1', title: '原材料', text: '精确版本，仍需对照', sourceRefs: [{ label: '来源', uri: '{"version":1}' }] },
    blocks: [{ kind: 'user', id: 'u', text: '保留异常点' }, { kind: 'assistant', id: 'a', text: '尚未比较' }],
    handoffDraft: { document: '仍未知', memory: '', instruction: '继续比较', preserve: '保留异常点', verification: '比较两种处理' }
  }
}

describe('private discussion checkpoints', () => {
  it('saves exact context and user drafts, excludes execution state and transcript, and survives JSON reload', () => {
    const side = savedDiscussionFixture()
    side.handoffPending = 'unsettled-request'
    const saved = checkpointDiscussions({ side }, {})
    const restored = normalizeDiscussionCheckpoints(JSON.parse(JSON.stringify(saved)))
    expect(restored.side.context).toEqual(side.context)
    expect(restored.side.handoffDraft).toEqual(side.handoffDraft)
    expect(restored.side.input).toBe('尚未发送')
    expect(restored.side.handoffPending).toBe('unsettled-request')
    expect(discussionHandoffKey(restored.side.handoffDraft!)).toBe(discussionHandoffKey(side.handoffDraft!))
    expect(restored.side).not.toHaveProperty('blocks')
    expect(restored.side).not.toHaveProperty('busy')
    expect(checkpointDiscussions({}, saved)).toBe(saved)
  })
  it('rejects mismatched identities and overlong content without truncating a human requirement', () => {
    const saved = checkpointDiscussions({ side: savedDiscussionFixture() }, {})
    expect(normalizeDiscussionCheckpoints({ other: saved.side })).toEqual({})
    expect(normalizeDiscussionCheckpoints({ side: { ...saved.side, runtimeId: 'unknown' } })).toEqual({})
    expect(normalizeDiscussionCheckpoints({ side: { ...saved.side, context: { ...saved.side.context, text: 'x'.repeat(40001) } } })).toEqual({})
    expect(normalizeDiscussionCheckpoints({ side: { ...saved.side, handoffDraft: { ...saved.side.handoffDraft, preserve: 'x'.repeat(8001) } } })).toEqual({})
  })
  it('invalidates a reviewed draft when user corrections, answers, material or routing change', () => {
    const side = savedDiscussionFixture(), basis = discussionBasis(side)
    const patches: Partial<SideConversation>[] = [ { parentThreadId: 'other' }, { runtimeId: 'dsh' }, { workspaceRoot: '/other' },
      { context: { ...side.context!, text: '新反例' } },
      { blocks: [...side.blocks, { id: 'u2', kind: 'user' as const, text: '不要删除负结果' }] },
      { blocks: [...side.blocks, { id: 'a2', kind: 'assistant' as const, text: '已做新比较' }] } ]
    for (const patch of patches) {
      expect(discussionBasis({ ...side, ...patch })).not.toBe(basis)
    }
  })
  it('does not checkpoint unrelated or child-agent conversations', () => {
    const side = savedDiscussionFixture()
    expect(checkpointDiscussions({ side: { ...side, context: undefined } }, {})).toEqual({})
    expect(checkpointDiscussions({ side: { ...side, source: 'child_agent' } }, {})).toEqual({})
  })
  it('keeps the checkpoint stable during token streaming instead of serializing notes on every delta', () => {
    const side = savedDiscussionFixture()
    const previous = checkpointDiscussions({ side }, {})
    expect(checkpointDiscussions({ side: { ...side, liveAssistant: 'streaming new token', busy: true } }, previous)).toBe(previous)
    expect(checkpointDiscussions({ side: { ...side, input: 'new user question' } }, previous)).not.toBe(previous)
  })
})
