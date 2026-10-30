import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultWriteSettings } from '@shared/app-settings'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import { useChatStore } from '../store/chat-store'
import { createWriteFileActions } from './write-workspace-file-actions'
import { initialState } from './write-workspace-store-helpers'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'

function makeBaseState(): WriteWorkspaceState {
  return {
    defaultWorkspaceRoot: '',
    workspaceRoots: [],
    inlineCompletion: defaultWriteSettings().inlineCompletion,
    inlineCompletionApiReady: false,
    settingsLoading: false,
    settingsError: null,
    ...initialState(),
    previewMode: 'live',
    assistantOpen: true,
    assistantModel: 'auto',
    loadWriteSettings: async () => undefined,
    selectWriteWorkspace: async () => undefined,
    addWriteWorkspace: async () => undefined,
    removeWriteWorkspace: async () => undefined,
    initializeWorkspace: async () => undefined,
    loadDirectory: async () => null,
    toggleDirectory: async () => undefined,
    refreshWorkspace: async () => undefined,
    openFile: async () => undefined,
    setFileContent: () => undefined,
    syncActiveFileFromDisk: async () => false,
    syncActiveImageFromDisk: async () => false,
    flushSave: async () => true,
    createFile: async () => null,
    createDirectory: async () => null,
    renameEntry: async () => null,
    deleteEntry: async () => false,
    setFileError: () => undefined,
    setPreviewMode: () => undefined,
    setAssistantOpen: () => undefined,
    setAssistantModel: () => undefined,
    setSelection: () => undefined,
    recordRecentEdits: () => undefined,
    quoteCurrentSelection: () => undefined,
    removeQuotedSelection: () => undefined,
    clearQuotedSelections: () => undefined,
    resetWorkspace: () => undefined
  }
}

const REMOTE_LOCATOR: WorkspaceLocator = {
  contractVersion: 1,
  hostSessionId: 'remote-session-1',
  path: '/cluster/write'
}

function createHarness(overrides: Partial<WriteWorkspaceState> = {}): {
  actions: ReturnType<typeof createWriteFileActions>
  get: WriteWorkspaceGet
} {
  let state = { ...makeBaseState(), ...overrides }
  const set: WriteWorkspaceSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  const get: WriteWorkspaceGet = () => state
  const actions = createWriteFileActions({
    set,
    get,
    cancelExternalSyncAnimation: vi.fn(),
    setLastSavedContent: vi.fn()
  })
  state = { ...state, ...actions }
  return { actions, get }
}

function installSciForge(overrides: Partial<Window['sciforge']>): void {
  vi.stubGlobal('window', {
    sciforge: overrides
  })
}

afterEach(() => {
  useChatStore.setState({ workspaceLocator: null })
  vi.unstubAllGlobals()
})

