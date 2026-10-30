import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileWriteResult } from '@shared/workspace-file'
import {
  createSddDraft,
  forgetRememberedSddDraft,
  readRememberedSddDraft,
  readRememberedSddDraftContent,
  selectSddDraftSession,
  useSddDraftStore,
  type SddDraft
} from './sdd-draft-store'
import { saveSddDraftToDisk, syncSddDraftFromDisk } from './sdd-draft-actions'

const SDD_DRAFT_REGISTRY_STORAGE_KEY = 'sciforge.sdd.draft.registry.v1'
const SESSION_1 = 'session-1'
const SESSION_2 = 'session-2'

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

function draft(id: string, workspaceRoot: string, now: number): SddDraft {
  return createSddDraft({ id, workspaceRoot, now })
}

function session(ownerSessionId = SESSION_1) {
  return selectSddDraftSession(useSddDraftStore.getState(), ownerSessionId)
}

describe('session-owned sdd draft state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('window', {
      localStorage,
      sciforge: {
        readWorkspaceFile: vi.fn(),
        writeWorkspaceFile: vi.fn()
      }
    })
    useSddDraftStore.setState({ sessions: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useSddDraftStore.setState({ sessions: {} })
  })

  it('isolates draft, content, save state, operation state, and errors by owner session', () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/app', 2)

    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionDraft(SESSION_2, second, '# Second')
    store.setSessionContent(SESSION_1, '# First changed')
    store.setSessionOperationStatus(SESSION_2, 'error', 'second failed')

    expect(session(SESSION_1)).toMatchObject({
      ownerSessionId: SESSION_1,
      draft: { id: first.id },
      content: '# First changed',
      saveStatus: 'dirty',
      operationStatus: 'idle',
      error: null
    })
    expect(session(SESSION_2)).toMatchObject({
      ownerSessionId: SESSION_2,
      draft: { id: second.id },
      content: '# Second',
      saveStatus: 'saved',
      operationStatus: 'error',
      error: 'second failed'
    })
  })

  it('removes only the requested session state', () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/other', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionDraft(SESSION_2, second, '# Second')

    store.removeSession(SESSION_1)

    expect(session(SESSION_1)).toBeNull()
    expect(session(SESSION_2)?.draft.id).toBe(second.id)
  })

  it('moves one session namespace without changing another owner', () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/other', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionContent(SESSION_1, '# First changed')
    store.setSessionOperationStatus(SESSION_1, 'error', 'first failed')
    store.setSessionDraft(SESSION_2, second, '# Second')
    const sessionTwo = session(SESSION_2)

    store.moveSession(' session-1 ', ' session-promoted ')

    expect(session(SESSION_1)).toBeNull()
    expect(session('session-promoted')).toMatchObject({
      ownerSessionId: 'session-promoted',
      draft: { id: first.id },
      content: '# First changed',
      lastSavedContent: '# First',
      saveStatus: 'dirty',
      operationStatus: 'error',
      error: 'first failed'
    })
    expect(session(SESSION_2)).toBe(sessionTwo)
  })

  it('preserves the canonical target draft when a handoff collides', () => {
    const source = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/source', 1)
    const targetDraft = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/target', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft('session-source', source, '# Source')
    store.setSessionDraft('session-target', targetDraft, '# Target')
    const target = session('session-target')

    store.moveSession('session-source', 'session-target')

    expect(session('session-source')).toBeNull()
    expect(session('session-target')).toBe(target)
    expect(session('session-target')?.content).toBe('# Target')
  })

  it('keeps remembered draft recovery independent from transient session ownership', () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/other', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionDraft(SESSION_2, second, '# Second')
    forgetRememberedSddDraft(first)

    expect(readRememberedSddDraft('/tmp/app')).toBeNull()
    expect(readRememberedSddDraft('/tmp/other')?.id).toBe(second.id)
    expect(session(SESSION_1)?.draft.id).toBe(first.id)
  })

  it('persists unsaved content for recovery without merging session state', () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# Draft')
    store.setSessionContent(SESSION_1, '# Draft\n\nUnsaved line')

    expect(readRememberedSddDraftContent(first)).toMatchObject({
      draftId: first.id,
      content: '# Draft\n\nUnsaved line',
      lastSavedContent: '# Draft'
    })
  })

  it('normalizes malformed persisted draft registry data', () => {
    localStorage.setItem(SDD_DRAFT_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByWorkspace: { '/tmp/valid/': 'valid', '/tmp/missing': 'missing' },
      drafts: {
        valid: {
          workspaceRoot: '/tmp/valid/',
          relativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        invalid: { id: 'invalid', workspaceRoot: 42, relativePath: '' }
      }
    }))

    expect(readRememberedSddDraft('/tmp/valid')).toMatchObject({
      id: 'valid',
      workspaceRoot: '/tmp/valid',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(readRememberedSddDraft('/tmp/missing')).toBeNull()
  })

  it('saves one owner without mutating another owner', async () => {
    window.sciforge.writeWorkspaceFile = vi.fn().mockResolvedValue({
      ok: true,
      path: '/tmp/app/draft.md',
      savedAt: '2026-01-01T00:00:00.000Z'
    })
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/other', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionDraft(SESSION_2, second, '# Second')
    store.setSessionContent(SESSION_1, '# First changed')
    store.setSessionContent(SESSION_2, '# Second changed')

    await expect(saveSddDraftToDisk(SESSION_1)).resolves.toBe(true)

    expect(window.sciforge.writeWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/app',
      path: first.relativePath,
      content: '# First changed'
    })
    expect(session(SESSION_1)).toMatchObject({
      content: '# First changed',
      lastSavedContent: '# First changed',
      saveStatus: 'saved'
    })
    expect(session(SESSION_2)).toMatchObject({
      content: '# Second changed',
      lastSavedContent: '# Second',
      saveStatus: 'dirty'
    })
  })

  it('does not redirect an in-flight save after the same owner opens another draft', async () => {
    let finishWrite!: (value: WorkspaceFileWriteResult) => void
    window.sciforge.writeWorkspaceFile = vi.fn(() => new Promise<WorkspaceFileWriteResult>((resolve) => {
      finishWrite = resolve
    }))
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const replacement = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/app', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionContent(SESSION_1, '# First changed')

    const saving = saveSddDraftToDisk(SESSION_1)
    useSddDraftStore.getState().setSessionDraft(SESSION_1, replacement, '# Replacement')
    finishWrite({
      ok: true,
      path: '/tmp/app/draft.md',
      savedAt: '2026-01-01T00:00:00.000Z',
      revision: 'revision-1'
    })
    await saving

    expect(session(SESSION_1)).toMatchObject({
      draft: { id: replacement.id },
      content: '# Replacement',
      lastSavedContent: '# Replacement',
      saveStatus: 'saved'
    })
  })

  it('preserves edits made while a save is in flight', async () => {
    let finishWrite!: (value: WorkspaceFileWriteResult) => void
    window.sciforge.writeWorkspaceFile = vi.fn(() => new Promise<WorkspaceFileWriteResult>((resolve) => {
      finishWrite = resolve
    }))
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# Draft')
    store.setSessionContent(SESSION_1, '# First edit')

    const saving = saveSddDraftToDisk(SESSION_1)
    useSddDraftStore.getState().setSessionContent(SESSION_1, '# Newer edit')
    finishWrite({
      ok: true,
      path: '/tmp/app/draft.md',
      savedAt: '2026-01-01T00:00:00.000Z',
      revision: 'revision-1'
    })
    await saving

    expect(session(SESSION_1)).toMatchObject({
      content: '# Newer edit',
      lastSavedContent: '# First edit',
      saveStatus: 'dirty'
    })
  })

  it('syncs disk changes to the addressed owner only', async () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const second = draft('123e4567-e89b-12d3-a456-426614174111', '/tmp/other', 2)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# First')
    store.setSessionDraft(SESSION_2, second, '# Second')

    await expect(syncSddDraftFromDisk(SESSION_1, {
      path: first.relativePath,
      content: '# Updated from disk'
    })).resolves.toBe(true)

    expect(session(SESSION_1)?.content).toBe('# Updated from disk')
    expect(session(SESSION_2)?.content).toBe('# Second')
  })

  it('does not overwrite unsaved edits with disk changes', async () => {
    const first = draft('123e4567-e89b-12d3-a456-426614174000', '/tmp/app', 1)
    const store = useSddDraftStore.getState()
    store.setSessionDraft(SESSION_1, first, '# Draft')
    store.setSessionContent(SESSION_1, '# Local edit')

    await expect(syncSddDraftFromDisk(SESSION_1, {
      path: first.relativePath,
      content: '# External edit'
    })).resolves.toBe(false)
    expect(session(SESSION_1)?.content).toBe('# Local edit')
  })
})
