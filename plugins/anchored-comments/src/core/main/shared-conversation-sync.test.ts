import { describe, expect, it } from 'vitest'
import { applySharedConversationPage } from './shared-conversation-sync.js'

const projectId = 'prj_CodeConversation01'
const userId = 'usr_CodeOwner000001'
const at = '2026-11-12T00:00:00.000Z'
const message = { messageId: 'm1', kind: 'user', body: 'Why?', publishedByUserId: userId, publishedAt: at }
const conversation = { projectId, conversationId: 'root', revision: 1, status: 'open', createdByUserId: userId,
  createdAt: at, messages: [message], anchor: { filePath: 'src/test.ts', side: 'new', line: 1,
    code: 'value', hunkHeader: '', baseRevision: 'abc', contentDigest: 'a'.repeat(64) } }
const event = { projectId, conversationId: 'root', sequence: 1, revision: 1, actorUserId: userId,
  occurredAt: at, change: { kind: 'created', conversation } }
const page = { protocolVersion: '1.0', type: 'rest.code_conversation.page', requestId: 'req_CodeSync000001',
  projectId, events: [event], nextSequence: 1, hasMore: false }

describe('shared conversation projection', () => {
  it.each(['duplicate-message', 'revision-gap', 'wrong-target', 'stale-boundary'])('rejects %s atomically', attack => {
    const state = applySharedConversationPage({ projectId, afterSequence: 0, conversations: [] }, page)
    const before = structuredClone(state)
    const invalid = { ...event, sequence: 2, revision: attack === 'revision-gap' ? 3 : 2,
      conversationId: attack === 'wrong-target' ? 'other' : 'root',
      change: attack === 'stale-boundary' ? { kind: 'status', status: 'resolved', observedMessageId: 'missing' }
        : { kind: 'message', message } }
    expect(() => applySharedConversationPage(state, { ...page, events: [invalid], nextSequence: 2 })).toThrow()
    expect(state).toEqual(before)
  })

  it('preserves immutable state and accepts page replay', () => {
    const state = { projectId, afterSequence: 0, conversations: [] }
    const next = applySharedConversationPage(state, page)
    expect(next.conversations).toEqual([conversation])
    expect(applySharedConversationPage(next, page)).toEqual(next)
    expect(state.conversations).toEqual([])
  })

  it('rejects gaps, project substitution and forged cursors', () => {
    const state = { projectId, afterSequence: 0, conversations: [] }
    expect(() => applySharedConversationPage(state, { ...page, events: [{ ...event, sequence: 2 }], nextSequence: 2 })).toThrow()
    expect(() => applySharedConversationPage(state, { ...page, projectId: 'prj_CodeDifferent01' })).toThrow()
    expect(() => applySharedConversationPage(state, { ...page, nextSequence: 99 })).toThrow()
  })

  it('new replies reopen resolved conversations', () => {
    const initial = applySharedConversationPage({ projectId, afterSequence: 0, conversations: [] }, page)
    const resolved = applySharedConversationPage(initial, { ...page, nextSequence: 2, events: [{ ...event,
      sequence: 2, revision: 2, change: { kind: 'status', status: 'resolved', observedMessageId: 'm1' } }] })
    const replied = applySharedConversationPage(resolved, { ...page, nextSequence: 3, events: [{ ...event,
      sequence: 3, revision: 3, change: { kind: 'message', message: { ...message, messageId: 'm2' } } }] })
    expect(replied.conversations[0]).toMatchObject({ status: 'open', revision: 3 })
    expect(replied.conversations[0]?.messages).toHaveLength(2)
  })
})
