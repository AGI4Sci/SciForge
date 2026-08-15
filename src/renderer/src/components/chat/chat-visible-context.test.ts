import { describe, expect, it } from 'vitest'
import {
  buildMessageTimelineVisibleContextComponent,
  canonicalTurnId,
  messageTimelineVisibleContextComponentId
} from './MessageTimeline'
import {
  buildFloatingComposerVisibleContextComponent,
  floatingComposerVisibleContextComponentId
} from './FloatingComposer'

describe('chat visible context', () => {
  it('keeps the exact runtime turn identity available to timeline contributions', () => {
    expect(canonicalTurnId({
      user: { kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' },
      blocks: []
    })).toBe('turn-1')
  })

  it('publishes bounded timeline semantics without message or reasoning text', () => {
    const component = buildMessageTimelineVisibleContextComponent({
      activeThreadId: 'thread-1',
      blockCount: 23,
      turnCount: 8,
      visibleTurnCount: 5,
      hiddenTurnCount: 3,
      pendingRuntimeTurnCount: 1,
      busy: true,
      live: true,
      reasoning: true,
      runtimeConnection: 'ready',
      remoteChannelMode: false,
      updatedAt: '2026-07-19T00:00:00.000Z'
    })

    expect(component.id).toBe(messageTimelineVisibleContextComponentId('thread-1'))
    expect(component.state).toEqual({
      activeThreadId: 'thread-1',
      blockCount: 23,
      turnCount: 8,
      visibleTurnCount: 5,
      hiddenTurnCount: 3,
      pendingRuntimeTurnCount: 1,
      busy: true,
      live: true,
      reasoning: true,
      runtimeConnection: 'ready',
      remoteChannelMode: false,
      hasContent: true
    })
    expect(JSON.stringify(component)).not.toContain('messageText')
    expect(JSON.stringify(component)).not.toContain('reasoningText')
  })

  it('gives concurrently mounted timelines stable thread-scoped identities', () => {
    expect(messageTimelineVisibleContextComponentId('thread-main')).toBe('chat.timeline.thread-main')
    expect(messageTimelineVisibleContextComponentId('thread-child')).toBe('chat.timeline.thread-child')
    expect(messageTimelineVisibleContextComponentId(null)).toBe('chat.timeline.empty')
  })

  it('publishes composer readiness and reference counts without draft or reference contents', () => {
    const component = buildFloatingComposerVisibleContextComponent({
      id: 'chat.composer',
      activeThreadId: 'thread-1',
      variant: 'default',
      draftNonEmpty: true,
      attachmentCount: 2,
      fileReferenceCount: 3,
      commentReferenceCount: 1,
      queuedMessageCount: 4,
      mode: 'plan',
      model: 'model-1',
      reasoningEffort: 'high',
      runtime: 'codex',
      busy: false,
      runtimeReady: true,
      canCompose: true,
      canSend: true,
      attachmentUploadBusy: false,
      updatedAt: '2026-07-19T00:00:00.000Z'
    })

    expect(component.state).toEqual({
      activeThreadId: 'thread-1',
      variant: 'default',
      draftNonEmpty: true,
      attachmentCount: 2,
      fileReferenceCount: 3,
      commentReferenceCount: 1,
      queuedMessageCount: 4,
      mode: 'plan',
      model: 'model-1',
      reasoningEffort: 'high',
      runtime: 'codex',
      busy: false,
      runtimeReady: true,
      canCompose: true,
      canSend: true,
      attachmentUploadBusy: false
    })
    const serialized = JSON.stringify(component)
    expect(serialized).not.toContain('secret draft')
    expect(serialized).not.toContain('/private/file.pdf')
    expect(serialized).not.toContain('private comment')
  })

  it('uses stable non-colliding composer identities for primary, compact, and child composers', () => {
    expect(floatingComposerVisibleContextComponentId({
      variant: 'default',
      activeThreadId: 'main',
      embedded: false
    })).toBe('chat.composer')
    expect(floatingComposerVisibleContextComponentId({
      variant: 'compact',
      activeThreadId: null,
      embedded: false
    })).toBe('chat.composer.compact')
    expect(floatingComposerVisibleContextComponentId({
      variant: 'default',
      activeThreadId: 'child',
      embedded: true
    })).toBe('chat.composer.thread.child')
  })
})
