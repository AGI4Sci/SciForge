import type {
  WorkspaceFileReadResult,
  WorkspaceFileTarget,
  WorkspaceHtmlPreviewResult,
  WorkspaceImageReadResult
} from '@shared/workspace-file'
import type { VisibleContextResource } from '@shared/visible-context'
import {
  createPdfAnchor,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationSidecar,
  type PdfAnnotationThread
} from '@shared/pdf-annotations'
import type { ChatBlock } from '../agent/types'
import {
  Check,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  FileCode2,
  FilePenLine,
  Eye,
  Loader2,
  MessageSquareText,
  PanelRightClose,
  RefreshCw,
  Save
} from 'lucide-react'
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import {
  resolveContentZoomWheel,
  stepContentScale
} from '../lib/content-zoom-shortcuts'
import { openSafeExternalUrl } from '../lib/open-external'
import { openWorkspacePathInEditor } from '../lib/open-workspace-path'
import { registerVisibleContextComponent } from '../lib/visible-context'
import {
  highlightCodeHtml,
  languageFromFilePath,
  renderFallbackCodeHtml
} from '../lib/code-highlighting'
import {
  addPdfAnnotationToThread,
  createPdfAnnotationThread,
  deletePdfAnnotationThread,
  mergePdfAnnotationContribution,
  reopenPdfAnnotationThread,
  resolvePdfAnnotationThread,
  updatePdfAnnotation,
  updatePdfAnnotationThread,
  type PdfAnnotationThreadSummary
} from '../write/pdf-annotations'
import { useChatStore } from '../store/chat-store'
import type { SideConversation } from '../store/chat-store-types'
import { WriteMarkdownPreview } from './write/WriteMarkdownPreview'
import {
  WritePdfAnnotationsPanel,
  type WritePdfAnnotationDisplayMode,
  type WritePdfQuestionAssistantReply,
  type WritePdfQuestionTurn
} from './write/WritePdfAnnotationsPanel'
import {
  WritePdfViewer,
  type WritePdfAnnotationAction,
  type WritePdfAnnotationOverlay,
  type WritePdfSelection,
  type WritePdfSelectionPageRect
} from './write/WritePdfViewer'
import { WriteMarkdownEditor } from './write/WriteMarkdownEditor'

type Props = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  className?: string
  onClose: () => void
  onOpenDirectory?: (target: { workspaceRoot: string; path: string }) => void
}

type WorkspaceImagePreviewResult = Extract<WorkspaceImageReadResult, { ok: true }> & {
  kind: 'image'
}

type WorkspacePreviewResult =
  | Extract<WorkspaceFileReadResult, { ok: true }>
  | WorkspaceImagePreviewResult
  | { ok: false; message: string }

type PreviewNotice = {
  tone: 'success' | 'error'
  message: string
}

type BreadcrumbItem = {
  label: string
  directoryPath: string | null
}

type MarkdownFilePreviewMode = 'source' | 'split' | 'preview'
type HtmlFilePreviewMode = 'source' | 'preview'
type TextFileSaveState = 'idle' | 'saving' | 'saved' | 'error'

const COPY_RESET_MS = 1400
const PDF_SIDECAR_SAVE_DEBOUNCE_MS = 180
const PREVIEW_MIN_SCALE = 0.65
const PREVIEW_MAX_SCALE = 2.4
const PREVIEW_SCALE_STEP = 0.1
const DEFAULT_PREVIEW_SCALE = 1
const IMAGE_PREVIEW_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.ico'
])
const MARKDOWN_PREVIEW_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])
const HTML_PREVIEW_EXTENSIONS = new Set(['.html', '.htm'])

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function extensionFromPath(path: string): string {
  const fileName = fileNameFromPath(path).toLowerCase()
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}

function isImagePreviewPath(path: string): boolean {
  return IMAGE_PREVIEW_EXTENSIONS.has(extensionFromPath(path))
}

function isMarkdownPreviewPath(path: string): boolean {
  return MARKDOWN_PREVIEW_EXTENSIONS.has(extensionFromPath(path))
}

function isHtmlPreviewPath(path: string): boolean {
  return HTML_PREVIEW_EXTENSIONS.has(extensionFromPath(path))
}

function splitPath(path: string): string[] {
  return path.split(/[/\\]/).filter(Boolean)
}

function relativePathForVisibleContext(path: string, workspaceRoot: string): string | undefined {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (!normalizedRoot) return undefined
  if (normalizedPath === normalizedRoot) return ''
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  if (!normalizedPath.startsWith('/')) return normalizedPath
  return undefined
}

