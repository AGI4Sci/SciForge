import { describe, expect, it } from 'vitest'
import {
  RightPanelContextStateMemory,
  rightPanelContextStateKey,
  type RememberedChildAgentsViewState,
  type RememberedPdfViewState
} from './right-panel-context-state'

describe('rightPanelContextStateKey', () => {
  it('isolates mode, workspace, thread, surface, and resource state', () => {
    const first = rightPanelContextStateKey({
      mode: 'file-pdf',
      workspaceRoot: '/repo a',
      threadId: 'thread-1',
      surfaceId: 'pane-1',
      resourceId: 'paper.pdf'
    })
    const second = rightPanelContextStateKey({
      mode: 'file-pdf',
      workspaceRoot: '/repo a',
      threadId: 'thread-1',
      surfaceId: 'pane-2',
      resourceId: 'paper.pdf'
    })

    expect(first).not.toBe(second)
    expect(rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'thread-1',
      surfaceId: 'pane-1'
    })).not.toBe(rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'thread-2',
      surfaceId: 'pane-1'
    }))
  })

  it('uses collision-free structured fields when identities contain delimiters', () => {
    expect(rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session|surface',
      surfaceId: 'pane'
    })).not.toBe(rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session',
      surfaceId: 'surface|pane'
    }))
  })
})

describe('RightPanelContextStateMemory', () => {
  it('merges incremental PDF state written across view events', () => {
    const memory = new RightPanelContextStateMemory()
    memory.remember<RememberedPdfViewState>('paper', {
      currentPage: 8,
      scale: 1.4,
      searchQuery: 'method'
    })
    memory.remember<RememberedPdfViewState>('paper', { scrollTop: 1200 })

    expect(memory.read<RememberedPdfViewState>('paper')).toEqual({
      currentPage: 8,
      scale: 1.4,
      searchQuery: 'method',
      scrollTop: 1200
    })
  })

  it('keeps child navigation, selection, and drafts isolated by root thread', () => {
    const memory = new RightPanelContextStateMemory()
    const firstKey = rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'root-1',
      surfaceId: 'pane-1'
    })
    const secondKey = rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'root-2',
      surfaceId: 'pane-1'
    })
    memory.remember<RememberedChildAgentsViewState>(firstKey, {
      parentThreadPath: ['root-1', 'research'],
      selectedChildId: 'review',
      draftByThreadId: { review: 'Check the source.' }
    })
    memory.remember<RememberedChildAgentsViewState>(secondKey, {
      parentThreadPath: ['root-2'],
      selectedChildId: null
    })

    expect(memory.read<RememberedChildAgentsViewState>(firstKey)?.draftByThreadId)
      .toEqual({ review: 'Check the source.' })
    expect(memory.read<RememberedChildAgentsViewState>(secondKey)?.draftByThreadId).toBeUndefined()
  })

  it('refreshes recently read entries and evicts the least recently used context', () => {
    const memory = new RightPanelContextStateMemory(2)
    memory.remember('a', { value: 1 })
    memory.remember('b', { value: 2 })
    expect(memory.read('a')).toEqual({ value: 1 })
    memory.remember('c', { value: 3 })

    expect(memory.read('b')).toBeNull()
    expect(memory.read('a')).toEqual({ value: 1 })
    expect(memory.read('c')).toEqual({ value: 3 })
  })

  it('does not retain state for an empty key and can explicitly forget contexts', () => {
    const memory = new RightPanelContextStateMemory()
    expect(memory.remember('', { value: 1 })).toBeNull()
    memory.remember('context', { value: 2 })
    memory.forget('context')
    expect(memory.size).toBe(0)
  })

  it('releases only the disposed Session contexts', () => {
    const memory = new RightPanelContextStateMemory()
    const first = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session-1',
      surfaceId: 'pane-1',
      resourceId: 'a.pdf'
    })
    const second = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session-2',
      surfaceId: 'pane-1',
      resourceId: 'a.pdf'
    })
    memory.remember(first, { currentPage: 4 })
    memory.remember(second, { currentPage: 9 })

    memory.forgetThread('session-1')

    expect(memory.read(first)).toBeNull()
    expect(memory.read(second)).toEqual({ currentPage: 9 })
  })

  it('releases only the disposed pane surface in a Session', () => {
    const memory = new RightPanelContextStateMemory()
    const first = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session-1',
      surfaceId: 'pane|1',
      resourceId: 'a.pdf'
    })
    const second = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session-1',
      surfaceId: 'pane|2',
      resourceId: 'a.pdf'
    })
    memory.remember(first, { currentPage: 4 })
    memory.remember(second, { currentPage: 9 })

    memory.forgetSurface('session-1', 'pane|1')

    expect(memory.read(first)).toBeNull()
    expect(memory.read(second)).toEqual({ currentPage: 9 })
  })

  it('moves every remembered context when a Session identity is handed off', () => {
    const memory = new RightPanelContextStateMemory()
    const previousPdf = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session|1',
      surfaceId: 'pane|pdf',
      resourceId: 'a.pdf'
    })
    const previousChildren = rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'session|1',
      surfaceId: 'pane|children'
    })
    const nextPdf = rightPanelContextStateKey({
      mode: 'file-pdf',
      threadId: 'session-2',
      surfaceId: 'pane|pdf',
      resourceId: 'a.pdf'
    })
    const nextChildren = rightPanelContextStateKey({
      mode: 'child-agents',
      threadId: 'session-2',
      surfaceId: 'pane|children'
    })
    memory.remember(previousPdf, { currentPage: 4 })
    memory.remember(previousChildren, { selectedChildId: 'review' })

    memory.moveThread('session|1', 'session-2')

    expect(memory.read(previousPdf)).toBeNull()
    expect(memory.read(previousChildren)).toBeNull()
    expect(memory.read(nextPdf)).toEqual({ currentPage: 4 })
    expect(memory.read(nextChildren)).toEqual({ selectedChildId: 'review' })
  })
})
