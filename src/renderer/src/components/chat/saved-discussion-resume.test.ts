import { describe, expect, it } from 'vitest'
import type { ChatState, SideConversation } from '../../store/chat-store-types'
import { discussionHandoffKey, type DiscussionCheckpoint } from '../../store/discussion-checkpoint'
import { discussionResumeTarget, savedDiscussionsForActiveThread, unfinishedDiscussion } from './saved-discussion-resume'

const checkpoint = (patch: Partial<DiscussionCheckpoint> = {}): DiscussionCheckpoint => ({
  threadId: 'side', parentThreadId: 'main', runtimeId: 'codex', workspaceRoot: 'F:/Study',
  title: '材料讨论', createdAt: '2026-11-08', context: { id: 'material', title: '材料', text: '原始材料' },
  input: '待发送的问题', ...patch
})
const state = (patch: Partial<ChatState> = {}): ChatState => ({
  activeThreadId: 'main', activeAgentRuntime: 'codex', workspaceRoot: 'f:\\study\\',
  threads: [{ id: 'main', runtimeId: 'codex', workspace: 'F:/Study' }],
  sideConversations: {}, discussionCheckpoints: { side: checkpoint() }, ...patch
} as ChatState)

describe('saved discussion continuation', () => {
  it('offers only the current task with matching checkpoint, parent and active identities', () => {
    expect(savedDiscussionsForActiveThread(state()).map(item => item.threadId)).toEqual(['side'])
    for (const patch of [
      { activeThreadId: null }, { activeThreadId: 'other' }, { activeAgentRuntime: 'dsh' },
      { workspaceRoot: 'F:/Other' }, { discussionCheckpoints: { side: checkpoint({ parentThreadId: 'other' }) } },
      { discussionCheckpoints: { side: checkpoint({ runtimeId: 'dsh' }) } },
      { discussionCheckpoints: { side: checkpoint({ workspaceRoot: '/other' }) } },
      { discussionCheckpoints: { side: checkpoint({ workspaceRoot: undefined }) } },
      { threads: [{ id: 'main', runtimeId: 'codex', workspace: 'F:/Other' }] }
    ] as Partial<ChatState>[]) expect(savedDiscussionsForActiveThread(state(patch))).toEqual([])
  })

  it('keeps case-sensitive workspace identities distinct', () => {
    expect(savedDiscussionsForActiveThread(state({ workspaceRoot: '/study',
      threads: [{ id: 'main', runtimeId: 'codex', workspace: '/study' }] as ChatState['threads'],
      discussionCheckpoints: { side: checkpoint({ workspaceRoot: '/Study' }) }
    }))).toEqual([])
  })

  it('uses real drafts and checkpoint order without inventing last-edit times', () => {
    const first = checkpoint({ threadId: 'first', createdAt: '2020-01-01', input: ' ' })
    const second = checkpoint({ threadId: 'second', createdAt: '2021-01-01' })
    const third = checkpoint({ threadId: 'third', createdAt: '2030-01-01' })
    expect(unfinishedDiscussion(state({ discussionCheckpoints: { first, second, third } }))).toBe(second)
    expect(unfinishedDiscussion(state({ discussionCheckpoints: { first } }))).toBeUndefined()
  })

  it('returns to an edited handoff before an input and keeps an unknown send as a handoff', () => {
    const handoffDraft = { document: '人的修改', instruction: '保留反例', memory: '', preserve: '异常点' }
    const draft = checkpoint({ handoffDraft })
    expect(discussionResumeTarget(draft)).toBe('handoff')
    expect(discussionResumeTarget({ ...draft, handedOffBasis: discussionHandoffKey(handoffDraft) })).toBe('input')
    expect(discussionResumeTarget({ ...draft, input: '', handedOffBasis: discussionHandoffKey(handoffDraft) })).toBeNull()
    expect(discussionResumeTarget({ ...draft, input: '', handoffPending: 'unknown' })).toBe('handoff')
    expect(discussionResumeTarget({ ...draft, handoffDraft: { ...handoffDraft, document: '' } })).toBe('handoff')
    expect(discussionResumeTarget(checkpoint({ input: '', handoffDraft: { document: ' ', instruction: '', memory: '' } }))).toBeNull()
  })

  it('uses the live draft and ignores mismatched or non-discussion live sides', () => {
    const handoffDraft = { document: '已发送', instruction: '', memory: '' }
    const saved = checkpoint({ input: '', handoffDraft })
    const live = { ...saved, handedOffBasis: discussionHandoffKey(handoffDraft) } as SideConversation
    const current = state({ discussionCheckpoints: { side: saved }, sideConversations: { side: live } })
    expect(unfinishedDiscussion(current)).toBeUndefined()
    for (const patch of [{ runtimeId: 'dsh' }, { workspaceRoot: '/other' }, { parentThreadId: 'other' }, { source: 'child_agent' }]) {
      expect(unfinishedDiscussion({ ...current, sideConversations: { side: { ...live, ...patch } as SideConversation } })).toBeUndefined()
    }
  })
})
