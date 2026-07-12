import { describe, expect, it } from 'vitest'
import {
  RightPanelContextStateMemory,
  rightPanelContextStateKey,
  type RememberedChildAgentsViewState,
  type RememberedPdfViewState
} from './right-panel-context-state'

describe('rightPanelContextStateKey', () => {
  it('isolates mode, workspace, thread, and resource state', () => {
    expect(rightPanelContextStateKey({
      mode: 'file-pdf',
      workspaceRoot: '/repo a',
      threadId: 'thread-1',
      resourceId: 'paper.pdf'
    })).toBe('file-pdf|%2Frepo%20a|thread-1|paper.pdf')

    expect(rightPanelContextStateKey({ mode: 'child-agents', threadId: 'thread-1' }))
      .not.toBe(rightPanelContextStateKey({ mode: 'child-agents', threadId: 'thread-2' }))
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
    const firstKey = rightPanelContextStateKey({ mode: 'child-agents', threadId: 'root-1' })
    const secondKey = rightPanelContextStateKey({ mode: 'child-agents', threadId: 'root-2' })
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
})
