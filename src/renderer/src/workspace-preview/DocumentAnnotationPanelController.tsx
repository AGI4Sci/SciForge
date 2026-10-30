import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  pdfAnnotationSidecarSchema,
  type PdfAnchor,
  type PdfAnnotation,
  type PdfAnnotationSidecar
} from '@shared/pdf-annotations'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import type { WorkspacePreviewApplyEditResult } from '@shared/sciforge-api'
import type { PdfReviewSelection } from '@shared/pdf-review'
import {
  WritePdfAnnotationsPanel,
  type WritePdfAnnotationDisplayMode,
  type WritePdfQuestionAssistantReply,
  type WritePdfQuestionTurn
} from '../components/write/WritePdfAnnotationsPanel'
import type {
  WritePdfSelection,
  WritePdfSelectionPageRect
} from '../components/write/WritePdfViewer'
import type {
  WritePdfAnnotationOverlay
} from '../components/write/WritePdfViewer'
import type {
  PdfAnnotationThreadSummary
} from '../write/pdf-annotations'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import {
  createAnnotationBodyUpdateOperation,
  createAnnotationThreadDeleteOperation,
  createAnnotationThreadStatusOperation,
  createDocumentAnnotationNavigationRequest,
  createPdfAnnotationOverlaysFromSidecar,
  createTextAnnotationOverlaysFromSidecar
} from './document-annotation-operations'
import type {
  DocumentKind,
  DocumentNavigationRequest,
  DocumentTextAnnotationOverlay
} from './document-annotation-types'

const ANNOTATION_LIST_OPERATION_ID = 'workspace-preview.annotations.list'
const ANNOTATION_IMPORT_OPERATION_ID = 'workspace-preview.annotations.import'
const ANNOTATION_REVIEW_GENERATE_OPERATION_ID = 'workspace-preview.annotations.review.generate'
const ANNOTATION_REVIEW_IMPROVE_OPERATION_ID = 'workspace-preview.annotations.review.improve'
const ANNOTATION_PANEL_WIDTH_KEY = 'sciforge.workspacePreview.annotationPanelWidth'
const ANNOTATION_PANEL_DEFAULT_WIDTH = 360
const ANNOTATION_PANEL_MIN_WIDTH = 300
const ANNOTATION_PANEL_HARD_MIN_WIDTH = 220
const ANNOTATION_PANEL_MAX_WIDTH = 720
const DOCUMENT_PANEL_MIN_WIDTH = 320
const ANNOTATION_PANEL_RESIZE_HANDLE_WIDTH = 7
const ANNOTATION_PANEL_KEYBOARD_RESIZE_STEP = 24

export function resolveDocumentAnnotationOverlayState(input: {
  displayMode: WritePdfAnnotationDisplayMode
  selectedThreadId?: string | null
  hoveredThreadId?: string | null
}): {
  activeThreadId: string | null
  overlayThreadId: string | null
} {
  const activeThreadId = input.selectedThreadId?.trim() || input.hoveredThreadId?.trim() || null
  return {
    activeThreadId,
    overlayThreadId: input.displayMode === 'current' ? activeThreadId : null
  }
}

function readStoredAnnotationPanelWidth(): number {
  const raw = readBrowserStorageItem(ANNOTATION_PANEL_WIDTH_KEY)
  if (raw == null) return ANNOTATION_PANEL_DEFAULT_WIDTH
  const stored = Number(raw)
  if (!Number.isFinite(stored)) return ANNOTATION_PANEL_DEFAULT_WIDTH
  return Math.round(Math.min(
    ANNOTATION_PANEL_MAX_WIDTH,
    Math.max(ANNOTATION_PANEL_HARD_MIN_WIDTH, stored)
  ))
}

export function fitDocumentAnnotationPanelWidth(
  containerWidth: number,
  requestedWidth: number
): number {
  const availableWidth = Math.max(
    0,
    Math.round(containerWidth) - ANNOTATION_PANEL_RESIZE_HANDLE_WIDTH
  )
  if (availableWidth === 0) return ANNOTATION_PANEL_HARD_MIN_WIDTH

  const hardMinimum = Math.min(ANNOTATION_PANEL_HARD_MIN_WIDTH, availableWidth)
  const maximum = Math.min(
    ANNOTATION_PANEL_MAX_WIDTH,
    Math.max(hardMinimum, availableWidth - DOCUMENT_PANEL_MIN_WIDTH)
  )
  const minimum = Math.min(
    ANNOTATION_PANEL_MIN_WIDTH,
    maximum
  )

  return Math.round(Math.min(maximum, Math.max(minimum, requestedWidth)))
}

export type DocumentAnnotationPanelRenderInput = {
  pdf: {
    annotationOverlays: WritePdfAnnotationOverlay[]
    activeAnnotationId: string | null
    annotationsOpen: boolean
    jumpToRect: WritePdfSelectionPageRect | null
    onApplyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
    onSelectionChange: (selection: WritePdfSelection) => void
    onAnnotationSelect: (threadId: string) => void
    onOpenAnnotations: (selection: WritePdfSelection | null) => void
    onToggleAnnotations: () => void
  }
  text: {
    annotationOverlays: DocumentTextAnnotationOverlay[]
    activeAnnotationId: string | null
    annotationsOpen: boolean
    navigationRequest: DocumentNavigationRequest | null
    onApplyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
    onAnnotationSelect: (threadId: string) => void
    onToggleAnnotations: () => void
  }
  sidecar: PdfAnnotationSidecar | null
  panelOpen: boolean
}