function workspaceFileResourceUriForVisibleContext(relativePath: string | undefined): string | undefined {
  if (relativePath === undefined) return undefined
  return `workspace://file/${relativePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

function relativePathSegments(path: string, workspaceRoot: string): string[] {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return splitPath(normalizedPath.slice(normalizedRoot.length + 1))
  }
  return splitPath(path)
}

function joinRelativePath(segments: string[]): string {
  return segments.join('/')
}

function parentDirectoryPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : ''
}

function extensionBadge(path: string, language: string): string {
  const fileName = fileNameFromPath(path)
  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const value = ext || language || 'txt'
  return value.slice(0, 3).toUpperCase()
}

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function compactInlineText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clipInlineText(value = '', maxChars = 96): string {
  const compact = compactInlineText(value)
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

function annotationKindForAction(action: WritePdfAnnotationAction): PdfAnnotationKind | null {
  if (action === 'copy') return null
  if (action === 'comment') return 'comment'
  if (action === 'translation') return 'question'
  if (action === 'question') return 'question'
  return 'highlight'
}

function overlayKindForThread(thread: PdfAnnotationThread): WritePdfAnnotationOverlay['kind'] {
  return thread.kind
}

function assistantTextAfterLatestUser(blocks: readonly ChatBlock[], liveAssistant = ''): string {
  let lastUserIndex = -1
  blocks.forEach((block, index) => {
    if (block.kind === 'user') lastUserIndex = index
  })
  const assistantBlocks = blocks
    .slice(lastUserIndex + 1)
    .filter((block): block is Extract<ChatBlock, { kind: 'assistant' }> => block.kind === 'assistant')
    .map((block) => block.text.trim())
    .filter(Boolean)
  const live = liveAssistant.trim()
  return [...assistantBlocks, ...(live ? [live] : [])].join('\n\n').trim()
}

type PdfQuestionSideBlockTurn = {
  blockId: string
  sourceMessageId: string
  kind: 'question' | 'answer'
  role: 'user' | 'assistant'
  text: string
  createdAt?: string
}

function pdfQuestionBlockSourceMessageId(sideThreadId: string, blockId: string): string {
  return `${sideThreadId}:${blockId}`
}

function pdfQuestionBlockTurns(side: SideConversation): PdfQuestionSideBlockTurn[] {
  return side.blocks
    .filter((block): block is Extract<ChatBlock, { kind: 'user' | 'assistant' }> =>
      (block.kind === 'user' || block.kind === 'assistant') && Boolean(block.text.trim())
    )
    .map((block) => ({
      blockId: block.id,
      sourceMessageId: pdfQuestionBlockSourceMessageId(side.threadId, block.id),
      kind: block.kind === 'user' ? 'question' : 'answer',
      role: block.kind === 'user' ? 'user' : 'assistant',
      text: block.text.trim(),
      ...(block.createdAt ? { createdAt: block.createdAt } : {})
    }))
}

function pdfQuestionTurnsFromSide(side: SideConversation): WritePdfQuestionTurn[] {
  const turns: WritePdfQuestionTurn[] = pdfQuestionBlockTurns(side).map((turn) => ({
    id: turn.sourceMessageId,
    role: turn.role,
    text: turn.text
  }))
  const liveAssistant = side.liveAssistant.trim()
  if (liveAssistant) {
    turns.push({
      id: `${side.threadId}:live-assistant`,
      role: 'assistant',
      text: liveAssistant,
      busy: side.busy
    })
  }
  return turns
}

function pdfQuestionPreviousDiscussion(summary: PdfAnnotationThreadSummary): string {
  return summary.annotations
    .filter((annotation) => annotation.kind === 'question' || annotation.kind === 'answer' || annotation.kind === 'translation')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((annotation) => {
      const text = annotation.body.trim()
      if (!text) return ''
      const speaker = annotation.kind === 'question' ? 'User' : 'Agent'
      return `${speaker}: ${text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function findPdfQuestionPersistedAnnotation(
  annotations: readonly PdfAnnotation[],
  threadId: string,
  sideThreadId: string,
  turn: PdfQuestionSideBlockTurn
): PdfAnnotation | undefined {
  return annotations.find((annotation) =>
    annotation.threadId === threadId &&
    annotation.kind === turn.kind &&
    annotation.sourceMessageId === turn.sourceMessageId
  ) ?? annotations.find((annotation) =>
    annotation.threadId === threadId &&
    annotation.kind === turn.kind &&
    annotation.sourceMessageId === sideThreadId
  )
}

function pdfQuestionTurnNeedsPersistence(
  sidecar: PdfAnnotationSidecar,
  thread: PdfAnnotationThread,
  side: SideConversation,
  turn: PdfQuestionSideBlockTurn
): boolean {
  const existing = findPdfQuestionPersistedAnnotation(sidecar.annotations, thread.id, side.threadId, turn)
  return !existing ||
    existing.kind !== turn.kind ||
    existing.body !== turn.text ||
    existing.sourceMessageId !== turn.sourceMessageId
}

function pageRangeText(summary: PdfAnnotationThreadSummary): string {
  if (summary.pageStart == null || summary.pageEnd == null) return ''
  return summary.pageStart === summary.pageEnd
    ? `page ${summary.pageStart}`
    : `pages ${summary.pageStart}-${summary.pageEnd}`
}

function buildPdfAnnotationQuestionPrompt(input: {
  question: string
  summary: PdfAnnotationThreadSummary
  pdfPath: string
  workspaceRoot: string
  intent?: 'question' | 'translate'
  previousDiscussion?: string
}): string {
  const pageRange = pageRangeText(input.summary)
  const quote = input.summary.anchors
    .map((anchor) => anchor.quote.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  const context = [
    'You are answering a lightweight by-the-way PDF question inside SciForge\'s right sidebar.',
    'Answer directly in the right-sidebar style: concise, helpful, and grounded in the selected PDF text.',
    'Do not edit files, create tasks, or ask the user to switch threads.',
    input.intent === 'translate'
      ? 'The user chose the translation shortcut. Translate the selected text into the user\'s language, then briefly explain important domain terms.'
      : 'If the question cannot be answered from the selection alone, say what extra page or context is needed.',
    '',
    `PDF path: ${input.pdfPath}`,
    input.workspaceRoot ? `Workspace: ${input.workspaceRoot}` : '',
    pageRange ? `Anchor: ${pageRange}` : '',
    quote ? `Selected PDF text:\n"""\n${quote}\n"""` : 'Selected PDF region: visual/image anchor without extractable text.',
    input.previousDiscussion ? `Previous discussion for this PDF selection:\n${input.previousDiscussion}` : '',
    '',
    `User question:\n${input.question.trim()}`
  ].filter(Boolean)
  return context.join('\n')
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

function isPdfAnnotationFingerprintMismatch(message: string): boolean {
  const normalized = message.toLocaleLowerCase()
  return normalized.includes('fingerprint') || normalized.includes('different pdf') || normalized.includes('mismatch')
}

function isImagePreviewTarget(target: WorkspaceFileTarget): boolean {
  const kind = (target as WorkspaceFileTarget & { kind?: unknown }).kind
  return kind === 'image' || isImagePreviewPath(target.path)
}

function nextPreviewScale(value: number, direction: 1 | -1): number {
  return stepContentScale(value, direction, {
    min: PREVIEW_MIN_SCALE,
    max: PREVIEW_MAX_SCALE,
    step: PREVIEW_SCALE_STEP
  })
}

type PreviewZoomStyle = CSSProperties & { zoom?: number }

export function WorkspaceFilePreviewPanel({
  target,
  workspaceRoot,
  className,
  onClose,
  onOpenDirectory
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<WorkspacePreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [highlightHtml, setHighlightHtml] = useState(() => renderFallbackCodeHtml(''))
  const [markdownMode, setMarkdownMode] = useState<MarkdownFilePreviewMode>('preview')
  const [htmlMode, setHtmlMode] = useState<HtmlFilePreviewMode>('preview')
  const [htmlPreview, setHtmlPreview] = useState<WorkspaceHtmlPreviewResult | null>(null)
  const [htmlPreviewLoading, setHtmlPreviewLoading] = useState(false)
  const [htmlPreviewRefreshKey, setHtmlPreviewRefreshKey] = useState(0)
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const [previewScale, setPreviewScale] = useState(DEFAULT_PREVIEW_SCALE)
  const [textDraft, setTextDraft] = useState('')
  const [textSavedContent, setTextSavedContent] = useState('')
  const [textSaveState, setTextSaveState] = useState<TextFileSaveState>('idle')
  const [textSaveError, setTextSaveError] = useState<string | null>(null)
  const [pdfSidecar, setPdfSidecar] = useState<PdfAnnotationSidecar | null>(null)
  const [pdfSidecarPath, setPdfSidecarPath] = useState<string | null>(null)
  const [pdfAnnotationsOpen, setPdfAnnotationsOpen] = useState(false)
  const [pdfAnnotationPackageAction, setPdfAnnotationPackageAction] = useState<'export' | 'export-pdf' | 'import' | 'reload' | null>(null)
  const [selectedPdfThreadId, setSelectedPdfThreadId] = useState<string | null>(null)
  const [hoveredPdfThreadId, setHoveredPdfThreadId] = useState<string | null>(null)
  const [pdfAnnotationDisplayMode, setPdfAnnotationDisplayMode] = useState<WritePdfAnnotationDisplayMode>('current')
  const [pdfJumpToRect, setPdfJumpToRect] = useState<WritePdfSelectionPageRect | null>(null)
  const [pdfNotice, setPdfNotice] = useState<PreviewNotice | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyResetRef = useRef<number | null>(null)
  const pdfSidecarSaveTimerRef = useRef<number | null>(null)
  const pdfSidecarLoadKeyRef = useRef('')
  const pdfAnnotationImportInputRef = useRef<HTMLInputElement | null>(null)
  const pdfQuestionData = useChatStore(
    useShallow((s) => ({
      sideConversations: s.sideConversations,
      spawnSideConversation: s.spawnSideConversation,
      sendSideMessage: s.sendSideMessage
    }))
  )

  useEffect(() => {
    if (!target) {
      setResult(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setResult(null)
    setPdfNotice(null)

    const fileTarget = {
      ...target,
      workspaceRoot: target.workspaceRoot ?? workspaceRoot
    }
    const readTask: Promise<WorkspacePreviewResult> = isImagePreviewTarget(target)
      ? window.sciforge.readWorkspaceImage(fileTarget).then((next) =>
          next.ok ? { ...next, kind: 'image' as const } : next
        )
      : window.sciforge.readWorkspaceFile(fileTarget)

    void readTask
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((error) => {
        if (!cancelled) {
          setResult({
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [previewReloadKey, target, workspaceRoot])

  const previewIdentityPath = result?.ok ? result.path : target?.path

  useEffect(() => {
    setPreviewScale(DEFAULT_PREVIEW_SCALE)
  }, [previewIdentityPath])

  useEffect(() => {
    if (!result?.ok || result.kind !== 'text' || !result.line) return
    const id = window.requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector(`[data-line="${result.line}"]`)
      row?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      if (pdfSidecarSaveTimerRef.current !== null) window.clearTimeout(pdfSidecarSaveTimerRef.current)
    },
    []
  )

  const displayPath = useMemo(() => {
    if (result?.ok) return formatFilePathForDisplay(result.path, workspaceRoot) ?? result.path
    return target?.path ?? ''
  }, [result, target, workspaceRoot])
  const language = useMemo(() => {
    if (result?.ok && result.kind === 'text') return languageFromFilePath(result.path)
    return target?.path ? languageFromFilePath(target.path) : ''
  }, [result, target])
  const lines = useMemo(() => (result?.ok && result.kind === 'text' ? result.content.split('\n') : []), [result])
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const path = result?.ok ? result.path : target?.path ?? ''
    if (!path) return []
    const projectName = workspaceRoot ? fileNameFromPath(workspaceRoot) : 'Project'
    const relativeSegments = relativePathSegments(path, workspaceRoot)
    return [
      { label: 'Project', directoryPath: '' },
      { label: projectName, directoryPath: '' },
      ...relativeSegments.map((segment, index) => ({
        label: segment,
        directoryPath: index < relativeSegments.length - 1
          ? joinRelativePath(relativeSegments.slice(0, index + 1))
          : null
      }))
    ]
  }, [result, target, workspaceRoot])
  const currentFileName = displayPath ? fileNameFromPath(displayPath) : t('filePreviewTitle')
  const badge = extensionBadge(result?.ok ? result.path : target?.path ?? '', language)
  const pdfResult = result?.ok && result.kind === 'pdf' ? result : null
  const pdfPath = pdfResult?.path ?? null
  const pdfWorkspaceRoot = target?.workspaceRoot ?? workspaceRoot
  const pdfMtimeMs = pdfResult?.mtimeMs ?? null
  const textPreviewActive = result?.ok && result.kind === 'text'
  const markdownPreviewActive = textPreviewActive && isMarkdownPreviewPath(result.path)
  const htmlPreviewActive = textPreviewActive && isHtmlPreviewPath(result.path)
  const showTextSource = markdownPreviewActive
    ? markdownMode !== 'preview'
    : htmlPreviewActive
      ? htmlMode === 'source'
      : textPreviewActive
  const showMarkdownPreview = markdownPreviewActive && markdownMode !== 'source'
  const showHtmlPreview = htmlPreviewActive && htmlMode === 'preview'
  const textDirty = textPreviewActive && textDraft !== textSavedContent
  const textEditable = textPreviewActive && !result.truncated
  const activeLine = result?.ok && result.kind === 'text' && result.line && result.line >= 1 && result.line <= lines.length
    ? result.line
    : null
  const codeSurfaceStyle = activeLine
    ? ({
        '--ds-file-preview-active-line': activeLine - 1
      } as CSSProperties)
    : undefined
  const previewZoomStyle = useMemo<PreviewZoomStyle>(
    () => previewScale === DEFAULT_PREVIEW_SCALE ? {} : { zoom: previewScale },
    [previewScale]
  )
  const zoomPreviewIn = useCallback((): void => {
    setPreviewScale((value) => nextPreviewScale(value, 1))
  }, [])
  const zoomPreviewOut = useCallback((): void => {
    setPreviewScale((value) => nextPreviewScale(value, -1))
  }, [])

  const handlePreviewZoomWheel = useCallback((event: ReactWheelEvent<HTMLElement>): void => {
    const direction = resolveContentZoomWheel(event)
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    if (direction === 'in') zoomPreviewIn()
    else zoomPreviewOut()
  }, [zoomPreviewIn, zoomPreviewOut])

  const openDirectoryFromBreadcrumb = useCallback((directoryPath: string): void => {
    onOpenDirectory?.({
      workspaceRoot: target?.workspaceRoot ?? workspaceRoot,
      path: directoryPath
    })
  }, [onOpenDirectory, target?.workspaceRoot, workspaceRoot])

  const refreshPreview = useCallback((): void => {
    if (!target || loading) return
    setPreviewReloadKey((key) => key + 1)
  }, [loading, target])

  useEffect(() => {
    if (!result?.ok || result.kind !== 'text') {
      setHighlightHtml(renderFallbackCodeHtml(''))
      return
    }

    let cancelled = false
    const fallback = renderFallbackCodeHtml(result.content)
    setHighlightHtml(fallback)

    void highlightCodeHtml(result.content, language).then((html) => {
      if (!cancelled) setHighlightHtml(html)
    })

    return () => {
      cancelled = true
    }
  }, [result, language])

  useEffect(() => {
    if (!result?.ok || result.kind !== 'text') {
      setTextDraft('')
      setTextSavedContent('')
      setTextSaveState('idle')
      setTextSaveError(null)
      return
    }
    setTextDraft(result.content)
    setTextSavedContent(result.content)
    setTextSaveState('idle')
    setTextSaveError(null)
    if (isHtmlPreviewPath(result.path)) setHtmlMode('preview')
  }, [result])

  useEffect(() => {
    if (!result?.ok || result.kind !== 'text' || !isHtmlPreviewPath(result.path)) {
      setHtmlPreview(null)
      setHtmlPreviewLoading(false)
      return
    }

    let cancelled = false
    setHtmlPreviewLoading(true)
    setHtmlPreview(null)
    void window.sciforge.previewWorkspaceHtml({
      path: result.path,
      workspaceRoot: target?.workspaceRoot ?? workspaceRoot
    }).then((next) => {
      if (!cancelled) setHtmlPreview(next)
    }).catch((error) => {
      if (!cancelled) {
        setHtmlPreview({ ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    }).finally(() => {
      if (!cancelled) setHtmlPreviewLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [htmlPreviewRefreshKey, result, target?.workspaceRoot, workspaceRoot])

  const saveTextDraft = useCallback(async (): Promise<void> => {
    if (!result?.ok || result.kind !== 'text' || result.truncated) return
    if (!textDirty || textSaveState === 'saving') return
    setTextSaveState('saving')
    setTextSaveError(null)
    try {
      const writeResult = await window.sciforge.writeWorkspaceFile({
        workspaceRoot: target?.workspaceRoot ?? workspaceRoot,
        path: result.path,
        content: textDraft
      })
      if (!writeResult.ok) {
        setTextSaveState('error')
        setTextSaveError(writeResult.message)
        return
      }
      setTextSavedContent(textDraft)
      setTextSaveState('saved')
      if (isHtmlPreviewPath(result.path)) setHtmlPreviewRefreshKey((current) => current + 1)
    } catch (error) {
      setTextSaveState('error')
      setTextSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [result, target?.workspaceRoot, textDirty, textDraft, textSaveState, workspaceRoot])

  const showPdfNotice = useCallback((notice: PreviewNotice): void => {
    setPdfNotice(notice)
  }, [])

  const savePdfSidecarSoon = useCallback((sidecar: PdfAnnotationSidecar): void => {
    if (!pdfPath || typeof window.sciforge?.pdfAnnotations?.save !== 'function') return
    if (pdfSidecarSaveTimerRef.current) window.clearTimeout(pdfSidecarSaveTimerRef.current)
    pdfSidecarSaveTimerRef.current = window.setTimeout(() => {
      pdfSidecarSaveTimerRef.current = null
      void window.sciforge?.pdfAnnotations?.save({
        pdfPath,
        workspaceRoot: pdfWorkspaceRoot,
        sidecar
      }).then((saveResult) => {
        if (!saveResult.ok) {
          showPdfNotice({ tone: 'error', message: saveResult.message })
          return
        }
        setPdfSidecar(saveResult.sidecar)
        setPdfSidecarPath(saveResult.path)
      }).catch((error) => {
        showPdfNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    }, PDF_SIDECAR_SAVE_DEBOUNCE_MS)
  }, [pdfPath, pdfWorkspaceRoot, showPdfNotice])

  const updatePdfSidecar = useCallback((updater: (sidecar: PdfAnnotationSidecar) => PdfAnnotationSidecar): PdfAnnotationSidecar | null => {
    if (!pdfSidecar) return null
    try {
      const nextSidecar = updater(pdfSidecar)
      setPdfSidecar(nextSidecar)
      savePdfSidecarSoon(nextSidecar)
      return nextSidecar
    } catch (error) {
      showPdfNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }, [pdfSidecar, savePdfSidecarSoon, showPdfNotice])

  const pdfQuestionReplies = useMemo<Record<string, WritePdfQuestionAssistantReply>>(() => {
    if (!pdfSidecar) return {}
    const replies: Record<string, WritePdfQuestionAssistantReply> = {}
    for (const thread of pdfSidecar.threads) {
      if (thread.kind !== 'question' || !thread.sourceMessageId) continue
      const side = pdfQuestionData.sideConversations[thread.sourceMessageId]
      if (!side || side.source !== 'pdf_annotation') continue
      replies[thread.id] = {
        text: assistantTextAfterLatestUser(side.blocks, side.liveAssistant),
        busy: side.busy,
        error: side.error,
        sideThreadId: side.threadId,
        turns: pdfQuestionTurnsFromSide(side)
      }
    }
    return replies
  }, [pdfQuestionData.sideConversations, pdfSidecar])

  const askPdfAnnotationQuestion = useCallback(async (
    threadId: string,
    question: string,
    summary: PdfAnnotationThreadSummary,
    options?: { intent?: 'question' | 'translate' }
  ): Promise<void> => {
    const trimmed = question.trim()
    if (!trimmed || !pdfPath) return

    const existingSideThreadId = summary.thread.sourceMessageId
    const existingSide = existingSideThreadId ? pdfQuestionData.sideConversations[existingSideThreadId] : undefined
    const prompt = buildPdfAnnotationQuestionPrompt({
      question: trimmed,
      summary,
      pdfPath,
      workspaceRoot: pdfWorkspaceRoot,
      intent: options?.intent,
      previousDiscussion: existingSide || !summary.thread.sourceMessageId ? '' : pdfQuestionPreviousDiscussion(summary)
    })
    const title = `PDF: ${clipInlineText(trimmed, 48)}`
    let sideThreadId = existingSide?.threadId ?? null
    if (existingSide) {
      const sent = await pdfQuestionData.sendSideMessage(existingSide.threadId, prompt)
      if (!sent) {
        showPdfNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
        return
      }
    } else {
      sideThreadId = await pdfQuestionData.spawnSideConversation(prompt, {
        source: 'pdf_annotation',
        title,
        openPanel: false,
        allowStandalone: true,
        standalone: true
      })
    }
    if (!sideThreadId) {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
      return
    }

    const now = new Date().toISOString()
    updatePdfSidecar((current) => {
      let next = current
      if (!summary.thread.sourceMessageId) {
        const questionAnnotation =
          current.annotations.find((annotation) => annotation.threadId === threadId && annotation.kind === 'question') ??
          current.annotations.find((annotation) => annotation.id === summary.firstAnnotation?.id)
        if (questionAnnotation) {
          next = updatePdfAnnotation(next, questionAnnotation.id, {
            kind: 'question',
            body: trimmed,
            sourceText: summary.quote || questionAnnotation.sourceText,
            sourceMessageId: sideThreadId,
            updatedAt: now
          })
        } else {
          next = addPdfAnnotationToThread(next, threadId, {
            id: makeLocalId('pdf-question'),
            kind: 'question',
            body: trimmed,
            sourceText: summary.quote,
            sourceMessageId: sideThreadId,
            createdAt: now
          })
        }
      }
      return updatePdfAnnotationThread(next, threadId, {
        kind: 'question',
        sourceMessageId: sideThreadId,
        status: 'open',
        title: clipInlineText(trimmed || summary.quote, 96),
        updatedAt: now
      })
    })
  }, [
    pdfPath,
    pdfQuestionData,
    pdfWorkspaceRoot,
    showPdfNotice,
    t,
    updatePdfSidecar
  ])

  useEffect(() => {
    if (!pdfSidecar) return
    const sideConversations = pdfQuestionData.sideConversations
    let shouldPersist = false
    for (const thread of pdfSidecar.threads) {
      if (thread.kind !== 'question' || !thread.sourceMessageId) continue
      const side = sideConversations[thread.sourceMessageId]
      if (!side || side.source !== 'pdf_annotation') continue
      const turns = pdfQuestionBlockTurns(side)
      if (turns.some((turn) => pdfQuestionTurnNeedsPersistence(pdfSidecar, thread, side, turn))) {
        shouldPersist = true
        break
      }
    }
    if (!shouldPersist) return

    updatePdfSidecar((current) => {
      let next = current
      const now = new Date().toISOString()
      for (const thread of current.threads) {
        if (thread.kind !== 'question' || !thread.sourceMessageId) continue
        const side = sideConversations[thread.sourceMessageId]
        if (!side || side.source !== 'pdf_annotation') continue
        const sourceText = next.anchors.find((anchor) => thread.anchorIds.includes(anchor.id))?.quote
        for (const turn of pdfQuestionBlockTurns(side)) {
          const existing = findPdfQuestionPersistedAnnotation(next.annotations, thread.id, side.threadId, turn)
          if (existing) {
            if (
              existing.kind !== turn.kind ||
              existing.body !== turn.text ||
              existing.sourceMessageId !== turn.sourceMessageId
            ) {
              next = updatePdfAnnotation(next, existing.id, {
                kind: turn.kind,
                body: turn.text,
                ...(sourceText ? { sourceText } : {}),
                sourceMessageId: turn.sourceMessageId,
                updatedAt: now
              })
            }
            continue
          }
          next = addPdfAnnotationToThread(next, thread.id, {
            id: makeLocalId(turn.kind === 'question' ? 'pdf-question' : 'pdf-answer'),
            kind: turn.kind,
            body: turn.text,
            ...(sourceText ? { sourceText } : {}),
            sourceMessageId: turn.sourceMessageId,
            createdAt: turn.createdAt ?? now
          })
        }
      }
      return next
    })
  }, [pdfQuestionData.sideConversations, pdfSidecar, updatePdfSidecar])

  const pdfAnnotationOverlays = useMemo<WritePdfAnnotationOverlay[]>(() => {
    if (!pdfSidecar) return []
    return pdfSidecar.threads.map((thread) => {
      const anchorIds = new Set(thread.anchorIds)
      return {
        id: thread.id,
        kind: overlayKindForThread(thread),
        status: thread.status,
        rects: pdfSidecar.anchors
          .filter((anchor) => anchorIds.has(anchor.id))
          .flatMap((anchor) => anchor.rects),
        label: thread.kind === 'highlight' ? '' : undefined
      }
    }).filter((overlay) => overlay.rects.length > 0)
  }, [pdfSidecar])
  const activePdfAnnotationId = hoveredPdfThreadId ?? selectedPdfThreadId
  const visiblePdfAnnotationOverlays = useMemo<WritePdfAnnotationOverlay[]>(() => {
    if (pdfAnnotationDisplayMode === 'hidden') return []
    if (pdfAnnotationDisplayMode === 'all') return pdfAnnotationOverlays
    if (!activePdfAnnotationId) return []
    return pdfAnnotationOverlays.filter((overlay) => overlay.id === activePdfAnnotationId)
  }, [activePdfAnnotationId, pdfAnnotationDisplayMode, pdfAnnotationOverlays])
  const visibleContextResources = useMemo<VisibleContextResource[]>(() => {
    const previewPath = result?.ok ? result.path : target?.path
    if (!previewPath) return []
    const previewWorkspaceRoot = target?.workspaceRoot ?? workspaceRoot
    const relativePath = relativePathForVisibleContext(previewPath, previewWorkspaceRoot)
    const resources: VisibleContextResource[] = [{
      kind: 'workspaceFile',
      role: 'preview-target',
      title: fileNameFromPath(previewPath),
      accessHint: 'Use gui_workspace_preview/read with workspaceRoot and relativePath when additional content is needed.',
      workspaceRoot: previewWorkspaceRoot,
      path: previewPath,
      relativePath,
      resourceUri: workspaceFileResourceUriForVisibleContext(relativePath),
      name: fileNameFromPath(previewPath),
      fileKind: result?.ok ? result.kind : undefined,
      mimeType: result?.ok && 'mimeType' in result ? result.mimeType : undefined,
      size: result?.ok && 'size' in result ? result.size : undefined,
      mtimeMs: result?.ok && 'mtimeMs' in result ? result.mtimeMs : undefined
    }]

    if (pdfPath && pdfSidecar) {
      const sidecarRelativePath = pdfSidecarPath
        ? relativePathForVisibleContext(pdfSidecarPath, pdfWorkspaceRoot)
        : undefined
      resources.push({
        kind: 'pdfAnnotations',
        role: 'annotation-sidecar',
        title: 'PDF annotations',
        accessHint: 'Use gui_workspace_read with workspaceRoot and relativePath to inspect annotation JSON only when needed.',
        workspaceRoot: pdfWorkspaceRoot,
        path: pdfSidecarPath ?? undefined,
        relativePath: sidecarRelativePath,
        resourceUri: workspaceFileResourceUriForVisibleContext(sidecarRelativePath),
        name: sidecarRelativePath ? fileNameFromPath(sidecarRelativePath) : undefined,
        fileKind: 'json',
        mimeType: 'application/json',
        annotationCount: pdfSidecar.annotations.length,
        threadCount: pdfSidecar.threads.length,
        openThreadCount: pdfSidecar.threads.filter((thread) => thread.status !== 'resolved').length,
        selectedThreadId: selectedPdfThreadId,
        updatedAt: pdfSidecar.updatedAt,
        metadata: {
          pdfPath,
          pdfFingerprint: pdfSidecar.pdfFingerprint.sha256,
          displayMode: pdfAnnotationDisplayMode,
          annotationsPanelOpen: pdfAnnotationsOpen
        }
      })
    }

    return resources
  }, [
    pdfAnnotationDisplayMode,
    pdfAnnotationsOpen,
    pdfPath,
    pdfSidecar,
    pdfSidecarPath,
    pdfWorkspaceRoot,
    result,
    selectedPdfThreadId,
    target?.path,
    target?.workspaceRoot,
    workspaceRoot
  ])

  useEffect(() => {
    const previewPath = result?.ok ? result.path : target?.path
    if (!previewPath) return undefined
    const previewKind = result?.ok ? result.kind : loading ? 'loading' : 'unknown'
    return registerVisibleContextComponent({
      id: 'right-sidebar.file-preview',
      region: 'right-sidebar',
      component: 'file-preview',
      title: fileNameFromPath(previewPath),
      visible: true,
      priority: 20,
      updatedAt: new Date().toISOString(),
      summary: result?.ok
        ? `Previewing ${result.kind} file ${fileNameFromPath(previewPath)}.`
        : loading
          ? `Loading file preview for ${fileNameFromPath(previewPath)}.`
          : `File preview is open for ${fileNameFromPath(previewPath)}.`,
      resources: visibleContextResources,
      state: {
        path: previewPath,
        workspaceRoot: target?.workspaceRoot ?? workspaceRoot,
        kind: previewKind,
        loading,
        ok: result?.ok ?? null,
        error: result && !result.ok ? result.message : null,
        line: result?.ok && result.kind === 'text' ? result.line ?? null : target?.line ?? null,
        column: result?.ok && result.kind === 'text' ? result.column ?? null : target?.column ?? null,
        pdfAnnotationThreadCount: pdfSidecar?.threads.length ?? null,
        pdfAnnotationSelectedThreadId: selectedPdfThreadId,
        pdfAnnotationsPanelOpen: pdfAnnotationsOpen
      }
    })
  }, [
    loading,
    pdfAnnotationsOpen,
    pdfSidecar?.threads.length,
    result,
    selectedPdfThreadId,
    target?.column,
    target?.line,
    target?.path,
    target?.workspaceRoot,
    visibleContextResources,
    workspaceRoot
  ])

  useEffect(() => {
    if (!pdfPath || pdfMtimeMs == null) {
      pdfSidecarLoadKeyRef.current = ''
      setPdfSidecar(null)
      setPdfSidecarPath(null)
      setSelectedPdfThreadId(null)
      setHoveredPdfThreadId(null)
      setPdfJumpToRect(null)
      return
    }
    const loadKey = `${pdfWorkspaceRoot}\n${pdfPath}\n${pdfMtimeMs}\n${previewReloadKey}`
    if (pdfSidecarLoadKeyRef.current === loadKey) return
    pdfSidecarLoadKeyRef.current = loadKey
    setPdfSidecar(null)
    setPdfSidecarPath(null)
    setSelectedPdfThreadId(null)
    setHoveredPdfThreadId(null)
    setPdfJumpToRect(null)
    if (typeof window.sciforge?.pdfAnnotations?.load !== 'function') {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationReloadUnavailable') })
      return
    }

    let cancelled = false
    void window.sciforge.pdfAnnotations.load({
      pdfPath,
      workspaceRoot: pdfWorkspaceRoot
    }).then((loadResult) => {
      if (cancelled || pdfSidecarLoadKeyRef.current !== loadKey) return
      if (!loadResult.ok) {
        showPdfNotice({ tone: 'error', message: loadResult.message })
        return
      }
      setPdfSidecar(loadResult.sidecar)
      setPdfSidecarPath(loadResult.path)
      if (loadResult.warnings.length > 0) {
        showPdfNotice({ tone: 'error', message: loadResult.warnings[0] })
      }
    }).catch((error) => {
      if (!cancelled) showPdfNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      cancelled = true
    }
  }, [pdfMtimeMs, pdfPath, pdfWorkspaceRoot, previewReloadKey, showPdfNotice, t])

  const addPdfAnnotationFromSelection = useCallback((action: WritePdfAnnotationAction, pdfSelection: WritePdfSelection): void => {
    if (!pdfSidecar) {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationSidecarUnavailable') })
      return
    }
    if (!pdfSelection.rects?.length) {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationAnchorUnavailable') })
      return
    }
    const kind = annotationKindForAction(action)
    if (!kind) {
      showPdfNotice({ tone: 'success', message: t('writePdfAnnotationCopied') })
      return
    }
    const now = new Date().toISOString()
    const sourceText = pdfSelection.text.trim() || t('writePdfAnnotationVisualSelectionQuote')
    const anchor = createPdfAnchor({
      id: makeLocalId('pdf-anchor'),
      kind: pdfSelection.text.trim() ? 'text' : 'image',
      rects: pdfSelection.rects,
      quote: sourceText,
      pdfFingerprint: pdfSidecar.pdfFingerprint,
      createdAt: now
    })
    const body = action === 'translation' ? t('writePdfAnnotationTranslatePrompt') : ''
    const threadId = makeLocalId('pdf-thread')
    updatePdfSidecar((current) => createPdfAnnotationThread({
      ...current,
      anchors: [...current.anchors, anchor]
    }, {
      id: threadId,
      kind,
      anchorIds: [anchor.id],
      ...(kind === 'question' ? { title: clipInlineText(sourceText, 96) } : {}),
      annotations: [{
        id: makeLocalId('pdf-ann'),
        anchorId: anchor.id,
        kind,
        body,
        sourceText
      }],
      createdAt: now
    }))
    setSelectedPdfThreadId(threadId)
    setPdfAnnotationsOpen(true)
  }, [pdfSidecar, showPdfNotice, t, updatePdfSidecar])

  const selectPdfAnnotationThread = useCallback((threadId: string, summary: PdfAnnotationThreadSummary): void => {
    setSelectedPdfThreadId(threadId)
    setPdfAnnotationsOpen(true)
    const firstRect = summary.anchors.flatMap((anchor) => anchor.rects)[0]
    if (firstRect) setPdfJumpToRect({ ...firstRect })
  }, [])

  const selectPdfAnnotationOverlay = useCallback((threadId: string): void => {
    setSelectedPdfThreadId(threadId)
    setPdfAnnotationsOpen(true)
    const thread = pdfSidecar?.threads.find((item) => item.id === threadId)
    const anchorId = thread?.anchorIds[0]
    const rect = anchorId ? pdfSidecar?.anchors.find((anchor) => anchor.id === anchorId)?.rects[0] : undefined
    if (rect) setPdfJumpToRect({ ...rect })
  }, [pdfSidecar])

  const resolvePdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => resolvePdfAnnotationThread(current, threadId, now))
  }, [updatePdfSidecar])

  const reopenPdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => reopenPdfAnnotationThread(current, threadId, now))
  }, [updatePdfSidecar])

  const deletePdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => deletePdfAnnotationThread(current, threadId, { updatedAt: now }))
    setSelectedPdfThreadId((current) => current === threadId ? null : current)
    setHoveredPdfThreadId((current) => current === threadId ? null : current)
  }, [updatePdfSidecar])

  const editPdfAnnotation = useCallback((annotationId: string, body: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((sidecar) => updatePdfAnnotation(sidecar, annotationId, {
      body,
      updatedAt: now
    }))
  }, [updatePdfSidecar])

  const exportPdfAnnotationPackage = useCallback(async (): Promise<void> => {
    if (!pdfPath || !pdfSidecar || pdfAnnotationPackageAction) return
    if (typeof window.sciforge?.pdfAnnotations?.export !== 'function') {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationExportUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('export')
    try {
      const exportResult = await window.sciforge.pdfAnnotations.export({
        pdfPath,
        workspaceRoot: pdfWorkspaceRoot,
        sidecar: pdfSidecar
      })
      if (!exportResult.ok) {
        showPdfNotice({
          tone: 'error',
          message: t('writePdfAnnotationExportFailed', { message: exportResult.message })
        })
        return
      }
      showPdfNotice({
        tone: 'success',
        message: t('writePdfAnnotationExportSuccess', { file: fileNameFromPath(exportResult.path) })
      })
    } catch (error) {
      showPdfNotice({
        tone: 'error',
        message: t('writePdfAnnotationExportFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [pdfAnnotationPackageAction, pdfPath, pdfSidecar, pdfWorkspaceRoot, showPdfNotice, t])

  const exportPdfAnnotationPdf = useCallback(async (): Promise<void> => {
    if (!pdfPath || !pdfSidecar || pdfAnnotationPackageAction) return
    if (typeof window.sciforge?.pdfAnnotations?.exportPdf !== 'function') {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationExportPdfUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('export-pdf')
    try {
      const exportResult = await window.sciforge.pdfAnnotations.exportPdf({
        pdfPath,
        workspaceRoot: pdfWorkspaceRoot,
        sidecar: pdfSidecar
      })
      if (!exportResult.ok) {
        showPdfNotice({
          tone: 'error',
          message: t('writePdfAnnotationExportPdfFailed', { message: exportResult.message })
        })
        return
      }
      showPdfNotice({
        tone: 'success',
        message: t('writePdfAnnotationExportPdfSuccess', {
          file: fileNameFromPath(exportResult.path),
          count: exportResult.annotationCount
        })
      })
    } catch (error) {
      showPdfNotice({
        tone: 'error',
        message: t('writePdfAnnotationExportPdfFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [pdfAnnotationPackageAction, pdfPath, pdfSidecar, pdfWorkspaceRoot, showPdfNotice, t])

  const importPdfAnnotationPackageFile = useCallback(async (file: File): Promise<void> => {
    if (!pdfPath) return
    if (typeof window.sciforge?.pdfAnnotations?.import !== 'function') {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationImportUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('import')
    try {
      const packageBase64 = await fileToBase64(file)
      const importPackage = (attemptRelocation: boolean) => window.sciforge.pdfAnnotations!.import({
        pdfPath,
        workspaceRoot: pdfWorkspaceRoot,
        packageBase64,
        attemptRelocation
      })
      let importResult = await importPackage(false)
      if (!importResult.ok && isPdfAnnotationFingerprintMismatch(importResult.message)) {
        const retry = window.confirm(t('writePdfAnnotationImportFingerprintMismatch', { file: file.name }))
        if (!retry) {
          showPdfNotice({ tone: 'error', message: t('writePdfAnnotationImportCanceled') })
          return
        }
        importResult = await importPackage(true)
      }
      if (!importResult.ok) {
        showPdfNotice({
          tone: 'error',
          message: t('writePdfAnnotationImportFailed', { message: importResult.message })
        })
        return
      }

      const merged = pdfSidecar
        ? mergePdfAnnotationContribution(pdfSidecar, importResult.sidecar, { updatedAt: new Date().toISOString() })
        : {
            sidecar: importResult.sidecar,
            addedThreadCount: importResult.sidecar.threads.length,
            updatedThreadCount: 0,
            skippedThreadCount: 0,
            conflicts: []
          }
      setPdfSidecar(merged.sidecar)
      setPdfSidecarPath(importResult.path)
      setSelectedPdfThreadId(null)
      setPdfJumpToRect(null)
      savePdfSidecarSoon(merged.sidecar)
      if (importResult.warnings.length > 0) showPdfNotice({ tone: 'error', message: importResult.warnings[0] })
      showPdfNotice({
        tone: 'success',
        message: t('writePdfAnnotationImportSuccess', {
          added: merged.addedThreadCount,
          updated: merged.updatedThreadCount,
          skipped: merged.skippedThreadCount
        })
      })
    } catch (error) {
      showPdfNotice({
        tone: 'error',
        message: t('writePdfAnnotationImportFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [pdfPath, pdfSidecar, pdfWorkspaceRoot, savePdfSidecarSoon, showPdfNotice, t])

  const reloadPdfAnnotationSidecar = useCallback(async (): Promise<void> => {
    if (!pdfPath) return
    if (typeof window.sciforge?.pdfAnnotations?.load !== 'function') {
      showPdfNotice({ tone: 'error', message: t('writePdfAnnotationReloadUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('reload')
    try {
      const loadResult = await window.sciforge.pdfAnnotations.load({
        pdfPath,
        workspaceRoot: pdfWorkspaceRoot
      })
      if (!loadResult.ok) {
        showPdfNotice({
          tone: 'error',
          message: t('writePdfAnnotationReloadFailed', { message: loadResult.message })
        })
        return
      }
      const merged = pdfSidecar
        ? mergePdfAnnotationContribution(pdfSidecar, loadResult.sidecar, { updatedAt: new Date().toISOString() })
        : {
            sidecar: loadResult.sidecar,
            addedThreadCount: loadResult.sidecar.threads.length,
            updatedThreadCount: 0,
            skippedThreadCount: 0,
            conflicts: []
          }
      setPdfSidecar(merged.sidecar)
      setPdfSidecarPath(loadResult.path)
      setSelectedPdfThreadId(null)
      setPdfJumpToRect(null)
      savePdfSidecarSoon(merged.sidecar)
      if (loadResult.warnings.length > 0) showPdfNotice({ tone: 'error', message: loadResult.warnings[0] })
      showPdfNotice({
        tone: 'success',
        message: t('writePdfAnnotationReloadSuccess', {
          added: merged.addedThreadCount,
          updated: merged.updatedThreadCount,
          skipped: merged.skippedThreadCount
        })
      })
    } catch (error) {
      showPdfNotice({
        tone: 'error',
        message: t('writePdfAnnotationReloadFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [pdfPath, pdfSidecar, pdfWorkspaceRoot, savePdfSidecarSoon, showPdfNotice, t])

  const openPdfAnnotationPackagePicker = useCallback((): void => {
    if (!pdfPath || pdfAnnotationPackageAction) return
    const input = pdfAnnotationImportInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [pdfAnnotationPackageAction, pdfPath])

  const openPdfAnnotations = useCallback((): void => {
    if (!pdfPath) return
    setPdfAnnotationsOpen(true)
  }, [pdfPath])

  const openInEditor = (): void => {
    const path = result?.ok ? result.path : target?.path
    if (!path) return
    void openWorkspacePathInEditor(
      {
        path,
        line: result?.ok && result.kind === 'text' ? result.line : target?.line,
        column: result?.ok && result.kind === 'text' ? result.column : target?.column
      },
      target?.workspaceRoot ?? workspaceRoot
    ).then((next) => {
      if (!next.ok) {
        void window.sciforge?.logError?.('editor-open', 'Failed to open previewed file', {
          message: next.message,
          target
        })?.catch(() => undefined)
      }
    })
  }

  const openHtmlPreviewExternal = (): void => {
    if (!htmlPreview?.ok) return
    void openSafeExternalUrl(htmlPreview.url).catch(() => undefined)
  }

  const copyPath = async (): Promise<void> => {
    const path = result?.ok ? result.path : target?.path
    if (!path || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside
      className={`ds-no-drag ds-code-sidebar flex min-h-0 flex-col border-l border-ds-border-muted ${className ?? ''}`}
    >
      <div className="ds-code-sidebar-topbar">
        <button
          type="button"
          onDoubleClick={openInEditor}
          className="ds-code-sidebar-tab"
          title={displayPath}
          disabled={!target}
        >
          <span className="ds-code-sidebar-file-badge">{badge}</span>
          <span className="truncate">{currentFileName}</span>
        </button>

        <div className="ds-code-sidebar-actions">
          {result?.ok && result.kind === 'pdf' ? (
            <button
              type="button"
              onClick={() => setPdfAnnotationsOpen((open) => !open)}
              className={`ds-code-sidebar-icon-button ${pdfAnnotationsOpen ? 'bg-accent/10 text-accent' : ''}`}
              title={t('filePreviewOpenPdfAnnotations')}
              aria-label={t('filePreviewOpenPdfAnnotations')}
              aria-pressed={pdfAnnotationsOpen}
            >
              <MessageSquareText className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={refreshPreview}
            disabled={!target || loading}
            className="ds-code-sidebar-icon-button"
            title={loading ? t('filePreviewRefreshing') : t('filePreviewRefresh')}
            aria-label={loading ? t('filePreviewRefreshing') : t('filePreviewRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={openInEditor}
            disabled={!target}
            className="ds-code-sidebar-icon-button"
            title={t('filePreviewOpenEditor')}
            aria-label={t('filePreviewOpenEditor')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void copyPath()}
            disabled={!target}
            className="ds-code-sidebar-icon-button"
            title={copied ? t('copySuccess') : t('filePreviewCopyPath')}
            aria-label={copied ? t('copySuccess') : t('filePreviewCopyPath')}
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ds-code-sidebar-icon-button"
            title={t('rightPanelCollapse')}
            aria-label={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>

      <div className="ds-code-sidebar-breadcrumbs">
        <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden">
          {breadcrumbItems.length ? breadcrumbItems.map((item, index) => {
            const clickable = item.directoryPath !== null && Boolean(onOpenDirectory)
            return (
              <span key={`${item.label}-${index}`} className="contents">
                {index > 0 ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint/70" strokeWidth={1.8} />
                ) : null}
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => openDirectoryFromBreadcrumb(item.directoryPath ?? '')}
                    className="max-w-[160px] shrink-0 truncate rounded px-1 py-0.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    title={item.label}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    className={[
                      'truncate',
                      index === breadcrumbItems.length - 1 ? 'text-ds-ink' : 'text-ds-muted'
                    ].join(' ')}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            )
          }) : (
            <span className="truncate text-ds-muted">{t('filePreviewEmpty')}</span>
          )}
        </div>
        {result?.ok ? (
          <span className="shrink-0 font-mono text-[10px] text-ds-faint">
            {formatBytes(result.size)}
            {result.kind === 'pdf' ? ' · PDF' : result.kind === 'image' ? ' · IMG' : language ? ` · ${language}` : ''}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!target ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-ds-muted">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ds-border-muted text-ds-faint">
                <FileCode2 className="h-5 w-5" strokeWidth={1.7} />
              </div>
              {t('filePreviewEmpty')}
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            {t('filePreviewLoading')}
          </div>
        ) : result?.ok && result.kind === 'pdf' ? (
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1">
              {pdfNotice ? (
                <div className={`absolute left-3 right-3 top-3 z-30 rounded-lg border px-3 py-2 text-[12px] leading-5 shadow-sm ${
                  pdfNotice.tone === 'success'
                    ? 'border-emerald-500/25 bg-emerald-50/95 text-emerald-800 dark:bg-emerald-950/85 dark:text-emerald-100'
                    : 'border-red-500/25 bg-red-50/95 text-red-800 dark:bg-red-950/85 dark:text-red-100'
                }`}>
                  {pdfNotice.message}
                </div>
              ) : null}
              <WritePdfViewer
                filePath={result.path}
                dataBase64={result.dataBase64}
                size={result.size}
                mtimeMs={result.mtimeMs}
                workspaceRoot={target.workspaceRoot ?? workspaceRoot}
                annotationOverlays={visiblePdfAnnotationOverlays}
                activeAnnotationId={activePdfAnnotationId}
                jumpToRect={pdfJumpToRect}
                onSelectionChange={() => undefined}
                onAnnotationAction={addPdfAnnotationFromSelection}
                onAnnotationSelect={selectPdfAnnotationOverlay}
                onOpenAnnotations={openPdfAnnotations}
                className="flex-1"
              />
            </div>
            {pdfAnnotationsOpen ? (
              <div className="z-20 w-[clamp(300px,34%,380px)] shrink-0 border-l border-ds-border-muted bg-white dark:bg-ds-canvas">
                <WritePdfAnnotationsPanel
                  sidecar={pdfSidecar}
                  selectedThreadId={selectedPdfThreadId}
                  annotationDisplayMode={pdfAnnotationDisplayMode}
                  className="h-full max-h-full w-full border-l-0"
                  exportingPackage={pdfAnnotationPackageAction === 'export'}
                  exportingPdf={pdfAnnotationPackageAction === 'export-pdf'}
                  importingPackage={pdfAnnotationPackageAction === 'import'}
                  reloadingSidecar={pdfAnnotationPackageAction === 'reload'}
                  onAnnotationDisplayModeChange={setPdfAnnotationDisplayMode}
                  onSelectThread={selectPdfAnnotationThread}
                  onHoverThread={(threadId) => setHoveredPdfThreadId(threadId)}
                  onResolveThread={(threadId) => resolvePdfAnnotation(threadId)}
                  onReopenThread={(threadId) => reopenPdfAnnotation(threadId)}
                  onDeleteThread={(threadId) => deletePdfAnnotation(threadId)}
                  onEditAnnotation={editPdfAnnotation}
                  onAskQuestion={(threadId, question, summary, options) => {
                    void askPdfAnnotationQuestion(threadId, question, summary, options)
                  }}
                  questionReplies={pdfQuestionReplies}
                  onExportPackage={() => void exportPdfAnnotationPackage()}
                  onExportPdf={() => void exportPdfAnnotationPdf()}
                  onImportPackage={openPdfAnnotationPackagePicker}
                  onReloadSidecar={() => void reloadPdfAnnotationSidecar()}
                  onCollapse={() => setPdfAnnotationsOpen(false)}
                />
              </div>
            ) : null}
            <input
              ref={pdfAnnotationImportInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null
                event.currentTarget.value = ''
                if (file) void importPdfAnnotationPackageFile(file)
              }}
            />
          </div>
        ) : result?.ok && result.kind === 'image' ? (
          <div className="flex min-h-0 flex-1 flex-col bg-ds-main/70">
            <div
              className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
              onWheelCapture={handlePreviewZoomWheel}
            >
              <div
                className="inline-flex min-h-full min-w-full items-center justify-center"
                style={previewZoomStyle}
              >
                <img
                  src={result.dataUrl}
                  alt={fileNameFromPath(result.path)}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          </div>
        ) : result?.ok && result.kind === 'text' ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {result.truncated ? (
              <div className="shrink-0 border-b border-ds-border-muted/70 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                {t('filePreviewTruncated')}
              </div>
            ) : null}
            {textPreviewActive ? (
              <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-ds-canvas">
                <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-ds-border-muted/70 px-3">
                  <div className="flex items-center gap-1">
                    {markdownPreviewActive ? (
                      ([
                        ['source', FilePenLine, t('writeModeSourceShort')],
                        ['split', Columns2, t('writeModeSplitShort')],
                        ['preview', Eye, t('writeModePreviewShort')]
                      ] as const).map(([mode, Icon, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setMarkdownMode(mode)}
                          className={`flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[11px] font-medium transition ${
                            markdownMode === mode
                              ? 'bg-ds-hover text-ds-ink'
                              : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
                          }`}
                          title={label}
                          aria-label={label}
                          aria-pressed={markdownMode === mode}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                          <span className="ml-1.5 hidden xl:inline">{label}</span>
                        </button>
                      ))
                    ) : htmlPreviewActive ? (
                      ([
                        ['source', FilePenLine, t('writeModeSourceShort')],
                        ['preview', Eye, t('writeModePreviewShort')]
                      ] as const).map(([mode, Icon, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setHtmlMode(mode)}
                          className={`flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[11px] font-medium transition ${
                            htmlMode === mode
                              ? 'bg-ds-hover text-ds-ink'
                              : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
                          }`}
                          title={label}
                          aria-label={label}
                          aria-pressed={htmlMode === mode}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                          <span className="ml-1.5 hidden xl:inline">{label}</span>
                        </button>
                      ))
                    ) : (
                      <span className="flex h-7 items-center gap-1.5 rounded-md bg-ds-hover px-2 text-[11px] font-medium text-ds-ink">
                        <FilePenLine className="h-3.5 w-3.5" strokeWidth={1.8} />
                        <span>{t('writeModeSourceShort')}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {textSaveState === 'error' && textSaveError ? (
                      <span className="max-w-[220px] truncate text-[11px] text-red-600 dark:text-red-300" title={textSaveError}>
                        {textSaveError}
                      </span>
                    ) : textDirty ? (
                      <span className="text-[11px] text-ds-faint">{t('filePreviewUnsaved')}</span>
                    ) : textSaveState === 'saved' ? (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-300">{t('filePreviewSaved')}</span>
                    ) : null}
                    {htmlPreviewActive && htmlPreview?.ok ? (
                      <button
                        type="button"
                        onClick={openHtmlPreviewExternal}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        title={t('filePreviewOpenHtmlPreview')}
                        aria-label={t('filePreviewOpenHtmlPreview')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void saveTextDraft()}
                      disabled={!textEditable || !textDirty || textSaveState === 'saving'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-45"
                      title={t('filePreviewSave')}
                      aria-label={t('filePreviewSave')}
                    >
                      {textSaveState === 'saving' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                      ) : (
                        <Save className="h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                    </button>
                  </div>
                </div>
                <div className={`min-h-0 flex-1 ${markdownPreviewActive && markdownMode === 'split' ? 'grid grid-cols-2' : 'flex flex-col'}`}>
                  {showTextSource ? (
                    <div className={`min-h-0 ${showMarkdownPreview && markdownMode === 'split' ? 'border-r border-ds-border-muted/70' : 'flex-1'}`}>
                      <WriteMarkdownEditor
                        value={textDraft}
                        workspaceRoot={target?.workspaceRoot ?? workspaceRoot}
                        filePath={result.path}
                        imageDirectory={parentDirectoryPath(result.path)}
                        appearance="source"
                        livePreviewEnabled={false}
                        markdownFeatures={markdownPreviewActive}
                        readOnly={!textEditable}
                        completionEnabled={false}
                        completionDebounceMs={0}
                        completionMinAcceptScore={0}
                        completionLongEnabled={false}
                        completionLongDebounceMs={0}
                        completionLongMinAcceptScore={0}
                        onChange={(value) => {
                          setTextDraft(value)
                          setTextSaveState('idle')
                          setTextSaveError(null)
                        }}
                        onSelectionChange={() => undefined}
                        onSaveShortcut={() => void saveTextDraft()}
                      />
                    </div>
                  ) : null}
                  {showMarkdownPreview ? (
                    <div
                      ref={scrollRef}
                      className="min-h-0 flex-1 overflow-auto px-5 py-5"
                      onWheelCapture={handlePreviewZoomWheel}
                    >
                      <div style={previewZoomStyle}>
                        <WriteMarkdownPreview
                          content={textDraft}
                          isMarkdown
                          filePath={result.path}
                          workspaceRoot={target?.workspaceRoot ?? workspaceRoot}
                          previewErrorMessage={t('writePreviewErrorFallback')}
                        />
                      </div>
                    </div>
                  ) : null}
                  {showHtmlPreview ? (
                    <div
                      className="relative min-h-0 flex-1 overflow-auto bg-white"
                      onWheelCapture={handlePreviewZoomWheel}
                    >
                      {htmlPreviewLoading ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white text-[12px] text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                          {t('filePreviewHtmlLoading')}
                        </div>
                      ) : null}
                      {htmlPreview && !htmlPreview.ok ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-6 text-red-700">
                          {htmlPreview.message}
                        </div>
                      ) : htmlPreview?.ok ? (
                        <div className="h-full min-h-full w-full min-w-full" style={previewZoomStyle}>
                          <iframe
                            key={htmlPreview.url}
                            src={htmlPreview.url}
                            title={fileNameFromPath(result.path)}
                            className="h-full w-full border-0 bg-white"
                            sandbox="allow-downloads allow-forms allow-modals allow-scripts"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="ds-file-preview-scroll min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[22px] text-ds-ink"
                onWheelCapture={handlePreviewZoomWheel}
              >
                <div
                  className="ds-file-preview-code-surface"
                  style={{ ...(codeSurfaceStyle ?? {}), ...previewZoomStyle }}
                >
                  {activeLine ? (
                    <div className="ds-file-preview-active-line" aria-hidden="true" />
                  ) : null}
                  <div className="ds-file-preview-gutter">
                    {lines.map((_, index) => {
                      const lineNo = index + 1
                      return (
                        <div
                          key={lineNo}
                          data-line={lineNo}
                          className={`ds-file-preview-line-number ${activeLine === lineNo ? 'is-active' : ''}`}
                        >
                          {lineNo}
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="ds-file-preview-code-html"
                    dangerouslySetInnerHTML={{ __html: highlightHtml }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-red-700 dark:text-red-300">
            {result?.message ?? t('filePreviewFailed')}
          </div>
        )}
      </div>
    </aside>
  )
}
