import i18n from '../i18n'
import { isWriteImageFilePath, isWritePdfFilePath, isWriteWorkspaceFilePath } from '@shared/write-text-file'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import {
  emptySelection,
  filterWriteEntries,
  formatWriteImageLoadError,
  initialState,
  normalizePath,
  readRememberedActiveFile,
  rememberActiveFile,
  writeDirnameFromPath
} from './write-workspace-store-helpers'
import {
  pinWorkspaceLocator,
  withPinnedWorkspaceLocator
} from '../remote-workspace/placement'

type WriteFileActions = Pick<
  WriteWorkspaceState,
  | 'initializeWorkspace'
  | 'loadDirectory'
  | 'toggleDirectory'
  | 'refreshWorkspace'
  | 'openFile'
  | 'createFile'
  | 'createDirectory'
  | 'renameEntry'
  | 'deleteEntry'
>

type WriteFileActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
  cancelExternalSyncAnimation: () => void
  setLastSavedContent: (content: string) => void
}

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withoutLoadingDirs(
  loadingDirs: Record<string, boolean>,
  keys: Array<string | undefined>
): Record<string, boolean> {
  const next = { ...loadingDirs }
  for (const key of keys) {
    if (key) delete next[key]
  }
  return next
}

export function createWriteFileActions({
  set,
  get,
  cancelExternalSyncAnimation,
  setLastSavedContent
}: WriteFileActionContext): WriteFileActions {
  return {
    initializeWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot.trim())
      if (!normalized) {
        cancelExternalSyncAnimation()
        setLastSavedContent('')
        set(initialState())
        return
      }
      const current = get()
      const pinnedWorkspaceLocator = pinWorkspaceLocator(normalized)
      if (
        current.workspaceRoot === normalized &&
        current.rootDirectory &&
        current.pinnedWorkspaceLocator?.hostSessionId === pinnedWorkspaceLocator?.hostSessionId &&
        current.pinnedWorkspaceLocator?.path === pinnedWorkspaceLocator?.path
      ) return

      setLastSavedContent('')
      cancelExternalSyncAnimation()
      set({ ...initialState(), workspaceRoot: normalized, pinnedWorkspaceLocator })
      const root = await get().loadDirectory(normalized)
      if (!root) return
      set((state) => ({ rootDirectory: root, expandedDirs: new Set([...state.expandedDirs, root]) }))
      const remembered = readRememberedActiveFile(normalized)
      if (remembered.trim() && isWriteWorkspaceFilePath(remembered)) {
        await get().openFile(normalized, remembered)
      } else if (remembered.trim()) {
        rememberActiveFile(normalized, null)
      }
    },

    loadDirectory: async (workspaceRoot, path) => {
      const requestedRoot = normalizePath(path || workspaceRoot)
      const targetKey = path ? requestedRoot : '__root__'
      set((state) => ({ loadingDirs: { ...state.loadingDirs, [targetKey]: true } }))
      let result: Awaited<ReturnType<typeof window.sciforge.listWorkspaceDirectory>>
      try {
        result = await window.sciforge.listWorkspaceDirectory(
          withPinnedWorkspaceLocator({ workspaceRoot, path }, get().pinnedWorkspaceLocator)
        )
      } catch (error) {
        set((state) => ({
          loadingDirs: withoutLoadingDirs(state.loadingDirs, [targetKey, requestedRoot]),
          treeError: formatActionError(error)
        }))
        return null
      }
      set((state) => {
        const loadingDirs = withoutLoadingDirs(state.loadingDirs, [
          targetKey,
          requestedRoot,
          result.ok ? result.root : undefined
        ])
        return { loadingDirs }
      })
      if (!result.ok) {
        set({ treeError: result.message })
        return null
      }
      const visibleEntries = filterWriteEntries(result.entries)
      set((state) => {
        const entriesByDir = { ...state.entriesByDir, [result.root]: visibleEntries }
        if (requestedRoot && requestedRoot !== result.root) {
          entriesByDir[requestedRoot] = visibleEntries
        }
        const expandedDirs = new Set(state.expandedDirs)
        if (!path) expandedDirs.add(result.root)
        return {
          treeError: null,
          rootDirectory: !path && !state.rootDirectory ? result.root : state.rootDirectory,
          expandedDirs,
          entriesByDir
        }
      })
      return result.root
    },

    toggleDirectory: async (workspaceRoot, path) => {
      try {
        withPinnedWorkspaceLocator({ workspaceRoot }, get().pinnedWorkspaceLocator)
      } catch (error) {
        set({ treeError: formatActionError(error) })
        return
      }
      const expanded = get().expandedDirs.has(path)
      if (!expanded && !get().entriesByDir[path]) {
        await get().loadDirectory(workspaceRoot, path)
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        if (expandedDirs.has(path)) {
          expandedDirs.delete(path)
        } else {
          expandedDirs.add(path)
        }
        return { expandedDirs }
      })
    },

    refreshWorkspace: async (workspaceRoot) => {
      try {
        withPinnedWorkspaceLocator({ workspaceRoot }, get().pinnedWorkspaceLocator)
      } catch (error) {
        set({ treeError: formatActionError(error) })
        return
      }
      const state = get()
      const root = state.rootDirectory || await get().loadDirectory(workspaceRoot)
      if (!root) return
      if (!state.rootDirectory) {
        set((latest) => ({ rootDirectory: root, expandedDirs: new Set([...latest.expandedDirs, root]) }))
      }
      const latest = get()
      const targets = new Set([root, ...latest.expandedDirs])
      await Promise.all([...targets].map((dirPath) => get().loadDirectory(workspaceRoot, dirPath)))
    },

    openFile: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      try {
        withPinnedWorkspaceLocator({ workspaceRoot }, get().pinnedWorkspaceLocator)
      } catch (error) {
        set({ fileError: formatActionError(error), fileLoading: false })
        return
      }
      const saved = await get().flushSave(workspaceRoot)
      if (!saved) return
      if (!isWriteWorkspaceFilePath(path)) {
        set({
          fileLoading: false,
          fileError: i18n.t('common:writeUnsupportedFileType')
        })
        return
      }
      set({ fileLoading: true, fileError: null })
      try {
        if (isWriteImageFilePath(path)) {
          const result = await window.sciforge.readWorkspaceImage(
            withPinnedWorkspaceLocator({ path, workspaceRoot }, get().pinnedWorkspaceLocator)
          )
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          setLastSavedContent('')
          rememberActiveFile(workspaceRoot, result.path)
          set({
            activeFilePath: result.path,
            activeFileKind: 'image',
            fileContent: '',
            imageDataUrl: result.dataUrl,
            imageMimeType: result.mimeType,
            pdfDataBase64: '',
            pdfMimeType: '',
            pdfMtimeMs: 0,
            fileSize: result.size,
            fileTruncated: false,
            fileRevision: null,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            selection: emptySelection(),
            quotedSelections: []
          })
          return
        }

        if (isWritePdfFilePath(path)) {
          const result = await window.sciforge.readWorkspaceFile(
            withPinnedWorkspaceLocator({ path, workspaceRoot }, get().pinnedWorkspaceLocator)
          )
          if (!result.ok) {
            set({ fileLoading: false, fileError: result.message })
            return
          }
          if (result.kind !== 'pdf') {
            set({ fileLoading: false, fileError: i18n.t('common:writeUnsupportedFileType') })
            return
          }
          setLastSavedContent('')
          rememberActiveFile(workspaceRoot, result.path)
          set({
            activeFilePath: result.path,
            activeFileKind: 'pdf',
            fileContent: '',
            imageDataUrl: '',
            imageMimeType: '',
            pdfDataBase64: result.dataBase64,
            pdfMimeType: result.mimeType,
            pdfMtimeMs: result.mtimeMs,
            fileSize: result.size,
            fileTruncated: false,
            fileRevision: result.revision,
            fileLoading: false,
            fileError: null,
            saveStatus: 'saved',
            selection: emptySelection(),
            quotedSelections: []
          })
          return
        }

        const result = await window.sciforge.readWorkspaceFile(
          withPinnedWorkspaceLocator({ path, workspaceRoot }, get().pinnedWorkspaceLocator)
        )
        if (!result.ok) {
          set({ fileLoading: false, fileError: result.message })
          return
        }
        if (result.kind !== 'text') {
          set({ fileLoading: false, fileError: i18n.t('common:writeUnsupportedFileType') })
          return
        }
        setLastSavedContent(result.content)
        rememberActiveFile(workspaceRoot, result.path)
        set({
          activeFilePath: result.path,
          activeFileKind: 'text',
          fileContent: result.content,
          imageDataUrl: '',
          imageMimeType: '',
          pdfDataBase64: '',
          pdfMimeType: '',
          pdfMtimeMs: 0,
          fileSize: result.size,
          fileTruncated: result.truncated,
          fileRevision: result.revision,
          fileLoading: false,
          fileError: null,
          saveStatus: 'saved',
          selection: emptySelection(),
          quotedSelections: []
        })
      } catch (error) {
        set({
          fileLoading: false,
          fileError: isWriteImageFilePath(path)
            ? formatWriteImageLoadError(error)
            : error instanceof Error ? error.message : String(error)
        })
      }
    },

    createFile: async (workspaceRoot, path, content = '') => {
      let result: Awaited<ReturnType<typeof window.sciforge.createWorkspaceFile>>
      try {
        result = await window.sciforge.createWorkspaceFile(
          withPinnedWorkspaceLocator(
            { workspaceRoot, path, content },
            get().pinnedWorkspaceLocator
          )
        )
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      await get().refreshWorkspace(workspaceRoot)
      await get().openFile(workspaceRoot, result.path)
      return result.path
    },

    createDirectory: async (workspaceRoot, path) => {
      let result: Awaited<ReturnType<typeof window.sciforge.createWorkspaceDirectory>>
      try {
        result = await window.sciforge.createWorkspaceDirectory(
          withPinnedWorkspaceLocator({ workspaceRoot, path }, get().pinnedWorkspaceLocator)
        )
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      set((state) => {
        const expandedDirs = new Set(state.expandedDirs)
        expandedDirs.add(writeDirnameFromPath(result.path))
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    renameEntry: async (workspaceRoot, path, newName) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.sciforge.renameWorkspaceEntry>>
      try {
        result = await window.sciforge.renameWorkspaceEntry(
          withPinnedWorkspaceLocator(
            { workspaceRoot, path, newName },
            get().pinnedWorkspaceLocator
          )
        )
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return null
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return null
      }
      const previousPrefix = `${normalizePath(result.previousPath)}/`
      set((state) => {
        const nextActiveFilePath = state.activeFilePath === result.previousPath
          ? result.path
          : state.activeFilePath?.startsWith(previousPrefix)
            ? `${result.path}/${state.activeFilePath.slice(previousPrefix.length)}`
            : state.activeFilePath
        const keepActiveFile = nextActiveFilePath ? isWriteWorkspaceFilePath(nextActiveFilePath) : false
        const nextActiveFileKind = keepActiveFile && nextActiveFilePath
          ? isWriteImageFilePath(nextActiveFilePath) ? 'image' : isWritePdfFilePath(nextActiveFilePath) ? 'pdf' : 'text'
          : null
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          if (dirPath === result.previousPath) {
            expandedDirs.add(result.path)
          } else if (dirPath.startsWith(previousPrefix)) {
            expandedDirs.add(`${result.path}/${dirPath.slice(previousPrefix.length)}`)
          } else {
            expandedDirs.add(dirPath)
          }
        }
        return {
          activeFilePath: keepActiveFile ? nextActiveFilePath ?? null : null,
          activeFileKind: nextActiveFileKind,
          fileContent: nextActiveFileKind === 'text' ? state.fileContent : '',
          imageDataUrl: nextActiveFileKind === 'image' ? state.imageDataUrl : '',
          imageMimeType: nextActiveFileKind === 'image' ? state.imageMimeType : '',
          pdfDataBase64: nextActiveFileKind === 'pdf' ? state.pdfDataBase64 : '',
          pdfMimeType: nextActiveFileKind === 'pdf' ? state.pdfMimeType : '',
          pdfMtimeMs: nextActiveFileKind === 'pdf' ? state.pdfMtimeMs : 0,
          fileSize: keepActiveFile ? state.fileSize : 0,
          fileTruncated: keepActiveFile ? state.fileTruncated : false,
          fileRevision: keepActiveFile ? state.fileRevision : null,
          saveStatus: keepActiveFile ? state.saveStatus : 'saved',
          selection: nextActiveFileKind === 'text' || nextActiveFileKind === 'pdf' ? state.selection : emptySelection(),
          quotedSelections: nextActiveFileKind === 'text' || nextActiveFileKind === 'pdf' ? state.quotedSelections : [],
          expandedDirs,
          entriesByDir: {},
          fileError: null
        }
      })
      if (get().activeFilePath) {
        rememberActiveFile(workspaceRoot, get().activeFilePath)
      } else {
        rememberActiveFile(workspaceRoot, null)
      }
      await get().refreshWorkspace(workspaceRoot)
      return result.path
    },

    deleteEntry: async (workspaceRoot, path) => {
      cancelExternalSyncAnimation()
      let result: Awaited<ReturnType<typeof window.sciforge.deleteWorkspaceEntry>>
      try {
        result = await window.sciforge.deleteWorkspaceEntry(
          withPinnedWorkspaceLocator({ workspaceRoot, path }, get().pinnedWorkspaceLocator)
        )
      } catch (error) {
        set({ fileError: formatActionError(error) })
        return false
      }
      if (!result.ok) {
        set({ fileError: result.message })
        return false
      }
      const deletedPath = normalizePath(result.path)
      const currentActiveFilePath = get().activeFilePath
      const activePath = currentActiveFilePath ? normalizePath(currentActiveFilePath) : ''
      if (activePath === deletedPath || activePath.startsWith(`${deletedPath}/`)) {
        setLastSavedContent('')
        rememberActiveFile(workspaceRoot, null)
        set({
          activeFilePath: null,
          activeFileKind: null,
          fileContent: '',
          imageDataUrl: '',
          imageMimeType: '',
          pdfDataBase64: '',
          pdfMimeType: '',
          pdfMtimeMs: 0,
          fileSize: 0,
          fileTruncated: false,
          fileRevision: null,
          fileError: null,
          saveStatus: 'saved',
          selection: emptySelection(),
          quotedSelections: []
        })
      }
      set((state) => {
        const expandedDirs = new Set<string>()
        for (const dirPath of state.expandedDirs) {
          const normalizedDir = normalizePath(dirPath)
          if (normalizedDir !== deletedPath && !normalizedDir.startsWith(`${deletedPath}/`)) {
            expandedDirs.add(dirPath)
          }
        }
        return { expandedDirs }
      })
      await get().refreshWorkspace(workspaceRoot)
      return true
    }
  }
}