export type DocumentAnnotationQuestionSideBlock = {
  id: string
  kind: string
  text?: string
  meta?: {
    displayText?: string
  }
  createdAt?: string
}

export type DocumentAnnotationQuestionSideConversation = {
  threadId: string
  source?: string
  blocks: DocumentAnnotationQuestionSideBlock[]
  liveAssistant: string
  busy: boolean
  error?: string | null
}

export type DocumentAnnotationQuestionBridge = {
  sideConversations: Record<string, DocumentAnnotationQuestionSideConversation | undefined>
  spawnSideConversation: (
    seedText: string,
    options: {
      source: 'pdf_annotation'
      title: string
      openPanel: boolean
      displayText: string
    }
  ) => Promise<string | null>
  sendSideMessage: (
    sideId: string,
    text: string,
    overrides?: { displayText?: string }
  ) => Promise<boolean>
}

export type DocumentAnnotationPanelControllerProps = {
  context: WorkspacePreviewPanelShellContext
  observation?: WorkspaceObservation | null
  documentKind: DocumentKind
  className?: string
  questionBridge?: DocumentAnnotationQuestionBridge
  renderDocument: (input: DocumentAnnotationPanelRenderInput) => ReactElement
}

export function DocumentAnnotationPanelController({
  context,
  observation,
  documentKind,
  className = '',
  questionBridge,
  renderDocument
}: DocumentAnnotationPanelControllerProps): ReactElement {
  const { t } = useTranslation('common')
  const [sidecar, setSidecar] = useState<PdfAnnotationSidecar | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [navigationRequest, setNavigationRequest] = useState<DocumentNavigationRequest | null>(null)
  const navigationSequenceRef = useRef(0)
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<WritePdfAnnotationDisplayMode>('current')
  const [loadingSidecar, setLoadingSidecar] = useState(false)
  const [exportingPackage, setExportingPackage] = useState(false)
  const [importingPackage, setImportingPackage] = useState(false)
  const [pdfReviewSelection, setPdfReviewSelection] = useState<WritePdfSelection | null>(null)
  const [pdfReviewGenerating, setPdfReviewGenerating] = useState(false)
  const [pdfReviewImprovingThreadId, setPdfReviewImprovingThreadId] = useState<string | null>(null)
  const [pdfReviewNotice, setPdfReviewNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [annotationNotice, setAnnotationNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [annotationPanelWidth, setAnnotationPanelWidth] = useState(readStoredAnnotationPanelWidth)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const controllerRef = useRef<HTMLDivElement | null>(null)
  const loadSidecarRef = useRef<(() => Promise<boolean>) | null>(null)
  const attemptedTurnPersistenceKeysRef = useRef(new Set<string>())
  const sessionId = context.state.session?.id ?? null
  const path = observation?.file.path ?? context.state.session?.path ?? ''
  const operationIds = context.state.capability?.operations.map((operation) => operation.id) ?? []
  const canReadSidecar = Boolean(
    sessionId &&
    operationIds.includes(ANNOTATION_LIST_OPERATION_ID)
  )
  const canImportSidecar = Boolean(
    documentKind === 'pdf' &&
    sessionId &&
    operationIds.includes(ANNOTATION_IMPORT_OPERATION_ID)
  )
  const canGeneratePdfReview = Boolean(
    documentKind === 'pdf' &&
    sessionId &&
    operationIds.includes(ANNOTATION_REVIEW_GENERATE_OPERATION_ID)
  )
  const canImprovePdfReview = Boolean(
    documentKind === 'pdf' &&
    sessionId &&
    operationIds.includes(ANNOTATION_REVIEW_IMPROVE_OPERATION_ID)
  )
  const pdfReviewHasSelection = Boolean(pdfReviewSelection && (pdfReviewSelection.text.trim() || pdfReviewSelection.rects?.length))
  const pdfReviewSelectionLabel = pdfReviewHasSelection
    ? `${pdfReviewSelection?.text.trim().length || pdfReviewSelection?.rects?.length || 0}${pdfReviewSelection?.text.trim() ? ' chars' : ' regions'}`
    : 'No selection'

  const loadSidecar = useCallback(async (): Promise<boolean> => {
    if (!sessionId || !canReadSidecar) return false
    setLoadingSidecar(true)
    try {
      const result = await context.host.listAnnotations(sessionId)
      if (!result.ok) {
        setAnnotationNotice({ tone: 'error', message: result.message })
        return false
      }
      const parsed = pdfAnnotationSidecarSchema.safeParse(result.sidecar)
      if (parsed.success) {
        setSidecar(parsed.data)
        setAnnotationNotice(null)
        return true
      }
      return false
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setLoadingSidecar(false)
    }
  }, [canReadSidecar, context.host, sessionId])

  useEffect(() => {
    loadSidecarRef.current = loadSidecar
  }, [loadSidecar])

  useEffect(() => {
    setSidecar(null)
    setSelectedThreadId(null)
    setNavigationRequest(null)
    setHoveredThreadId(null)
    setPdfReviewSelection(null)
    setPdfReviewNotice(null)
    setAnnotationNotice(null)
    setPanelOpen(false)
    if (canReadSidecar) void loadSidecarRef.current?.()
  }, [canReadSidecar, path, sessionId])

  useEffect(() => {
    attemptedTurnPersistenceKeysRef.current.clear()
  }, [path, sessionId])

  useEffect(() => {
    writeBrowserStorageItem(
      ANNOTATION_PANEL_WIDTH_KEY,
      String(Math.round(annotationPanelWidth))
    )
  }, [annotationPanelWidth])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    const fitToController = (): void => {
      setAnnotationPanelWidth((current) =>
        fitDocumentAnnotationPanelWidth(controller.clientWidth, current)
      )
    }
    fitToController()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitToController)
      return () => window.removeEventListener('resize', fitToController)
    }
    const observer = new ResizeObserver(fitToController)
    observer.observe(controller)
    return () => observer.disconnect()
  }, [])

  const { activeThreadId, overlayThreadId } = resolveDocumentAnnotationOverlayState({
    displayMode,
    selectedThreadId,
    hoveredThreadId
  })
  const pdfAnnotationOverlays = useMemo(() => createPdfAnnotationOverlaysFromSidecar(sidecar, {
    displayMode,
    activeThreadId: overlayThreadId
  }), [displayMode, overlayThreadId, sidecar])
  const textAnnotationOverlays = useMemo(() => createTextAnnotationOverlaysFromSidecar(sidecar, {
    displayMode,
    activeThreadId: overlayThreadId
  }), [displayMode, overlayThreadId, sidecar])
  const jumpToRect = navigationRequest?.pageRect ?? null

  const clearPdfReviewNotice = useCallback((): void => {
    setPdfReviewNotice(null)
  }, [])

  const rememberPdfReviewSelection = useCallback((selection: WritePdfSelection): void => {
    if (selection.text.trim() || selection.rects?.length) {
      clearPdfReviewNotice()
      setPdfReviewSelection(selection)
    }
  }, [clearPdfReviewNotice])

  const openPanel = useCallback((selection?: WritePdfSelection | null): void => {
    clearPdfReviewNotice()
    if (selection) rememberPdfReviewSelection(selection)
    setPanelOpen(true)
    if (!sidecar && canReadSidecar) void loadSidecar()
  }, [canReadSidecar, clearPdfReviewNotice, loadSidecar, rememberPdfReviewSelection, sidecar])

  const togglePanel = useCallback((): void => {
    setPanelOpen((open) => {
      const next = !open
      if (next && !sidecar && canReadSidecar) void loadSidecar()
      return next
    })
  }, [canReadSidecar, loadSidecar, sidecar])

  const selectThread = useCallback((threadId: string): void => {
    setSelectedThreadId(threadId)
    setNavigationRequest(null)
    setPanelOpen(true)
  }, [])

  const locateThread = useCallback((threadId: string): void => {
    setSelectedThreadId(threadId)
    setDisplayMode((current) => current === 'hidden' ? 'current' : current)
    navigationSequenceRef.current += 1
    setNavigationRequest(createDocumentAnnotationNavigationRequest(
      sidecar,
      threadId,
      `document-locate-${navigationSequenceRef.current}`
    ))
    setPanelOpen(true)
  }, [sidecar])

  const mutateAnnotationOperation = useCallback(async (
    operation: WorkspacePreviewEditOperation | null
  ): Promise<boolean> => {
    if (!operation) return false
    try {
      const result = operation.kind === 'annotation.upsert'
        ? await context.host.updateAnnotation({
            annotationId: operation.annotationId,
            annotationKind: operation.annotationKind,
            body: operation.body,
            ...(operation.target ? { target: operation.target } : {})
          })
        : operation.kind === 'annotation.thread.update' && operation.patch.status !== undefined
          ? await context.host.resolveAnnotation({
              threadId: operation.threadId,
              resolved: operation.patch.status === 'resolved'
            })
          : operation.kind === 'annotation.thread.delete'
            ? await context.host.deleteAnnotation({
                threadId: operation.threadId,
                pruneOrphanAnchors: operation.pruneOrphanAnchors
              })
            : { ok: false as const, message: 'Unsupported document annotation mutation.' }
      if (!result.ok) {
        setAnnotationNotice({ tone: 'error', message: result.message })
        return false
      }
      setAnnotationNotice(null)
      return true
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }, [context.host])

  const applyAnnotationOperation = useCallback(async (
    operation: WorkspacePreviewEditOperation | null,
    options: { revealThread?: boolean } = {}
  ): Promise<boolean> => {
    if (!operation || !await mutateAnnotationOperation(operation)) return false
    try {
      const sidecarLoaded = await loadSidecar()
      const threadId = annotationThreadIdFromOperation(operation)
      if (threadId && options.revealThread) {
        setSelectedThreadId(threadId)
        setNavigationRequest(null)
        setPanelOpen(true)
      }
      if (sidecarLoaded) setAnnotationNotice(null)
      return sidecarLoaded
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }, [loadSidecar, mutateAnnotationOperation])

  const applyPreviewOperation = useCallback(async (operation: WorkspacePreviewEditOperation): Promise<void> => {
    if (isAnnotationEditOperation(operation)) {
      await applyAnnotationOperation(operation, { revealThread: true })
      return
    }
    let result: WorkspacePreviewApplyEditResult
    try {
      result = await context.host.applyEdit(operation)
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
    if (!result.ok) {
      setAnnotationNotice({ tone: 'error', message: result.message })
      throw new Error(result.message)
    }
    try {
      await context.host.observe(result.session.id)
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
    setAnnotationNotice(null)
  }, [applyAnnotationOperation, context.host])

  const questionReplies = useMemo<Record<string, WritePdfQuestionAssistantReply>>(() => {
    if (!sidecar || !questionBridge) return {}
    const replies: Record<string, WritePdfQuestionAssistantReply> = {}
    for (const thread of sidecar.threads) {
      if (thread.kind !== 'question' || !thread.sourceMessageId) continue
      const side = questionBridge.sideConversations[thread.sourceMessageId]
      if (!side || side.source !== 'pdf_annotation') continue
      replies[thread.id] = {
        text: assistantTextAfterLatestUser(side.blocks, side.liveAssistant),
        busy: side.busy,
        error: side.error ?? null,
        sideThreadId: side.threadId,
        turns: questionTurnsFromSide(side)
      }
    }
    return replies
  }, [questionBridge, sidecar])

  const askQuestion = useCallback(async (
    threadId: string,
    question: string,
    summary: PdfAnnotationThreadSummary,
    options?: { intent?: 'question' | 'translate' }
  ): Promise<void> => {
    try {
      const trimmed = question.trim()
      if (!trimmed) return
      if (!path || !sidecar || !questionBridge) {
        setAnnotationNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
        return
      }
      const existingSideThreadId = summary.thread.sourceMessageId
      const existingSide = existingSideThreadId ? questionBridge.sideConversations[existingSideThreadId] : undefined
      const prompt = buildAnnotationQuestionPrompt({
        question: trimmed,
        summary,
        documentPath: path,
        workspaceRoot: observation?.file.workspaceRoot ?? context.state.session?.workspaceRoot ?? '',
        documentKind,
        intent: options?.intent,
        previousDiscussion: existingSide || !summary.thread.sourceMessageId ? '' : previousDiscussionForAnnotationThread(summary)
      })
      const title = `${documentKind === 'pdf' ? 'PDF' : documentKind === 'docx' ? 'DOCX' : 'Markdown'}: ${clipInlineText(trimmed, 48)}`
      const sideThreadId = existingSide
        ? existingSide.threadId
        : await questionBridge.spawnSideConversation(prompt, {
            source: 'pdf_annotation',
            title,
            openPanel: false,
            displayText: trimmed
          })
      if (!sideThreadId) {
        setAnnotationNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
        return
      }
      if (existingSide) {
        const sent = await questionBridge.sendSideMessage(existingSide.threadId, prompt, {
          displayText: trimmed
        })
        if (!sent) {
          setAnnotationNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
          return
        }
      }

      const questionAnnotation =
        summary.annotations.find((annotation) => annotation.kind === 'question') ??
        summary.firstAnnotation
      const operation = createQuestionAnnotationUpsertOperation({
        path,
        documentKind,
        summary,
        annotation: questionAnnotation,
        body: trimmed,
        sideThreadId
      })
      const applied = await applyAnnotationOperation(operation, { revealThread: true })
      if (!applied) return
      setAnnotationNotice(null)
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [applyAnnotationOperation, context.state.session?.workspaceRoot, documentKind, observation?.file.workspaceRoot, path, questionBridge, sidecar, t])

  useEffect(() => {
    if (!sidecar || !questionBridge || !path) return
    let cancelled = false
    const persist = async (): Promise<void> => {
      let changed = false
      for (const thread of sidecar.threads) {
        if (cancelled || thread.kind !== 'question' || !thread.sourceMessageId) continue
        const side = questionBridge.sideConversations[thread.sourceMessageId]
        if (!side || side.source !== 'pdf_annotation') continue
        if (side.busy) continue
        const turns = sideBlockTurns(side)
        for (const turn of turns) {
          if (cancelled) return
          const operation = createTurnPersistenceOperation({
            path,
            documentKind,
            sidecar,
            threadId: thread.id,
            sideThreadId: side.threadId,
            turn
          })
          if (operation) {
            const persistenceKey = documentAnnotationPersistenceOperationKey(operation)
            if (attemptedTurnPersistenceKeysRef.current.has(persistenceKey)) continue
            attemptedTurnPersistenceKeysRef.current.add(persistenceKey)
            const persisted = await mutateAnnotationOperation(operation)
            if (!persisted) attemptedTurnPersistenceKeysRef.current.delete(persistenceKey)
            changed = persisted || changed
          }
        }
      }
      if (changed && !cancelled) await loadSidecar()
    }
    void persist()
    return () => {
      cancelled = true
    }
  }, [documentKind, loadSidecar, mutateAnnotationOperation, path, questionBridge, sidecar])

  const resolveThread = useCallback((threadId: string): void => {
    if (!path) return
    void applyAnnotationOperation(createAnnotationThreadStatusOperation({
      path,
      threadId,
      status: 'resolved'
    }))
  }, [applyAnnotationOperation, path])

  const reopenThread = useCallback((threadId: string): void => {
    if (!path) return
    void applyAnnotationOperation(createAnnotationThreadStatusOperation({
      path,
      threadId,
      status: 'open'
    }))
  }, [applyAnnotationOperation, path])

  const deleteThread = useCallback((threadId: string): void => {
    if (!path) return
    void applyAnnotationOperation(createAnnotationThreadDeleteOperation({ path, threadId }))
    setSelectedThreadId((current) => current === threadId ? null : current)
    setNavigationRequest((current) => current?.threadId === threadId ? null : current)
    setHoveredThreadId((current) => current === threadId ? null : current)
  }, [applyAnnotationOperation, path])

  const editAnnotation = useCallback((annotationId: string, body: string): void => {
    if (!path || !sidecar) return
    void applyAnnotationOperation(createAnnotationBodyUpdateOperation({
      path,
      sidecar,
      annotationId,
      body
    }))
  }, [applyAnnotationOperation, path, sidecar])

  const hoverThread = useCallback((threadId: string | null): void => {
    setHoveredThreadId((current) => current === threadId ? current : threadId)
  }, [])

  const closePanel = useCallback((): void => {
    setHoveredThreadId(null)
    setPanelOpen(false)
  }, [])

  const generatePdfReview = useCallback(async (input: {
    scope: 'document' | 'selection'
    maxComments: number
    prompt: string
  }): Promise<void> => {
    if (!sessionId || !canGeneratePdfReview) return
    const selection = input.scope === 'selection'
      ? pdfReviewSelectionForAction(pdfReviewSelection)
      : undefined
    if (input.scope === 'selection' && !selection) {
      setPdfReviewNotice({ tone: 'error', message: 'Select text or a region in the PDF before reviewing a selection.' })
      return
    }

    setPdfReviewGenerating(true)
    setPdfReviewNotice(null)
    try {
      const result = await context.host.generateAnnotationReview({
        maxComments: input.maxComments,
        prompt: input.prompt,
        replaceExisting: input.scope === 'document',
        ...(selection ? { selection } : {})
      })
      if (!result.ok) {
        setPdfReviewNotice({ tone: 'error', message: result.message })
        return
      }
      const nextSidecar = pdfAnnotationSidecarSchema.parse(result.sidecar)
      if (nextSidecar) {
        setSidecar(nextSidecar)
        const firstReviewThread = nextSidecar.threads.find((thread) => thread.id.startsWith('sciforge-review-thread-'))
        setSelectedThreadId(firstReviewThread?.id ?? selectedThreadId)
        setNavigationRequest(null)
      }
      await context.host.observe(sessionId)
      setDisplayMode('all')
      setPanelOpen(true)
      setPdfReviewNotice({ tone: 'success', message: `SciForge generated ${result.commentCount} PDF review comments.` })
    } catch (error) {
      setPdfReviewNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setPdfReviewGenerating(false)
    }
  }, [canGeneratePdfReview, context.host, pdfReviewSelection, selectedThreadId, sessionId])

  const improvePdfReviewAnnotation = useCallback(async (
    threadId: string,
    summary: PdfAnnotationThreadSummary
  ): Promise<void> => {
    if (!sessionId || !canImprovePdfReview) return
    const annotationId = summary.firstAnnotation?.id
    if (!annotationId) {
      setPdfReviewNotice({ tone: 'error', message: 'Select an annotation before asking SciForge for improvement advice.' })
      return
    }

    setPdfReviewImprovingThreadId(threadId)
    setPdfReviewNotice(null)
    try {
      const result = await context.host.improveAnnotationReview({
        threadId,
        annotationId
      })
      if (!result.ok) {
        setPdfReviewNotice({ tone: 'error', message: result.message })
        return
      }
      const nextSidecar = pdfAnnotationSidecarSchema.parse(result.sidecar)
      if (nextSidecar) setSidecar(nextSidecar)
      await context.host.observe(sessionId)
      setSelectedThreadId(threadId)
      setNavigationRequest(null)
      setPanelOpen(true)
      setPdfReviewNotice({ tone: 'success', message: 'SciForge added improvement advice to the selected comment.' })
    } catch (error) {
      setPdfReviewNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setPdfReviewImprovingThreadId(null)
    }
  }, [canImprovePdfReview, context.host, sessionId])

  const exportPackage = useCallback(async (): Promise<void> => {
    setExportingPackage(true)
    try {
      await context.host.export({
        kind: 'workspace-file',
        format: 'sidecar'
      })
    } finally {
      setExportingPackage(false)
    }
  }, [context.host])

  const importPackage = useCallback((): void => {
    if (!canImportSidecar || importingPackage) return
    importInputRef.current?.click()
  }, [canImportSidecar, importingPackage])

  const importSelectedPackage = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    if (!file || !sessionId || !canImportSidecar) return
    setImportingPackage(true)
    try {
      const packageBase64 = await readBrowserFileBase64(file)
      const result = await context.host.importAnnotations({ packageBase64 }, sessionId)
      if (result.ok) {
        await context.host.observe(sessionId)
        await loadSidecar()
        setPanelOpen(true)
      }
    } finally {
      setImportingPackage(false)
    }
  }, [canImportSidecar, context.host, loadSidecar, sessionId])

  const resizeAnnotationPanelBy = useCallback((delta: number): void => {
    const controllerWidth = controllerRef.current?.clientWidth
    if (!controllerWidth) return
    setAnnotationPanelWidth((current) =>
      fitDocumentAnnotationPanelWidth(controllerWidth, current + delta)
    )
  }, [])

  const beginAnnotationPanelResize = useCallback((
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const controller = controllerRef.current
    if (!controller) return
    const startX = event.clientX
    const startWidth = annotationPanelWidth
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Pointer capture can fail if the pointer was already released.
    }
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      setAnnotationPanelWidth(fitDocumentAnnotationPanelWidth(
        controller.clientWidth,
        startWidth + startX - moveEvent.clientX
      ))
    }
    const onEnd = (): void => {
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      } catch {
        // The browser may release capture before cleanup runs.
      }
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }, [annotationPanelWidth])

  const resizeAnnotationPanelWithKeyboard = useCallback((
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      resizeAnnotationPanelBy(event.shiftKey
        ? ANNOTATION_PANEL_KEYBOARD_RESIZE_STEP * 2
        : ANNOTATION_PANEL_KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      resizeAnnotationPanelBy(event.shiftKey
        ? ANNOTATION_PANEL_KEYBOARD_RESIZE_STEP * -2
        : -ANNOTATION_PANEL_KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      resizeAnnotationPanelBy(ANNOTATION_PANEL_HARD_MIN_WIDTH - annotationPanelWidth)
    } else if (event.key === 'End') {
      event.preventDefault()
      resizeAnnotationPanelBy(ANNOTATION_PANEL_MAX_WIDTH - annotationPanelWidth)
    }
  }, [annotationPanelWidth, resizeAnnotationPanelBy])

  return (
    <div
      ref={controllerRef}
      className={`flex h-full min-h-0 ${className}`}
      data-document-annotation-controller
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".zip,.dsgui-pdf.zip,application/zip"
        className="hidden"
        onChange={(event) => void importSelectedPackage(event)}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="min-w-0 flex-1">
        {renderDocument({
          pdf: {
            annotationOverlays: pdfAnnotationOverlays,
            activeAnnotationId: activeThreadId,
            annotationsOpen: panelOpen,
            jumpToRect,
            onApplyEdit: applyPreviewOperation,
            onSelectionChange: rememberPdfReviewSelection,
            onAnnotationSelect: selectThread,
            onOpenAnnotations: openPanel,
            onToggleAnnotations: togglePanel
          },
          text: {
            annotationOverlays: textAnnotationOverlays,
            activeAnnotationId: activeThreadId,
            annotationsOpen: panelOpen,
            navigationRequest,
            onApplyEdit: applyPreviewOperation,
            onAnnotationSelect: selectThread,
            onToggleAnnotations: togglePanel
          },
          sidecar,
          panelOpen
        })}
      </div>
      {panelOpen ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('writePdfAnnotationsResize')}
            aria-valuemin={ANNOTATION_PANEL_HARD_MIN_WIDTH}
            aria-valuemax={ANNOTATION_PANEL_MAX_WIDTH}
            aria-valuenow={annotationPanelWidth}
            tabIndex={0}
            className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
            data-document-annotation-panel-resizer
            onPointerDown={beginAnnotationPanelResize}
            onKeyDown={resizeAnnotationPanelWithKeyboard}
          />
          <div
            className="h-full min-h-0 shrink-0"
            style={{ width: annotationPanelWidth }}
            data-document-annotation-panel-width={annotationPanelWidth}
          >
            <WritePdfAnnotationsPanel
              sidecar={sidecar}
              documentKind={documentKind}
              selectedThreadId={selectedThreadId}
              annotationDisplayMode={displayMode}
              exportingPackage={exportingPackage}
              importingPackage={importingPackage}
              reloadingSidecar={loadingSidecar}
              className="h-full w-full"
              onAnnotationDisplayModeChange={setDisplayMode}
              onLocateThread={locateThread}
              onHoverThread={hoverThread}
              onResolveThread={resolveThread}
              onReopenThread={reopenThread}
              onDeleteThread={deleteThread}
              onEditAnnotation={editAnnotation}
              onAskQuestion={questionBridge ? askQuestion : undefined}
              questionReplies={questionReplies}
              pdfReviewAvailable={canGeneratePdfReview}
              pdfReviewHasSelection={pdfReviewHasSelection}
              pdfReviewSelectionLabel={pdfReviewSelectionLabel}
              pdfReviewGenerating={pdfReviewGenerating}
              pdfReviewImprovingThreadId={pdfReviewImprovingThreadId}
              pdfReviewNotice={pdfReviewNotice}
              notice={annotationNotice}
              onClearPdfReviewNotice={clearPdfReviewNotice}
              onGeneratePdfReview={generatePdfReview}
              onImproveAnnotation={canImprovePdfReview ? improvePdfReviewAnnotation : undefined}
              onExportPackage={documentKind === 'pdf' ? exportPackage : undefined}
              onImportPackage={canImportSidecar ? importPackage : undefined}
              onReloadSidecar={loadSidecar}
              onCollapse={closePanel}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

type AnnotationQuestionTurn = {
  blockId: string
  sourceMessageId: string
  kind: 'question' | 'answer'
  role: 'user' | 'assistant'
  text: string
  createdAt?: string
}

function sideBlockSourceMessageId(sideThreadId: string, blockId: string): string {
  return `${sideThreadId}:${blockId}`
}

export function documentAnnotationSideBlockText(block: DocumentAnnotationQuestionSideBlock): string {
  if (block.kind === 'user') {
    return block.meta?.displayText?.trim() || block.text?.trim() || ''
  }
  return block.text?.trim() || ''
}

function sideBlockTurns(side: DocumentAnnotationQuestionSideConversation): AnnotationQuestionTurn[] {
  return side.blocks
    .filter((block) => (block.kind === 'user' || block.kind === 'assistant') && Boolean(documentAnnotationSideBlockText(block)))
    .map((block) => ({
      blockId: block.id,
      sourceMessageId: sideBlockSourceMessageId(side.threadId, block.id),
      kind: block.kind === 'user' ? 'question' : 'answer',
      role: block.kind === 'user' ? 'user' : 'assistant',
      text: documentAnnotationSideBlockText(block),
      ...(block.createdAt ? { createdAt: block.createdAt } : {})
    }))
}

function questionTurnsFromSide(side: DocumentAnnotationQuestionSideConversation): WritePdfQuestionTurn[] {
  const turns: WritePdfQuestionTurn[] = sideBlockTurns(side).map((turn) => ({
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

function assistantTextAfterLatestUser(
  blocks: readonly DocumentAnnotationQuestionSideBlock[],
  liveAssistant: string
): string {
  let lastUserIndex = -1
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === 'user') {
      lastUserIndex = index
      break
    }
  }
  const assistantBlocks = blocks
    .slice(lastUserIndex + 1)
    .filter((block) => block.kind === 'assistant' && Boolean(block.text?.trim()))
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
  const live = liveAssistant.trim()
  return [...assistantBlocks, ...(live ? [live] : [])].join('\n\n').trim()
}

function previousDiscussionForAnnotationThread(summary: PdfAnnotationThreadSummary): string {
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

function buildAnnotationQuestionPrompt(input: {
  question: string
  summary: PdfAnnotationThreadSummary
  documentPath: string
  workspaceRoot: string
  documentKind: DocumentKind
  intent?: 'question' | 'translate'
  previousDiscussion?: string
}): string {
  const documentLabel = input.documentKind === 'pdf'
    ? 'PDF'
    : input.documentKind === 'docx'
      ? 'DOCX document'
      : 'Markdown document'
  const pageRange = input.documentKind === 'pdf' ? pageRangeText(input.summary) : ''
  const quote = input.summary.anchors
    .map((anchor) => anchor.quote.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  return [
    `You are answering a lightweight by-the-way ${documentLabel} question inside SciForge's right sidebar.`,
    `Answer directly in the right-sidebar style: concise, helpful, and grounded in the selected ${documentLabel} text.`,
    'Do not edit files, create tasks, or ask the user to switch threads.',
    input.intent === 'translate'
      ? 'The user chose the translation shortcut. Translate the selected text into the user\'s language, then briefly explain important domain terms.'
      : 'If the question cannot be answered from the selection alone, say what extra page or context is needed.',
    '',
    `${documentLabel} path: ${input.documentPath}`,
    input.workspaceRoot ? `Workspace: ${input.workspaceRoot}` : '',
    pageRange ? `Anchor: ${pageRange}` : '',
    quote ? `Selected ${documentLabel} text:\n"""\n${quote}\n"""` : `Selected ${documentLabel} region: visual/image anchor without extractable text.`,
    input.previousDiscussion ? `Previous discussion for this ${documentLabel} selection:\n${input.previousDiscussion}` : '',
    '',
    `User question:\n${input.question.trim()}`
  ].filter(Boolean).join('\n')
}

function createQuestionAnnotationUpsertOperation(input: {
  path: string
  documentKind: DocumentKind
  summary: PdfAnnotationThreadSummary
  annotation: PdfAnnotation | undefined
  body: string
  sideThreadId: string
}): WorkspacePreviewEditOperation | null {
  const anchor = input.summary.anchors[0]
  const targetAnchor = anchor && (!input.annotation || input.annotation.anchorId === anchor.id)
    ? annotationAnchorTarget(anchor)
    : null
  if (!input.annotation && !targetAnchor) return null
  return {
    kind: 'annotation.upsert',
    path: input.path,
    annotationId: input.annotation?.id ?? `annotation-question-${Date.now().toString(36)}`,
    annotationKind: 'question',
    body: input.body,
    target: {
      documentKind: input.documentKind,
      threadId: input.summary.thread.id,
      ...(targetAnchor ? { anchor: targetAnchor } : {}),
      thread: {
        kind: 'question',
        status: 'open',
        title: clipInlineText(input.body || input.summary.quote, 96),
        sourceMessageId: input.sideThreadId
      },
      annotation: {
        sourceText: input.summary.quote || input.annotation?.sourceText,
        sourceMessageId: input.sideThreadId
      }
    }
  }
}

function createTurnPersistenceOperation(input: {
  path: string
  documentKind: DocumentKind
  sidecar: PdfAnnotationSidecar
  threadId: string
  sideThreadId: string
  turn: AnnotationQuestionTurn
}): Extract<WorkspacePreviewEditOperation, { kind: 'annotation.upsert' }> | null {
  const thread = input.sidecar.threads.find((candidate) => candidate.id === input.threadId)
  if (!thread) return null
  const existing = findPersistedQuestionTurn(input.sidecar.annotations, input.threadId, input.sideThreadId, input.turn)
  if (existing && existing.kind === input.turn.kind && existing.body === input.turn.text && existing.sourceMessageId === input.turn.sourceMessageId) {
    return null
  }
  const anchor = input.sidecar.anchors.find((candidate) => thread.anchorIds.includes(candidate.id))
  const targetAnchor = anchor && (!existing || existing.anchorId === anchor.id)
    ? annotationAnchorTarget(anchor)
    : null
  if (!existing && !targetAnchor) return null
  const sourceText = anchor?.quote
  return {
    kind: 'annotation.upsert',
    path: input.path,
    annotationId: existing?.id ?? documentAnnotationTurnId({
      threadId: input.threadId,
      kind: input.turn.kind,
      sourceMessageId: input.turn.sourceMessageId
    }),
    annotationKind: input.turn.kind,
    body: input.turn.text,
    target: {
      documentKind: input.documentKind,
      threadId: input.threadId,
      ...(targetAnchor ? { anchor: targetAnchor } : {}),
      thread: {
        kind: 'question',
        sourceMessageId: input.sideThreadId
      },
      annotation: {
        ...(sourceText ? { sourceText } : {}),
        sourceMessageId: input.turn.sourceMessageId
      }
    }
  }
}

export function documentAnnotationTurnId(input: {
  threadId: string
  kind: 'question' | 'answer'
  sourceMessageId: string
}): string {
  const identity = `${input.threadId}:${input.sourceMessageId}`
  const readableIdentity = identity
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(-180)
  return [
    'annotation',
    input.kind,
    hashDocumentAnnotationIdentity(identity),
    readableIdentity
  ].filter(Boolean).join('-').slice(0, 256)
}

export function documentAnnotationPersistenceOperationKey(
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'annotation.upsert' }>
): string {
  return [
    operation.path,
    operation.annotationId,
    operation.annotationKind,
    operation.target?.threadId ?? '',
    operation.target?.annotation?.sourceMessageId ?? '',
    operation.body.length,
    hashDocumentAnnotationIdentity(operation.body)
  ].join('\u0000')
}

function hashDocumentAnnotationIdentity(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function findPersistedQuestionTurn(
  annotations: readonly PdfAnnotation[],
  threadId: string,
  sideThreadId: string,
  turn: AnnotationQuestionTurn
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

function annotationAnchorTarget(anchor: PdfAnchor): NonNullable<Extract<WorkspacePreviewEditOperation, { kind: 'annotation.upsert' }>['target']>['anchor'] {
  return {
    id: anchor.id,
    kind: anchor.kind,
    quote: anchor.quote,
    contextBefore: anchor.contextBefore,
    contextAfter: anchor.contextAfter,
    ...(anchor.textRange ? { textRange: anchor.textRange } : {}),
    pageStart: anchor.pageStart,
    pageEnd: anchor.pageEnd,
    rects: anchor.rects
  }
}

function pageRangeText(summary: PdfAnnotationThreadSummary): string {
  if (summary.pageStart == null || summary.pageEnd == null) return ''
  return summary.pageStart === summary.pageEnd
    ? `page ${summary.pageStart}`
    : `pages ${summary.pageStart}-${summary.pageEnd}`
}

function clipInlineText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`
}

function readBrowserFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read annotation package.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function pdfReviewSelectionForAction(selection: WritePdfSelection | null): PdfReviewSelection | null {
  if (!selection) return null
  const text = selection.text.trim()
  const rects = selection.rects?.length ? selection.rects : selection.metadata.rects
  if (!text && !rects?.length) return null
  const pageStart = selection.pageStart ?? selection.metadata.pageStart ?? rects?.[0]?.page
  const pageEnd = selection.pageEnd ?? selection.metadata.pageEnd ?? rects?.at(-1)?.page
  return {
    ...(text ? { text } : {}),
    ...(rects?.length ? { rects } : {}),
    ...(pageStart ? { pageStart } : {}),
    ...(pageEnd ? { pageEnd } : {})
  }
}

function isAnnotationEditOperation(operation: WorkspacePreviewEditOperation): boolean {
  return operation.kind === 'annotation.upsert' ||
    operation.kind === 'annotation.thread.update' ||
    operation.kind === 'annotation.thread.delete'
}

function annotationThreadIdFromOperation(operation: WorkspacePreviewEditOperation): string | null {
  if (operation.kind !== 'annotation.upsert') return null
  return operation.target?.threadId?.trim() || null
}
