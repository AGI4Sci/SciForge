import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferenceKind
} from '@shared/agent-runtime-contract'
import type {
  WorkspaceEntryMovePayload,
  WorkspaceFileReadResult
} from '@shared/workspace-file'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  Loader2,
  PanelRightClose,
  PencilLine,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react'
import {
  type FormEvent,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../../agent/registry'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { suggestPdfNameFromWorkspaceRead } from '../../lib/workspace-pdf-auto-rename'
import {
  composerFileReferenceKey,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { composerReferenceFromWorkspaceReference } from '../../lib/workspace-reference-composer'
import type { WorkspaceReferenceGroup } from '../../lib/workspace-reference-groups'
import {
  readWorkspaceReferenceDragPayload,
  writeWorkspaceReferenceDragData,
  type WorkspaceReferenceDragDataSource
} from '../../lib/workspace-reference-drag'

export { composerReferenceFromWorkspaceReference } from '../../lib/workspace-reference-composer'

type Props = {
  workspaceRoot: string
  workspaceGroups?: WorkspaceReferenceGroup[]
  selectedPath?: string | null
  initialDirectory?: FileTreeInitialDirectory | null
  selectedReferences?: ComposerFileReference[]
  className?: string
  onPreviewFile: (reference: AgentRuntimeWorkspaceReference) => void
  onAddReference: (reference: ComposerFileReference) => void
  onCollapse: () => void
}

export type FileTreeInitialDirectory = {
  workspaceRoot: string
  path: string
  nonce: number
}

type DirectoryState = {
  references: AgentRuntimeWorkspaceReference[]
  loading: boolean
  error: string | null
}

type FileTreeContextMenuState = {
  x: number
  y: number
  reference: AgentRuntimeWorkspaceReference | null
  directory: boolean
  expanded: boolean
  targetDirectoryPath: string
}

type FileTreeClipboardState = {
  action: 'copy' | 'cut'
  reference: AgentRuntimeWorkspaceReference
}

type FileTreeRenameDialogState = {
  reference: AgentRuntimeWorkspaceReference
  directory: boolean
  value: string
  submitting: boolean
  error: string | null
  autoSuggested?: boolean
}

type FileTreeCreateDialogState = {
  targetDirectoryPath: string
  directory: boolean
  value: string
  submitting: boolean
  error: string | null
}

export type FileTreeWorkspaceDropAction = 'copy' | 'move'

export type FileTreeWorkspaceDropDecision = {
  action: FileTreeWorkspaceDropAction
  sourcePath: string
  sourceWorkspaceRoot: string
  targetDirectory: string
  targetWorkspaceRoot: string
}

export type FileTreeWorkspaceDragSource = {
  reference: AgentRuntimeWorkspaceReference
  workspaceRoot: string
}

export type FileTreeExternalImportPayload = {
  sourcePaths: string[]
  targetDirectory: string
  targetWorkspaceRoot: string
}

export type FileTreeCopyContentResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'read-error' | 'truncated' | 'unsupported'; message?: string }

const ROOT_PATH = ''
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules'])
const FILE_TREE_CONTEXT_MENU_WIDTH = 206
const FILE_TREE_CONTEXT_MENU_HEIGHT = 356

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function pathKey(value: string): string {
  return normalizePath(value).toLowerCase()
}

export function isPdfWorkspaceReference(reference: AgentRuntimeWorkspaceReference): boolean {
  return reference.kind === 'pdf' ||
    reference.mimeType?.toLocaleLowerCase() === 'application/pdf' ||
    reference.name.toLocaleLowerCase().endsWith('.pdf')
}

function workspaceName(workspaceRoot: string): string {
  return normalizePath(workspaceRoot).split('/').filter(Boolean).at(-1) ?? workspaceRoot
}

function ancestorDirectoryPaths(path: string): string[] {
  const normalized = normalizePath(path)
  if (!normalized) return [ROOT_PATH]
  const segments = normalized.split('/').filter(Boolean)
  return [
    ROOT_PATH,
    ...segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  ]
}

function parentDirectoryPath(path: string): string {
  const normalized = normalizePath(path)
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : ''
}

export function containingFolderPath(relativePath: string, workspaceRoot: string): string {
  return parentDirectoryPath(relativePath) || workspaceRoot.trim()
}

export function renamedRelativePath(path: string, newName: string): string {
  const parent = parentDirectoryPath(path)
  const name = normalizePath(newName).split('/').filter(Boolean).at(-1) ?? newName.trim()
  return parent ? `${parent}/${name}` : name
}

export function workspaceChildPath(parentPath: string, childPath: string): string {
  const parent = normalizePath(parentPath)
  const child = normalizePath(childPath).replace(/^\/+/, '')
  if (!child) return parent
  return parent ? `${parent}/${child}` : child
}

export function rewriteRenamedPath(value: string, previousPath: string, nextPath: string): string {
  const normalized = normalizePath(value)
  const previous = normalizePath(previousPath)
  const next = normalizePath(nextPath)
  if (normalized === previous) return next
  const prefix = `${previous}/`
  return normalized.startsWith(prefix) ? `${next}/${normalized.slice(prefix.length)}` : normalized
}

export function shouldProcessInitialDirectory(
  processedNonce: number | null,
  initialDirectory: FileTreeInitialDirectory | null | undefined
): initialDirectory is FileTreeInitialDirectory {
  return Boolean(initialDirectory && processedNonce !== initialDirectory.nonce)
}

export function fileTreeWorkspaceDropDecision(
  input: {
    source: AgentRuntimeWorkspaceReference
    sourceWorkspaceRoot?: string
    targetDirectory: string
    targetWorkspaceRoot: string
    copyRequested?: boolean
  }
): FileTreeWorkspaceDropDecision | null {
  const sourcePath = normalizePath(input.source.relativePath)
  const targetDirectory = normalizePath(input.targetDirectory)
  const sourceWorkspaceRoot = (input.sourceWorkspaceRoot || input.source.workspaceRoot || '').trim()
  const targetWorkspaceRoot = input.targetWorkspaceRoot.trim()
  if (!sourcePath || !sourceWorkspaceRoot || !targetWorkspaceRoot) return null

  const sameWorkspace = pathKey(sourceWorkspaceRoot) === pathKey(targetWorkspaceRoot)
  if (sameWorkspace && input.source.kind === 'directory') {
    if (pathKey(targetDirectory) === pathKey(sourcePath)) return null
    if (pathKey(targetDirectory).startsWith(`${pathKey(sourcePath)}/`)) return null
  }

  const sourceParent = parentDirectoryPath(sourcePath)
  const action: FileTreeWorkspaceDropAction = input.copyRequested || !sameWorkspace ? 'copy' : 'move'
  if (action === 'move' && sameWorkspace && pathKey(sourceParent) === pathKey(targetDirectory)) return null

  return {
    action,
    sourcePath,
    sourceWorkspaceRoot,
    targetDirectory,
    targetWorkspaceRoot
  }
}

export function fileTreeWorkspaceDropDecisionFromDragData(
  source: WorkspaceReferenceDragDataSource,
  input: {
    targetDirectory: string
    targetWorkspaceRoot: string
    copyRequested?: boolean
  }
): FileTreeWorkspaceDropDecision | null {
  const payload = readWorkspaceReferenceDragPayload(source)
  if (!payload) return null
  return fileTreeWorkspaceDropDecision({
    source: payload.reference,
    sourceWorkspaceRoot: payload.workspaceRoot,
    targetDirectory: input.targetDirectory,
    targetWorkspaceRoot: input.targetWorkspaceRoot,
    copyRequested: input.copyRequested
  })
}

export function fileTreeWorkspaceDropDecisionForDrag(
  internalSource: FileTreeWorkspaceDragSource | null,
  dragData: WorkspaceReferenceDragDataSource,
  input: {
    targetDirectory: string
    targetWorkspaceRoot: string
    copyRequested?: boolean
  }
): FileTreeWorkspaceDropDecision | null {
  if (internalSource) {
    return fileTreeWorkspaceDropDecision({
      source: internalSource.reference,
      sourceWorkspaceRoot: internalSource.workspaceRoot,
      ...input
    })
  }
  return fileTreeWorkspaceDropDecisionFromDragData(dragData, input)
}

export function fileTreeWorkspaceDropPayload(
  decision: FileTreeWorkspaceDropDecision
): WorkspaceEntryMovePayload {
  return {
    sourcePath: decision.sourcePath,
    sourceWorkspaceRoot: decision.sourceWorkspaceRoot,
    targetDirectory: decision.targetDirectory,
    targetWorkspaceRoot: decision.targetWorkspaceRoot
  }
}

export function fileTreeExternalImportPayload(
  input: {
    files: ArrayLike<File> | null | undefined
    getPathForFile: (file: File) => string
    targetDirectory: string
    targetWorkspaceRoot: string
  }
): FileTreeExternalImportPayload | null {
  const sourcePaths: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < (input.files?.length ?? 0); index += 1) {
    const file = input.files?.[index]
    if (!file) continue
    let sourcePath = ''
    try {
      sourcePath = input.getPathForFile(file).trim()
    } catch {
      sourcePath = ''
    }
    if (!sourcePath || seen.has(sourcePath)) continue
    seen.add(sourcePath)
    sourcePaths.push(sourcePath)
  }
  if (sourcePaths.length === 0 || !input.targetWorkspaceRoot.trim()) return null
  return {
    sourcePaths,
    targetDirectory: normalizePath(input.targetDirectory),
    targetWorkspaceRoot: input.targetWorkspaceRoot.trim()
  }
}

