import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  filterThreadsForSidebar,
  shouldHideThreadFromSidebarByLineage,
  shouldHideThreadFromSidebarByThreadSource
} from './thread-sidebar-visibility'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'title'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title,
    updatedAt: overrides.updatedAt ?? '2026-05-25T00:00:00.000Z',
    model: overrides.model ?? 'auto',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/Users/zxy/workspace',
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.latestTurnId ? { latestTurnId: overrides.latestTurnId } : {}),
    ...(overrides.threadSource ? { threadSource: overrides.threadSource } : {}),
    ...(overrides.visibility ? { visibility: overrides.visibility } : {}),
    ...(overrides.sidebarVisibility ? { sidebarVisibility: overrides.sidebarVisibility } : {}),
    ...(overrides.titleSource ? { titleSource: overrides.titleSource } : {}),
    ...(overrides.relation ? { relation: overrides.relation } : {}),
    ...(overrides.parentThreadId ? { parentThreadId: overrides.parentThreadId } : {}),
    ...(overrides.hasUserMessage !== undefined ? { hasUserMessage: overrides.hasUserMessage } : {})
  }
}

describe('thread-sidebar-visibility', () => {
  it('prioritizes structured sidebar visibility and thread source metadata', () => {
    const hiddenByVisibility = thread({
      id: 'hidden-by-visibility',
      title: 'Runtime managed',
      sidebarVisibility: 'hidden'
    })
    const visibleSideThread = thread({
      id: 'visible-side-thread',
      title: 'Pinned child',
      sidebarVisibility: 'visible',
      relation: 'side',
      parentThreadId: 'parent-thread'
    })
    const subagentThread = thread({
      id: 'subagent-thread',
      title: 'Worker B',
      threadSource: 'subagent'
    })
    const pdfAnnotationThread = thread({
      id: 'pdf-annotation-thread',
      title: 'PDF: selected text',
      threadSource: 'pdf_annotation'
    })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })

    expect(shouldHideThreadFromSidebarByThreadSource(subagentThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByThreadSource(pdfAnnotationThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(visibleSideThread)).toBe(true)
    expect(filterThreadsForSidebar([
      hiddenByVisibility,
      visibleSideThread,
      subagentThread,
      pdfAnnotationThread,
      mainThread
    ])).toEqual([visibleSideThread, mainThread])
  })

  it('hides child and side threads from the main sidebar', () => {
    const sideThread = thread({
      id: 'child-side-thread',
      title: 'Child worker',
      relation: 'side',
      parentThreadId: 'parent-thread'
    })
    const childThread = thread({
      id: 'child-parent-thread',
      title: 'Child worker',
      parentThreadId: 'parent-thread'
    })
    const promotedThread = thread({
      id: 'promoted-thread',
      title: 'Promoted child',
      relation: 'primary',
      parentThreadId: 'parent-thread'
    })
    const forkedThread = thread({
      id: 'forked-thread',
      title: 'Forked session',
      relation: 'fork',
      parentThreadId: 'parent-thread'
    })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })

    expect(shouldHideThreadFromSidebarByLineage(sideThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(childThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(promotedThread)).toBe(false)
    expect(shouldHideThreadFromSidebarByLineage(forkedThread)).toBe(false)
    expect(filterThreadsForSidebar([
      sideThread,
      childThread,
      promotedThread,
      forkedThread,
      mainThread
    ])).toEqual([promotedThread, forkedThread, mainThread])
  })

  it('uses summary metadata without reading history', () => {
    const visiblePlaceholder = thread({
      id: 'visible-placeholder',
      title: 'New Thread',
      hasUserMessage: true
    })
    const emptyPlaceholder = thread({
      id: 'empty-placeholder',
      title: 'New Thread',
      hasUserMessage: false
    })
    const legacyUnknown = thread({
      id: 'legacy-unknown',
      title: 'thr_legacy'
    })

    expect(filterThreadsForSidebar([
      visiblePlaceholder,
      emptyPlaceholder,
      legacyUnknown
    ])).toEqual([visiblePlaceholder, legacyUnknown])
  })

  it('keeps an explicitly main thread visible before its first user message', () => {
    const freshCoordinatorSession = thread({
      id: 'fresh-coordinator-session',
      title: 'New Thread',
      relation: 'side',
      threadSource: 'domain-runtime',
      sidebarVisibility: 'main',
      hasUserMessage: false
    })

    expect(filterThreadsForSidebar([freshCoordinatorSession])).toEqual([
      freshCoordinatorSession
    ])
  })

  it('hides attached side conversation ids without thread reads', () => {
    const attachedChildThread = thread({ id: 'child-thread', title: 'research child' })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })

    expect(filterThreadsForSidebar(
      [attachedChildThread, mainThread],
      { hiddenThreadIds: [' child-thread '] }
    )).toEqual([mainThread])
  })
})
