import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreRememberedSddDraft, restoreSddDraft } from './sdd-draft-restore'
import { createSddDraft, readRememberedSddDraft, useSddDraftStore } from './sdd-draft-store'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

describe('sdd-draft-restore', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('window', { localStorage })
    useSddDraftStore.setState({ sessions: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useSddDraftStore.setState({ sessions: {} })
  })

  it('restores a remembered draft from disk', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app/',
      now: 1
    })
    useSddDraftStore.getState().setSessionDraft('session-1', draft, '# Previous')
    const readWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Restored',
      size: 10,
      truncated: false
    })

    const result = await restoreRememberedSddDraft({
      workspaceRoot: '/tmp/app',
      readWorkspaceFile
    })

    expect(readWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/app',
      path: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
    })
    expect(result).toMatchObject({
      kind: 'restored',
      content: '# Restored',
      draft: {
        id: draft.id,
        workspaceRoot: '/tmp/app',
        absolutePath: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
      }
    })
  })

  it('restores newer unsaved local content when disk autosave did not finish before restart', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app/',
      now: 1
    })
    useSddDraftStore.getState().setSessionDraft('session-1', draft, '# Disk draft')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    useSddDraftStore.getState().setSessionContent('session-1', '# Disk draft\n\nUnsaved local line')
    useSddDraftStore.getState().removeSession('session-1')
    const readWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Disk draft',
      size: 12,
      truncated: false
    })

    const result = await restoreRememberedSddDraft({
      workspaceRoot: '/tmp/app',
      readWorkspaceFile
    })

    expect(result).toMatchObject({
      kind: 'restored',
      content: '# Disk draft\n\nUnsaved local line',
      lastSavedContent: '# Disk draft',
      saveStatus: 'dirty'
    })
  })

  it('does not let a clean local snapshot override newer disk content', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app/',
      now: 1
    })
    useSddDraftStore.getState().setSessionDraft('session-1', draft, '# Previous')
    useSddDraftStore.getState().removeSession('session-1')
    const readWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Updated on disk',
      size: 17,
      truncated: false
    })

    const result = await restoreRememberedSddDraft({
      workspaceRoot: '/tmp/app',
      readWorkspaceFile
    })

    expect(result).toMatchObject({
      kind: 'restored',
      content: '# Updated on disk',
      lastSavedContent: '# Updated on disk',
      saveStatus: 'saved'
    })
  })

  it('clears an unreadable remembered draft so the caller can create a fresh one', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    useSddDraftStore.getState().setSessionDraft('session-1', draft, '# Previous')
    const readWorkspaceFile = vi.fn().mockResolvedValue({
      ok: false,
      message: 'ENOENT'
    })

    const result = await restoreRememberedSddDraft({
      workspaceRoot: '/tmp/app',
      readWorkspaceFile
    })

    expect(result).toMatchObject({
      kind: 'unreadable',
      draft,
      message: 'ENOENT'
    })
    expect(readRememberedSddDraft('/tmp/app')).toBeNull()
  })

  it('does not read from disk when no remembered draft exists', async () => {
    const readWorkspaceFile = vi.fn()

    await expect(restoreRememberedSddDraft({
      workspaceRoot: '/tmp/app',
      readWorkspaceFile
    })).resolves.toEqual({ kind: 'missing' })
    expect(readWorkspaceFile).not.toHaveBeenCalled()
  })

  it('restores an explicitly supplied draft without requiring it to be active', async () => {
    const draft = createSddDraft({
      id: '123e4567-e89b-12d3-a456-426614174000',
      workspaceRoot: '/tmp/app',
      now: 1
    })
    const readWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      content: '# Explicit',
      size: 10,
      truncated: false
    })

    await expect(restoreSddDraft({ draft, readWorkspaceFile })).resolves.toMatchObject({
      kind: 'restored',
      content: '# Explicit',
      saveStatus: 'saved'
    })
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/app',
      path: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
    })
  })
})
