import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeContextStateService } from './runtime-context-state-service'

describe('RuntimeContextStateService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets derived context after an in-session history edit', () => {
    const service = new RuntimeContextStateService()
    const input = { runtimeId: 'codex' as const, threadId: 'edited' }
    service.recordCompaction({ ...input, summary: 'Discarded future' })
    service.recordCompaction({ runtimeId: 'codex', threadId: 'other', summary: 'Keep' })
    service.reset(input)
    expect(service.peek(input)).toBeNull()
    expect(service.peek({ runtimeId: 'codex', threadId: 'other' })?.summary).toBe('Keep')
  })

  it('tracks compaction and goal resume state from neutral runtime events', () => {
    const service = new RuntimeContextStateService()

    service.observeEvent({
      kind: 'user_message',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      itemId: 'user-1',
      text: 'hello'
    })
    service.observeEvent({
      kind: 'assistant_delta',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'answer'
    })
    expect(service.get({ runtimeId: 'dsh', threadId: 'thread-1' })).toMatchObject({
      rawHistoryItems: 0,
      effectiveHistoryItems: 0,
      estimatedTokens: 0
    })
    service.observeEvent({
      kind: 'compaction_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      itemId: 'compact-1',
      status: 'success',
      summary: 'Short summary',
      detail: 'token pressure',
      auto: false,
      messagesBefore: 12,
      messagesAfter: 4,
      replacedTokens: 2048,
      sourceDigest: 'abc123',
      digestMarker: '<compact:abc123>',
      sourceItemIds: ['u1', 'a1']
    })
    service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      objective: 'finish',
      status: 'active'
    })

    const state = service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
    expect(state.rawHistoryItems).toBe(12)
    expect(state.effectiveHistoryItems).toBe(4)
    expect(state.summary).toBe('Short summary')
    expect(state.summarySource).toBe('runtime')
    expect(state.triggerReason).toBe('token pressure')
    expect(state.replacedTokens).toBe(2048)
    expect(state.sourceDigest).toBe('abc123')
    expect(state.digestMarker).toBe('<compact:abc123>')
    expect(state.sourceItemIds).toEqual(['u1', 'a1'])
    expect(state.goalResume).toMatchObject({
      objective: 'finish',
      status: 'active',
      resumeCount: 0
    })
  })

  it('does not publish an in-progress native compaction as durable context state', () => {
    const service = new RuntimeContextStateService()
    service.observeEvent({
      kind: 'compaction_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      itemId: 'compact-1',
      status: 'running',
      summary: 'Compaction started'
    })
    expect(service.peek({ runtimeId: 'codex', threadId: 'thread-1' })?.summary).toBeUndefined()
    expect(service.peek({ runtimeId: 'codex', threadId: 'thread-1' })).toMatchObject({
      rawHistoryItems: 0,
      effectiveHistoryItems: 0
    })
  })

  it('clears goal resume state when a goal event is cleared', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T01:00:00.000Z'))

    const service = new RuntimeContextStateService()

    service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      objective: 'finish',
      status: 'active'
    })

    const withGoal = service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
    expect(withGoal.goalResume).toMatchObject({
      objective: 'finish',
      status: 'active'
    })

    vi.setSystemTime(new Date('2026-06-20T01:01:00.000Z'))

    service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'dsh',
      threadId: 'thread-1',
      cleared: true
    })

    const cleared = service.get({ runtimeId: 'dsh', threadId: 'thread-1' })
    expect(cleared.goalResume).toBeUndefined()
    expect(cleared.updatedAt).toBe('2026-06-20T01:01:00.000Z')
  })

  it('marks an active goal resume as blocked when the turn fails', () => {
    const service = new RuntimeContextStateService()

    service.observeEvent({
      kind: 'goal_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      objective: 'finish migration',
      status: 'active'
    })
    service.observeEvent({
      kind: 'turn_lifecycle',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'failed',
      message: 'runtime offline'
    })

    expect(service.get({ runtimeId: 'codex', threadId: 'thread-1' }).goalResume).toMatchObject({
      objective: 'finish migration',
      status: 'blocked',
      resumeCount: 0,
      lastFailureReason: 'runtime offline'
    })
  })
})