export function fileTreeCopyContentFromReadResult(
  result: WorkspaceFileReadResult
): FileTreeCopyContentResult {
  if (!result.ok) {
    return { ok: false, reason: 'read-error', message: result.message }
  }
  if (result.kind === 'text') {
    if (result.truncated) return { ok: false, reason: 'truncated' }
    return { ok: true, content: result.content }
  }
  if (result.kind === 'docx') {
    return { ok: true, content: result.content }
  }
  return { ok: false, reason: 'unsupported' }
}

function fileTreeCopyContentErrorKey(reason: Exclude<FileTreeCopyContentResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'read-error':
      return 'fileTreeCopyContentReadError'
    case 'truncated':
      return 'fileTreeCopyContentTruncated'
    case 'unsupported':
      return 'fileTreeCopyContentUnsupported'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function referenceIcon(kind: AgentRuntimeWorkspaceReferenceKind, expanded: boolean): ReactElement {
  if (kind === 'directory') {
    return expanded
      ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
      : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
  }
  if (kind === 'image') {
    return <Image className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
}

export function ChatFileTreePanel({
  workspaceRoot,
  workspaceGroups,
  selectedPath,
  initialDirectory,
  selectedReferences = [],
  className,
  onPreviewFile,
  onAddReference,
  onCollapse
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const groups = useMemo(
    () => normalizeWorkspaceGroups(workspaceRoot, workspaceGroups),
    [workspaceGroups, workspaceRoot]
  )
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id ?? '')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_PATH]))
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [focusedDirectoryPath, setFocusedDirectoryPath] = useState('')
  const [pendingScrollPath, setPendingScrollPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null)
  const [createDialog, setCreateDialog] = useState<FileTreeCreateDialogState | null>(null)
  const [renameDialog, setRenameDialog] = useState<FileTreeRenameDialogState | null>(null)
  const [suggestingPdfPath, setSuggestingPdfPath] = useState<string | null>(null)
  const [fileClipboard, setFileClipboard] = useState<FileTreeClipboardState | null>(null)
  const [dragTargetDirectoryPath, setDragTargetDirectoryPath] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const processedInitialDirectoryNonceRef = useRef<number | null>(null)
  const internalDragSourceRef = useRef<FileTreeWorkspaceDragSource | null>(null)
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const root = selectedGroup?.workspaceRoot.trim() ?? ''
  const rootKey = useMemo(() => pathKey(root), [root])
  const activeRootKeyRef = useRef(rootKey)
  activeRootKeyRef.current = rootKey
  const selectedKey = useMemo(() => pathKey(selectedPath ?? ''), [selectedPath])
  const focusedDirectoryKey = useMemo(() => pathKey(focusedDirectoryPath), [focusedDirectoryPath])
  const selectedReferenceKeys = useMemo(
    () => new Set(selectedReferences.map(composerFileReferenceKey)),
    [selectedReferences]
  )

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedGroupId) setSelectedGroupId('')
      return
    }
    if (!groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? '')
    }
  }, [groups, selectedGroupId])

  useEffect(() => {
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
    setContextMenu(null)
    setCreateDialog(null)
    setDragTargetDirectoryPath(null)
  }, [root])

  useEffect(() => {
    if (!shouldProcessInitialDirectory(processedInitialDirectoryNonceRef.current, initialDirectory)) return
    const nextRoot = normalizePath(initialDirectory.workspaceRoot)
    const nextPath = normalizePath(initialDirectory.path)
    const matchingGroup = groups.find((group) => pathKey(group.workspaceRoot) === pathKey(nextRoot))
    if (nextRoot && !matchingGroup) return
    processedInitialDirectoryNonceRef.current = initialDirectory.nonce
    if (matchingGroup) setSelectedGroupId((current) => current === matchingGroup.id ? current : matchingGroup.id)
    setFocusedDirectoryPath(nextPath)
    setPendingScrollPath(nextPath)
    setExpanded((current) => {
      const next = new Set(current)
      for (const path of ancestorDirectoryPaths(nextPath)) next.add(path)
      return next
    })
  }, [groups, initialDirectory])

  const loadDirectory = useCallback((path: string): void => {
    if (!root) return
    const requestRoot = root
    const requestRootKey = rootKey
    const provider = getProvider()
    if (!provider.listWorkspaceReferences) {
      setDirectories((current) => ({
        ...current,
        [path || ROOT_PATH]: {
          references: [],
          loading: false,
          error: t('workspaceReferenceUnavailable')
        }
      }))
      return
    }
    const key = path || ROOT_PATH
    setDirectories((current) => ({
      ...current,
      [key]: {
        references: current[key]?.references ?? [],
        loading: true,
        error: null
      }
    }))
    void provider.listWorkspaceReferences({
        workspaceRoot: requestRoot,
        ...(path ? { path } : {})
      })
      .then((result) => {
        if (activeRootKeyRef.current !== requestRootKey) return
        setDirectories((current) => ({
          ...current,
          [key]: result?.ok
            ? {
                references: result.references,
                loading: false,
                error: null
              }
            : {
                references: [],
                loading: false,
                error: result?.message ?? t('workspaceReferenceUnavailable')
              }
        }))
      })
      .catch((error) => {
        if (activeRootKeyRef.current !== requestRootKey) return
        setDirectories((current) => ({
          ...current,
          [key]: {
            references: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      })
  }, [root, rootKey, t])

  useEffect(() => {
    for (const path of expanded) {
      if (!directories[path || ROOT_PATH]) loadDirectory(path)
    }
  }, [directories, expanded, loadDirectory])

  const toggleDirectory = (path: string): void => {
    setFocusedDirectoryPath(normalizePath(path))
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    reference: AgentRuntimeWorkspaceReference,
    directory: boolean,
    expandedDirectory: boolean
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (directory) setFocusedDirectoryPath(normalizePath(reference.relativePath))
    setContextMenu({
      x: clamp(event.clientX, 8, window.innerWidth - FILE_TREE_CONTEXT_MENU_WIDTH - 8),
      y: clamp(event.clientY, 8, window.innerHeight - FILE_TREE_CONTEXT_MENU_HEIGHT - 8),
      reference,
      directory,
      expanded: expandedDirectory,
      targetDirectoryPath: directory
        ? normalizePath(reference.relativePath)
        : parentDirectoryPath(reference.relativePath)
    })
  }

  const openWorkspaceContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null
    if (target?.closest('[data-file-tree-path]')) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: clamp(event.clientX, 8, window.innerWidth - FILE_TREE_CONTEXT_MENU_WIDTH - 8),
      y: clamp(event.clientY, 8, window.innerHeight - FILE_TREE_CONTEXT_MENU_HEIGHT - 8),
      reference: null,
      directory: true,
      expanded: true,
      targetDirectoryPath: ROOT_PATH
    })
  }

  const startReferenceDrag = (
    event: ReactDragEvent<HTMLDivElement>,
    reference: AgentRuntimeWorkspaceReference
  ): void => {
    const sourceWorkspaceRoot = reference.workspaceRoot || root
    internalDragSourceRef.current = {
      reference,
      workspaceRoot: sourceWorkspaceRoot
    }
    writeWorkspaceReferenceDragData(event.dataTransfer, reference, sourceWorkspaceRoot)
  }

  const workspaceDropDecisionForEvent = (
    event: ReactDragEvent<HTMLElement>,
    targetDirectoryPath: string
  ): FileTreeWorkspaceDropDecision | null => fileTreeWorkspaceDropDecisionForDrag(
    internalDragSourceRef.current,
    event.dataTransfer,
    {
    targetDirectory: targetDirectoryPath,
    targetWorkspaceRoot: root,
    copyRequested: event.altKey
    }
  )

  const handleWorkspaceReferenceDragOver = (
    event: ReactDragEvent<HTMLElement>,
    targetDirectoryPath: string
  ): void => {
    const decision = workspaceDropDecisionForEvent(event, targetDirectoryPath)
    if (!decision && !Array.from(event.dataTransfer.types ?? []).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = decision?.action === 'move' ? 'move' : 'copy'
    setDragTargetDirectoryPath(decision?.targetDirectory ?? normalizePath(targetDirectoryPath))
  }

  const handleWorkspaceReferenceDrop = (
    event: ReactDragEvent<HTMLElement>,
    targetDirectoryPath: string
  ): void => {
    const decision = workspaceDropDecisionForEvent(event, targetDirectoryPath)
    const importPayload = decision ? null : fileTreeExternalImportPayload({
      files: event.dataTransfer.files,
      getPathForFile: (file) => window.sciforge.getPathForFile(file),
      targetDirectory: targetDirectoryPath,
      targetWorkspaceRoot: root
    })
    if (!decision && !importPayload) return
    event.preventDefault()
    event.stopPropagation()
    setDragTargetDirectoryPath(null)
    internalDragSourceRef.current = null
    void (async () => {
      try {
        if (decision) {
          const payload = fileTreeWorkspaceDropPayload(decision)
          const result = decision.action === 'copy'
            ? await window.sciforge.copyWorkspaceEntry(payload)
            : await window.sciforge.moveWorkspaceEntry(payload)
          if (!result.ok) {
            window.alert(result.message)
            return
          }
          reloadDirectory(decision.targetDirectory)
          return
        }
        if (!importPayload) return
        const result = await window.sciforge.importWorkspaceEntries(importPayload)
        if (!result.ok) {
          window.alert(result.message)
          return
        }
        reloadDirectory(importPayload.targetDirectory)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const clearWorkspaceReferenceDragTarget = (event: ReactDragEvent<HTMLElement>): void => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setDragTargetDirectoryPath(null)
  }

  const handleRootWorkspaceReferenceDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null
    if (target?.closest('[data-file-tree-path]')) return
    handleWorkspaceReferenceDragOver(event, ROOT_PATH)
  }

  const handleRootWorkspaceReferenceDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null
    if (target?.closest('[data-file-tree-path]')) return
    handleWorkspaceReferenceDrop(event, ROOT_PATH)
  }

  useEffect(() => {
    if (pendingScrollPath === null) return
    const container = scrollContainerRef.current
    if (!container) return
    if (!pendingScrollPath) {
      container.scrollTo({ top: 0 })
      setPendingScrollPath(null)
      return
    }
    const row = Array.from(container.querySelectorAll<HTMLElement>('[data-file-tree-path]'))
      .find((element) => element.dataset.fileTreePath === pendingScrollPath)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    setPendingScrollPath(null)
  }, [directories, expanded, pendingScrollPath, root])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])

  const addReference = (reference: AgentRuntimeWorkspaceReference): void => {
    onAddReference(composerReferenceFromWorkspaceReference(reference))
  }

  const copyReferencePath = async (reference: AgentRuntimeWorkspaceReference): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(reference.relativePath)
  }

  const copyReferenceContent = async (reference: AgentRuntimeWorkspaceReference): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    try {
      const result = await window.sciforge.readWorkspaceFile({
        path: reference.relativePath,
        workspaceRoot: reference.workspaceRoot || root
      })
      const copyContent = fileTreeCopyContentFromReadResult(result)
      if (!copyContent.ok) {
        window.alert(copyContent.message ?? t(fileTreeCopyContentErrorKey(copyContent.reason)))
        return
      }
      await navigator.clipboard.writeText(copyContent.content)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const openRenameDialog = (reference: AgentRuntimeWorkspaceReference, directory: boolean): void => {
    setRenameDialog({
      reference,
      directory,
      value: reference.name || normalizePath(reference.relativePath).split('/').at(-1) || '',
      submitting: false,
      error: null
    })
  }

  const suggestPdfRename = async (reference: AgentRuntimeWorkspaceReference): Promise<void> => {
    if (suggestingPdfPath) return
    const referencePath = normalizePath(reference.relativePath)
    const referenceRoot = reference.workspaceRoot || root
    setSuggestingPdfPath(referencePath)
    try {
      let result: Awaited<ReturnType<typeof window.sciforge.suggestWorkspacePdfName>> | undefined
      if (typeof window.sciforge.suggestWorkspacePdfName === 'function') {
        try {
          result = await window.sciforge.suggestWorkspacePdfName({
            path: referencePath,
            workspaceRoot: referenceRoot
          })
        } catch {
          result = undefined
        }
      }
      if (!result) {
        const readResult = await window.sciforge.readWorkspaceFile({
          path: referencePath,
          workspaceRoot: referenceRoot
        })
        result = await suggestPdfNameFromWorkspaceRead(readResult, reference.name)
      }
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      setRenameDialog({
        reference,
        directory: false,
        value: result.suggestedName,
        submitting: false,
        error: null,
        autoSuggested: true
      })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSuggestingPdfPath(null)
    }
  }

  const openReferenceInEditor = (reference: AgentRuntimeWorkspaceReference): void => {
    void openWorkspacePathInEditor(
      { path: reference.relativePath },
      reference.workspaceRoot || root
    ).then((result) => {
      if (!result.ok) {
        void window.sciforge?.logError?.('editor-open', 'Failed to open workspace file tree item', {
          message: result.message,
          target: reference
        })?.catch(() => undefined)
      }
    })
  }

  const openReferenceContainingFolder = (reference: AgentRuntimeWorkspaceReference): void => {
    const referenceRoot = reference.workspaceRoot || root
    void openWorkspacePathInEditor(
      { path: containingFolderPath(reference.relativePath, referenceRoot) },
      referenceRoot,
      { editorId: 'system' }
    ).then((result) => {
      if (!result.ok) {
        void window.sciforge?.logError?.('folder-open', 'Failed to open containing folder for workspace file tree item', {
          message: result.message,
          target: reference
        })?.catch(() => undefined)
      }
    })
  }

  const reloadDirectory = (path: string): void => {
    const normalized = normalizePath(path)
    setFocusedDirectoryPath(normalized)
    setPendingScrollPath(normalized)
    setExpanded((current) => {
      const next = new Set(current)
      for (const item of ancestorDirectoryPaths(normalized)) next.add(item)
      return next
    })
    setDirectories({})
  }

  const pasteClipboardEntry = async (targetDirectoryPath: string): Promise<void> => {
    const targetDirectory = normalizePath(targetDirectoryPath)
    if (!fileClipboard) {
      try {
        const result = await window.sciforge.pasteWorkspaceClipboard({
          workspaceRoot: root,
          targetDirectory
        })
        if (!result.ok) {
          window.alert(result.message)
          return
        }
        reloadDirectory(targetDirectory)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error))
      }
      return
    }
    const payload = {
      sourcePath: fileClipboard.reference.relativePath,
      sourceWorkspaceRoot: fileClipboard.reference.workspaceRoot || root,
      targetDirectory,
      targetWorkspaceRoot: root
    }
    try {
      const result = fileClipboard.action === 'cut'
        ? await window.sciforge.moveWorkspaceEntry(payload)
        : await window.sciforge.copyWorkspaceEntry(payload)
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      if (fileClipboard.action === 'cut') setFileClipboard(null)
      reloadDirectory(payload.targetDirectory)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const createWorkspaceEntry = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!createDialog || createDialog.submitting) return
    const name = createDialog.value.trim()
    if (!name) return
    const targetDirectory = normalizePath(createDialog.targetDirectoryPath)
    const path = workspaceChildPath(targetDirectory, name)
    const directory = createDialog.directory
    setCreateDialog((current) => current ? { ...current, submitting: true, error: null } : current)
    try {
      const result = directory
        ? await window.sciforge.createWorkspaceDirectory({ workspaceRoot: root, path })
        : await window.sciforge.createWorkspaceFile({ workspaceRoot: root, path, content: '' })
      if (!result.ok) {
        setCreateDialog((current) => current
          ? { ...current, submitting: false, error: result.message }
          : current)
        return
      }
      setCreateDialog(null)
      reloadDirectory(targetDirectory)
    } catch (error) {
      setCreateDialog((current) => current
        ? {
            ...current,
            submitting: false,
            error: error instanceof Error ? error.message : String(error)
          }
        : current)
    }
  }

  const uploadWorkspaceFile = async (targetDirectoryPath: string): Promise<void> => {
    const targetDirectory = normalizePath(targetDirectoryPath)
    try {
      const selection = await window.sciforge.pickFile({
        title: t('fileTreeUploadFile'),
        defaultPath: workspaceChildPath(root, targetDirectory),
        filters: [{ name: t('fileTreeAllFiles'), extensions: ['*'] }]
      })
      if (selection.canceled || !selection.path) return
      const result = await window.sciforge.importWorkspaceEntries({
        sourcePaths: [selection.path],
        targetDirectory,
        targetWorkspaceRoot: root
      })
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      reloadDirectory(targetDirectory)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const openWorkspaceDirectoryInFileManager = (targetDirectoryPath: string): void => {
    const targetDirectory = normalizePath(targetDirectoryPath)
    void openWorkspacePathInEditor(
      { path: targetDirectory || root },
      root,
      { editorId: 'system' }
    ).then((result) => {
      if (!result.ok) window.alert(result.message)
    })
  }

  const deleteReference = async (reference: AgentRuntimeWorkspaceReference, directory: boolean): Promise<void> => {
    const confirmKey = directory ? 'writeDeleteFolderConfirm' : 'writeDeleteFileConfirm'
    if (!window.confirm(t(confirmKey, { name: reference.name || reference.relativePath }))) return
    try {
      const result = await window.sciforge.deleteWorkspaceEntry({
        path: reference.relativePath,
        workspaceRoot: reference.workspaceRoot || root
      })
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      if (
        fileClipboard &&
        pathKey(fileClipboard.reference.workspaceRoot) === pathKey(reference.workspaceRoot) &&
        pathKey(fileClipboard.reference.relativePath) === pathKey(reference.relativePath)
      ) {
        setFileClipboard(null)
      }
      reloadDirectory(parentDirectoryPath(reference.relativePath))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const renameReference = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!renameDialog || renameDialog.submitting) return
    const newName = renameDialog.value.trim()
    if (!newName || newName === renameDialog.reference.name) {
      setRenameDialog(null)
      return
    }
    const reference = renameDialog.reference
    const previousPath = normalizePath(reference.relativePath)
    const nextPath = renamedRelativePath(previousPath, newName)
    setRenameDialog((current) => current ? { ...current, submitting: true, error: null } : current)
    try {
      const result = await window.sciforge.renameWorkspaceEntry({
        path: previousPath,
        workspaceRoot: reference.workspaceRoot || root,
        newName
      })
      if (!result.ok) {
        setRenameDialog((current) => current ? { ...current, submitting: false, error: result.message } : current)
        return
      }
      const renamedReference: AgentRuntimeWorkspaceReference = {
        ...reference,
        name: newName,
        relativePath: nextPath
      }
      setExpanded((current) => {
        const next = new Set<string>()
        for (const path of current) {
          next.add(rewriteRenamedPath(path, previousPath, nextPath))
        }
        return next
      })
      setFocusedDirectoryPath((current) => rewriteRenamedPath(current, previousPath, nextPath))
      setPendingScrollPath(nextPath)
      setFileClipboard((current) => {
        if (!current) return current
        if (pathKey(current.reference.workspaceRoot || root) !== pathKey(reference.workspaceRoot || root)) return current
        const rewritten = rewriteRenamedPath(current.reference.relativePath, previousPath, nextPath)
        return rewritten === current.reference.relativePath
          ? current
          : {
              ...current,
              reference: {
                ...current.reference,
                relativePath: rewritten,
                ...(pathKey(current.reference.relativePath) === pathKey(previousPath) ? { name: newName } : {})
              }
            }
      })
      setRenameDialog(null)
      setDirectories({})
      if (!renameDialog.directory && selectedKey === pathKey(previousPath)) {
        onPreviewFile(renamedReference)
      }
    } catch (error) {
      setRenameDialog((current) => current
        ? { ...current, submitting: false, error: error instanceof Error ? error.message : String(error) }
        : current)
    }
  }

  const refresh = (): void => {
    setContextMenu(null)
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
  }

  const renderDirectory = (path: string, depth: number): ReactElement[] => {
    const state = directories[path || ROOT_PATH]
    if (state?.loading && state.references.length === 0) {
      return [
        <div
          key={`${path || 'root'}-loading`}
          className="flex min-h-9 items-center gap-2 px-2.5 text-[12px] text-ds-muted"
          style={{ paddingLeft: depth * 14 + 10 }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {t('fileTreeLoading')}
        </div>
      ]
    }
    if (state?.error) {
      return [
        <div
          key={`${path || 'root'}-error`}
          className="px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300"
          style={{ paddingLeft: depth * 14 + 10 }}
          title={state.error}
        >
          {state.error}
        </div>
      ]
    }
    if (!state?.references.length) {
      return depth === 0
        ? [
            <div key="empty" className="px-3 py-3 text-[12px] text-ds-muted">
              {t('fileTreeEmpty')}
            </div>
          ]
        : []
    }

    return state.references
      .filter((reference) =>
        reference.kind !== 'directory' || !IGNORED_DIRECTORY_NAMES.has(reference.name.toLowerCase())
      )
      .flatMap((reference) => {
        const directory = reference.kind === 'directory'
        const expandedDirectory = directory && expanded.has(reference.relativePath)
        const previewable = !directory
        const active = previewable && selectedKey === pathKey(reference.relativePath)
        const directoryFocused = directory && focusedDirectoryKey === pathKey(reference.relativePath)
        const contextActive = contextMenu?.reference
          ? pathKey(contextMenu.reference.relativePath) === pathKey(reference.relativePath)
          : false
        const referenceKey = composerFileReferenceKey({
          relativePath: reference.relativePath,
          workspaceRoot: reference.workspaceRoot
        })
        const selected = selectedReferenceKeys.has(referenceKey)
        const pdf = !directory && isPdfWorkspaceReference(reference)
        const suggestingPdfName = pdf && pathKey(suggestingPdfPath ?? '') === pathKey(reference.relativePath)
        const dragTarget = directory && pathKey(dragTargetDirectoryPath ?? '') === pathKey(reference.relativePath)
        const row = (
          <div
            key={reference.relativePath}
            data-file-tree-path={normalizePath(reference.relativePath)}
            data-workspace-reference-draggable="true"
            data-workspace-reference-drop-target={dragTarget ? 'true' : undefined}
            draggable
            className={`group flex min-h-8 items-center gap-1 px-1.5 pr-2 text-[12.5px] ${
              active || directoryFocused || contextActive || dragTarget ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
            }`}
            style={{ paddingLeft: depth * 14 + 6 }}
            title={reference.relativePath || reference.name}
            onContextMenu={(event) => openContextMenu(event, reference, directory, expandedDirectory)}
            onDragStart={(event) => startReferenceDrag(event, reference)}
            onDragEnd={() => {
              internalDragSourceRef.current = null
              setDragTargetDirectoryPath(null)
            }}
            onDragOver={directory ? (event) => handleWorkspaceReferenceDragOver(event, reference.relativePath) : undefined}
            onDrop={directory ? (event) => handleWorkspaceReferenceDrop(event, reference.relativePath) : undefined}
            onDragLeave={directory ? clearWorkspaceReferenceDragTarget : undefined}
          >
            <button
              type="button"
              onClick={() => {
                if (directory) {
                  toggleDirectory(reference.relativePath)
                  return
                }
                if (previewable) onPreviewFile(reference)
              }}
              className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left ${previewable || directory ? '' : 'cursor-default'}`}
            >
              {directory ? (
                expandedDirectory ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                )
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" />
              )}
              {referenceIcon(reference.kind, expandedDirectory)}
              <span className="min-w-0 flex-1 truncate">{reference.name}</span>
            </button>
            {pdf ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void suggestPdfRename(reference)
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-card hover:text-accent disabled:cursor-wait disabled:opacity-60"
                disabled={Boolean(suggestingPdfPath)}
                title={t('fileTreeAutoRenamePdf')}
                aria-label={t('fileTreeAutoRenamePdf')}
              >
                {suggestingPdfName
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                  : <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => addReference(reference)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-card hover:text-ds-ink disabled:cursor-default disabled:opacity-70"
              disabled={selected}
              title={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
              aria-label={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
            >
              {selected ? <Check className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
            </button>
          </div>
        )
        return directory && expandedDirectory
          ? [row, ...renderDirectory(reference.relativePath, depth + 1)]
          : [row]
      })
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-ds-main ${className ?? ''}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
        <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ds-ink">
            {t('workspaceFilesTitle')}
          </div>
          <div className="truncate text-[11px] text-ds-faint" title={root}>
            {root ? selectedGroup?.label ?? workspaceName(root) : t('workspaceRequiredToCreateThread')}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!root}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          title={t('workspaceReferenceRefresh')}
          aria-label={t('workspaceReferenceRefresh')}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          title={t('rightPanelCollapse')}
          aria-label={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
      </div>
      {groups.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ds-border-muted px-2 py-2">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedGroupId(group.id)}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                group.id === selectedGroup?.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-ds-border-muted bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
              title={group.workspaceRoot}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto py-1"
        data-workspace-root-drop-target={dragTargetDirectoryPath === ROOT_PATH ? 'true' : undefined}
        onContextMenu={openWorkspaceContextMenu}
        onDragOver={handleRootWorkspaceReferenceDragOver}
        onDrop={handleRootWorkspaceReferenceDrop}
        onDragLeave={clearWorkspaceReferenceDragTarget}
      >
        {root ? renderDirectory(ROOT_PATH, 0) : (
          <div className="px-3 py-3 text-[12px] leading-5 text-ds-muted">
            {t('workspaceRequiredToCreateThread')}
          </div>
        )}
      </div>
      {contextMenu ? (
        <FileTreeContextMenu
          state={contextMenu}
          selected={contextMenu.reference
            ? selectedReferenceKeys.has(composerFileReferenceKey({
                relativePath: contextMenu.reference.relativePath,
                workspaceRoot: contextMenu.reference.workspaceRoot
              }))
            : false}
          canPaste={Boolean(fileClipboard) || Boolean(root)}
          onClose={() => setContextMenu(null)}
          onCreateFile={() => setCreateDialog({
            targetDirectoryPath: contextMenu.targetDirectoryPath,
            directory: false,
            value: '',
            submitting: false,
            error: null
          })}
          onCreateDirectory={() => setCreateDialog({
            targetDirectoryPath: contextMenu.targetDirectoryPath,
            directory: true,
            value: '',
            submitting: false,
            error: null
          })}
          onPreview={() => {
            if (contextMenu.reference) onPreviewFile(contextMenu.reference)
          }}
          onToggleDirectory={() => {
            if (contextMenu.reference) toggleDirectory(contextMenu.reference.relativePath)
          }}
          onAddReference={() => {
            if (contextMenu.reference) addReference(contextMenu.reference)
          }}
          onOpenEditor={() => {
            if (contextMenu.reference) openReferenceInEditor(contextMenu.reference)
          }}
          onOpenContainingFolder={() => {
            if (contextMenu.reference) openReferenceContainingFolder(contextMenu.reference)
          }}
          onCopyEntry={() => {
            if (contextMenu.reference) setFileClipboard({ action: 'copy', reference: contextMenu.reference })
          }}
          onCutEntry={() => {
            if (contextMenu.reference) setFileClipboard({ action: 'cut', reference: contextMenu.reference })
          }}
          onRename={() => {
            if (contextMenu.reference) openRenameDialog(contextMenu.reference, contextMenu.directory)
          }}
          onPaste={() => void pasteClipboardEntry(contextMenu.targetDirectoryPath)}
          onDelete={() => {
            if (contextMenu.reference) void deleteReference(contextMenu.reference, contextMenu.directory)
          }}
          onCopyPath={() => {
            if (contextMenu.reference) void copyReferencePath(contextMenu.reference)
          }}
          onCopyContent={() => {
            if (contextMenu.reference) void copyReferenceContent(contextMenu.reference)
          }}
          onUpload={() => void uploadWorkspaceFile(contextMenu.targetDirectoryPath)}
          onOpenDirectoryInFileManager={() =>
            openWorkspaceDirectoryInFileManager(contextMenu.targetDirectoryPath)}
          onRefresh={refresh}
          t={t}
        />
      ) : null}
      {createDialog ? (
        <FileTreeCreateDialog
          state={createDialog}
          onClose={() => setCreateDialog(null)}
          onValueChange={(value) => setCreateDialog((current) =>
            current ? { ...current, value, error: null } : current
          )}
          onSubmit={createWorkspaceEntry}
          t={t}
        />
      ) : null}
      {renameDialog ? (
        <FileTreeRenameDialog
          state={renameDialog}
          onClose={() => setRenameDialog(null)}
          onValueChange={(value) => setRenameDialog((current) =>
            current ? { ...current, value, error: null } : current
          )}
          onSubmit={renameReference}
          t={t}
        />
      ) : null}
    </aside>
  )
}

function FileTreeContextMenu({
  state,
  selected,
  canPaste,
  onClose,
  onCreateFile,
  onCreateDirectory,
  onPreview,
  onToggleDirectory,
  onAddReference,
  onOpenEditor,
  onOpenContainingFolder,
  onCopyEntry,
  onCutEntry,
  onRename,
  onPaste,
  onDelete,
  onCopyPath,
  onCopyContent,
  onUpload,
  onOpenDirectoryInFileManager,
  onRefresh,
  t
}: {
  state: FileTreeContextMenuState
  selected: boolean
  canPaste: boolean
  onClose: () => void
  onCreateFile: () => void
  onCreateDirectory: () => void
  onPreview: () => void
  onToggleDirectory: () => void
  onAddReference: () => void
  onOpenEditor: () => void
  onOpenContainingFolder: () => void
  onCopyEntry: () => void
  onCutEntry: () => void
  onRename: () => void
  onPaste: () => void
  onDelete: () => void
  onCopyPath: () => void
  onCopyContent: () => void
  onUpload: () => void
  onOpenDirectoryInFileManager: () => void
  onRefresh: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      role="menu"
      aria-label={state.reference?.relativePath || state.reference?.name || t('workspaceFilesTitle')}
      className="ds-no-drag fixed z-50 min-w-[206px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_16px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {state.reference ? (
        <>
          {state.directory ? (
            <FileTreeContextMenuItem
              icon={state.expanded
                ? <Folder className="h-3.5 w-3.5" strokeWidth={1.8} />
                : <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={state.expanded ? t('fileTreeCollapse') : t('fileTreeExpand')}
              onClick={() => run(onToggleDirectory)}
            />
          ) : (
            <FileTreeContextMenuItem
              icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('fileTreePreview')}
              onClick={() => run(onPreview)}
            />
          )}
          <FileTreeContextMenuItem
            icon={selected
              ? <Check className="h-3.5 w-3.5" strokeWidth={1.9} />
              : <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
            label={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
            disabled={selected}
            onClick={() => run(onAddReference)}
          />
          <div className="my-1 h-px bg-ds-border-muted" />
          <FileTreeContextMenuItem
            icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('windowsMenuCopy')}
            onClick={() => run(onCopyEntry)}
          />
          <FileTreeContextMenuItem
            icon={<Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('windowsMenuCut')}
            onClick={() => run(onCutEntry)}
          />
          <FileTreeContextMenuItem
            icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('writeRenameEntry')}
            onClick={() => run(onRename)}
          />
        </>
      ) : (
        <>
          <FileTreeContextMenuItem
            icon={<FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('writeCreateFile')}
            onClick={() => run(onCreateFile)}
          />
          <FileTreeContextMenuItem
            icon={<FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('writeCreateFolder')}
            onClick={() => run(onCreateDirectory)}
          />
        </>
      )}
      <FileTreeContextMenuItem
        icon={<ClipboardPaste className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('windowsMenuPaste')}
        disabled={!canPaste}
        onClick={() => run(onPaste)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      {state.reference ? (
        <>
          <FileTreeContextMenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('filePreviewOpenEditor')}
            onClick={() => run(onOpenEditor)}
          />
          <FileTreeContextMenuItem
            icon={<FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('filePreviewOpenContainingFolder')}
            onClick={() => run(onOpenContainingFolder)}
          />
          <FileTreeContextMenuItem
            icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('filePreviewCopyPath')}
            onClick={() => run(onCopyPath)}
          />
          {!state.directory ? (
            <FileTreeContextMenuItem
              icon={<FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('fileTreeCopyContent')}
              onClick={() => run(onCopyContent)}
            />
          ) : null}
          <div className="my-1 h-px bg-ds-border-muted" />
          <FileTreeContextMenuItem
            icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={state.directory ? t('writeDeleteFolder') : t('writeDeleteFile')}
            danger
            onClick={() => run(onDelete)}
          />
        </>
      ) : (
        <>
          <FileTreeContextMenuItem
            icon={<Upload className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('fileTreeUploadFile')}
            onClick={() => run(onUpload)}
          />
          <FileTreeContextMenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('workspaceReferenceRefresh')}
            onClick={() => run(onRefresh)}
          />
          <FileTreeContextMenuItem
            icon={<FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('fileTreeOpenInFileManager')}
            onClick={() => run(onOpenDirectoryInFileManager)}
          />
        </>
      )}
    </div>
  )
}

function FileTreeCreateDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: FileTreeCreateDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const title = t(state.directory ? 'writeCreateFolder' : 'writeCreateFile')
  const prompt = t(state.directory ? 'writeCreateFolderPrompt' : 'writeCreateFilePrompt')
  const canSubmit = Boolean(state.value.trim()) && !state.submitting

  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-tree-create-dialog-title"
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <h2
          id="file-tree-create-dialog-title"
          className="text-[18px] font-semibold text-ds-ink"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {prompt}
        </p>
        <input
          autoFocus
          aria-label={prompt}
          disabled={state.submitting}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-wait disabled:opacity-70"
        />
        {state.error ? (
          <p className="mt-3 text-[12px] leading-5 text-red-600 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {state.submitting ? t('loading') : t('writeEntryDialogCreate')}
          </button>
        </div>
      </form>
    </div>
  )
}

function FileTreeRenameDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: FileTreeRenameDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const nextName = state.value.trim()
  const unchanged = nextName === state.reference.name
  const canSubmit = Boolean(nextName) && !unchanged && !state.submitting

  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-tree-rename-dialog-title"
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <h2
          id="file-tree-rename-dialog-title"
          className="text-[18px] font-semibold text-ds-ink"
        >
          {t('writeRenameEntry')}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('writeRenameEntryPrompt')}
        </p>
        <input
          autoFocus
          aria-label={t('writeRenameEntryPrompt')}
          disabled={state.submitting}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-wait disabled:opacity-70"
        />
        {state.autoSuggested ? (
          <p className="mt-2 text-[12px] leading-5 text-ds-muted">
            {t('fileTreeAutoRenameReview')}
          </p>
        ) : null}
        {state.error ? (
          <p className="mt-3 text-[12px] leading-5 text-red-600 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {state.submitting ? t('loading') : t('writeEntryDialogRename')}
          </button>
        </div>
      </form>
    </div>
  )
}

function FileTreeContextMenuItem({
  icon,
  label,
  disabled = false,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function normalizeWorkspaceGroups(
  workspaceRoot: string,
  workspaceGroups: WorkspaceReferenceGroup[] | undefined
): WorkspaceReferenceGroup[] {
  const raw = workspaceGroups?.length
    ? workspaceGroups
    : workspaceRoot.trim()
      ? [{
          id: `project:${workspaceRoot.trim()}`,
          label: workspaceName(workspaceRoot),
          workspaceRoot,
          kind: 'project' as const
        }]
      : []
  const seen = new Set<string>()
  const groups: WorkspaceReferenceGroup[] = []
  for (const group of raw) {
    const root = normalizePath(group.workspaceRoot)
    if (!root) continue
    const key = root.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      ...group,
      workspaceRoot: root,
      label: group.label || workspaceName(root)
    })
  }
  return groups
}
