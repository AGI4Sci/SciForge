import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  isEmptySddAssistantThreadCandidate,
  isSddAssistantThread,
  markSddAssistantThread,
  normalizeSddThreadRegistry,
  releaseSddAssistantThread,
  readSddThreadRegistry,
  sddAssistantThreadIdForDraft,
  sddDraftRefForThreadId
} from './sdd-thread-registry'
import type { SddDraft } from './sdd-draft-store'

const SDD_THREAD_REGISTRY_KEY = 'sciforge.sdd.threadRegistry.v1'

function createMemoryStorage(): BrowserStorageLike {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

function draft(partial: Partial<SddDraft> = {}): SddDraft {
  return {
    id: '/tmp/app:.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
    workspaceRoot: '/tmp/app',
    relativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

describe('sdd-thread-registry', () => {
  it('records the private Requirement AI thread for a draft', () => {
    const storage = createMemoryStorage()
    const activeDraft = draft()

    markSddAssistantThread(activeDraft, 'thread-sdd-1', storage)
    const registry = readSddThreadRegistry(storage)

    expect(sddAssistantThreadIdForDraft(activeDraft, registry)).toBe('thread-sdd-1')
    expect(isSddAssistantThread({ id: 'thread-sdd-1' }, registry)).toBe(true)
    expect(isSddAssistantThread({ id: 'thread-code-1' }, registry)).toBe(false)
  })

  it('keeps previous Requirement AI conversations hidden after creating a new one', () => {
    const storage = createMemoryStorage()
    const activeDraft = draft()

    markSddAssistantThread(activeDraft, 'thread-sdd-1', storage)
    markSddAssistantThread(activeDraft, 'thread-sdd-2', storage)
    const registry = readSddThreadRegistry(storage)

    expect(sddAssistantThreadIdForDraft(activeDraft, registry)).toBe('thread-sdd-2')
    expect(isSddAssistantThread({ id: 'thread-sdd-1' }, registry)).toBe(true)
    expect(isSddAssistantThread({ id: 'thread-sdd-2' }, registry)).toBe(true)
  })

  it('releases the Requirement AI conversation into the Code sidebar after build starts', () => {
    const storage = createMemoryStorage()
    const activeDraft = draft()

    markSddAssistantThread(activeDraft, 'thread-sdd-1', storage)
    expect(releaseSddAssistantThread('thread-sdd-1', storage)).toBe(true)
    const registry = readSddThreadRegistry(storage)

    expect(sddAssistantThreadIdForDraft(activeDraft, registry)).toBe('')
    expect(isSddAssistantThread({ id: 'thread-sdd-1' }, registry)).toBe(false)
    expect(isSddAssistantThread({
      id: 'thread-sdd-1',
      title: '下一步: .sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
    }, registry)).toBe(false)
  })

  it('keeps unreleased Requirement AI conversations hidden when one thread is released', () => {
    const storage = createMemoryStorage()
    const activeDraft = draft()

    markSddAssistantThread(activeDraft, 'thread-sdd-1', storage)
    markSddAssistantThread(activeDraft, 'thread-sdd-2', storage)
    releaseSddAssistantThread('thread-sdd-2', storage)
    const registry = readSddThreadRegistry(storage)

    expect(isSddAssistantThread({ id: 'thread-sdd-1' }, registry)).toBe(true)
    expect(isSddAssistantThread({ id: 'thread-sdd-2' }, registry)).toBe(false)
  })

  it('recognizes SDD threads by current draft paths even without registry data', () => {
    const registry = normalizeSddThreadRegistry(null)

    expect(isSddAssistantThread({
      id: 'thread-current-next',
      title: '下一步: .sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
    }, registry)).toBe(true)
    expect(isSddAssistantThread({
      id: 'thread-current-workspace',
      workspace: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000'
    }, registry)).toBe(true)
    expect(isSddAssistantThread({
      id: 'thread-normal',
      title: '需求 AI',
      workspace: '/tmp/app'
    }, registry)).toBe(false)
  })

  it('recognizes empty SDD assistant thread candidates by title and no content', () => {
    expect(isEmptySddAssistantThreadCandidate({
      id: 'thread-empty',
      title: 'Requirement AI',
      preview: '',
      latestTurnId: ''
    })).toBe(true)
    expect(isEmptySddAssistantThreadCandidate({
      id: 'thread-running',
      title: 'Requirement AI',
      status: 'running'
    })).toBe(false)
    expect(isEmptySddAssistantThreadCandidate({
      id: 'thread-normal',
      title: 'Requirement AI',
      preview: 'hello'
    })).toBe(false)
  })

  it('maps any registered SDD thread id back to its draft reference', () => {
    const storage = createMemoryStorage()
    const activeDraft = draft()
    markSddAssistantThread(activeDraft, 'thread-sdd-1', storage)
    const registry = readSddThreadRegistry(storage)

    expect(sddDraftRefForThreadId('thread-sdd-1', registry)).toEqual({
      id: activeDraft.id,
      workspaceRoot: '/tmp/app',
      relativePath: activeDraft.relativePath
    })
    expect(sddDraftRefForThreadId('thread-missing', registry)).toBeNull()
  })

  it('normalizes malformed persisted data', () => {
    const storage = createMemoryStorage()
    storage.setItem(SDD_THREAD_REGISTRY_KEY, JSON.stringify({
      drafts: {
        valid: {
          threadId: 'thread-sdd-1',
          publicThreadIds: ['thread-sdd-1', 'unknown-thread'],
          workspaceRoot: '/tmp/app/',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        invalidThread: {
          threadId: '',
          workspaceRoot: '/tmp/app'
        },
        invalidWorkspace: {
          threadId: 'thread-sdd-2',
          workspaceRoot: ''
        }
      }
    }))

    expect(readSddThreadRegistry(storage).drafts).toEqual({
      valid: {
        draftId: 'valid',
        threadId: 'thread-sdd-1',
        threadIds: ['thread-sdd-1'],
        publicThreadIds: ['thread-sdd-1'],
        workspaceRoot: '/tmp/app',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
  })

  it('returns an empty registry for invalid JSON-like shapes', () => {
    expect(normalizeSddThreadRegistry(null)).toEqual({ version: 1, drafts: {} })
    expect(normalizeSddThreadRegistry({ drafts: [] })).toEqual({ version: 1, drafts: {} })
  })
})