describe('write workspace file actions', () => {
  it('clears loading state and records list errors when directory IPC throws', async () => {
    installSciForge({
      listWorkspaceDirectory: vi.fn(async () => {
        throw new Error('bridge down')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.loadDirectory('/tmp/write')

    expect(result).toBeNull()
    expect(get().loadingDirs).toEqual({})
    expect(get().treeError).toBe('bridge down')
  })

  it('returns null and reports file errors when create file IPC throws', async () => {
    installSciForge({
      createWorkspaceFile: vi.fn(async () => {
        throw new Error('create failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.createFile('/tmp/write', 'draft.md')

    expect(result).toBeNull()
    expect(get().fileError).toBe('create failed')
  })

  it('returns null and reports file errors when rename IPC throws', async () => {
    installSciForge({
      renameWorkspaceEntry: vi.fn(async () => {
        throw new Error('rename failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.renameEntry('/tmp/write', '/tmp/write/draft.md', 'final.md')

    expect(result).toBeNull()
    expect(get().fileError).toBe('rename failed')
  })

  it('returns false and reports file errors when delete IPC throws', async () => {
    installSciForge({
      deleteWorkspaceEntry: vi.fn(async () => {
        throw new Error('delete failed')
      })
    })
    const { actions, get } = createHarness()

    const result = await actions.deleteEntry('/tmp/write', '/tmp/write/draft.md')

    expect(result).toBe(false)
    expect(get().fileError).toBe('delete failed')
  })

  it('opens PDF files through the unified workspace file reader', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      kind: 'pdf' as const,
      path: '/tmp/write/papers/study.pdf',
      content: '' as const,
      dataBase64: 'JVBERi0xLjQ=',
      mimeType: 'application/pdf' as const,
      size: 2048,
      truncated: false as const,
      mtimeMs: 1234,
      revision: 'pdf-revision-1'
    }))
    installSciForge({
      readWorkspaceFile
    })
    const { actions, get } = createHarness()

    await actions.openFile('/tmp/write', '/tmp/write/papers/study.pdf')

    expect(readWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write',
      path: '/tmp/write/papers/study.pdf'
    })
    expect(get()).toMatchObject({
      activeFilePath: '/tmp/write/papers/study.pdf',
      activeFileKind: 'pdf',
      fileContent: '',
      imageDataUrl: '',
      imageMimeType: '',
      pdfDataBase64: 'JVBERi0xLjQ=',
      pdfMimeType: 'application/pdf',
      pdfMtimeMs: 1234,
      fileSize: 2048,
      fileTruncated: false,
      fileLoading: false,
      fileError: null,
      saveStatus: 'saved',
      quotedSelections: []
    })
    expect(get().selection).toEqual({ text: '', ranges: [], charCount: 0 })
  })

  it('rejects PDF paths when the unified reader returns a non-PDF result', async () => {
    installSciForge({
      readWorkspaceFile: vi.fn(async () => ({
        ok: true as const,
        kind: 'text' as const,
        path: '/tmp/write/papers/study.pdf',
        content: 'not actually a pdf',
        mimeType: 'text/plain',
      size: 18,
      truncated: false,
      revision: 'text-revision-1'
      }))
    })
    const { actions, get } = createHarness()

    await actions.openFile('/tmp/write', '/tmp/write/papers/study.pdf')

    expect(get().activeFilePath).toBeNull()
    expect(get().activeFileKind).toBeNull()
    expect(get().fileLoading).toBe(false)
    expect(get().fileError).toBeTruthy()
  })

  it('pins the remote session for file reads and records the source revision', async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      kind: 'text' as const,
      path: '/cluster/write/draft.md',
      content: 'draft',
      mimeType: 'text/markdown',
      size: 5,
      truncated: false,
      revision: 'revision-1'
    }))
    installSciForge({ readWorkspaceFile })
    useChatStore.setState({ workspaceLocator: REMOTE_LOCATOR })
    const { actions, get } = createHarness({
      workspaceRoot: REMOTE_LOCATOR.path,
      pinnedWorkspaceLocator: REMOTE_LOCATOR
    })

    await actions.openFile(REMOTE_LOCATOR.path, '/cluster/write/draft.md')

    expect(readWorkspaceFile).toHaveBeenCalledWith({
      workspaceRoot: '/cluster/write',
      path: '/cluster/write/draft.md',
      workspaceLocator: REMOTE_LOCATOR
    })
    expect(get().fileRevision).toBe('revision-1')
  })

  it('rejects file mutations after switching to another session at the same path', async () => {
    const createWorkspaceFile = vi.fn()
    installSciForge({ createWorkspaceFile })
    useChatStore.setState({
      workspaceLocator: { ...REMOTE_LOCATOR, hostSessionId: 'remote-session-2' }
    })
    const { actions, get } = createHarness({
      workspaceRoot: REMOTE_LOCATOR.path,
      pinnedWorkspaceLocator: REMOTE_LOCATOR
    })

    await expect(actions.createFile(REMOTE_LOCATOR.path, 'draft.md')).resolves.toBeNull()

    expect(createWorkspaceFile).not.toHaveBeenCalled()
    expect(get().fileError).toContain('session changed')
  })
})
