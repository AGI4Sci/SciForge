import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
  WriteDocxAnnotationOverlay
} from '../components/write/WriteDocxViewer'
import type {
  PdfAnnotationThreadSummary
} from '../write/pdf-annotations'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import {
  createAnnotationBodyUpdateOperation,
  createAnnotationThreadDeleteOperation,
  createAnnotationThreadStatusOperation,
  createDocxAnnotationOverlaysFromSidecar,
  createPdfAnnotationOverlaysFromSidecar,
  firstPdfAnnotationThreadRect
} from './document-annotation-operations'

const ANNOTATION_LIST_OPERATION_ID = 'workspace-preview.annotations.list'
const ANNOTATION_REVIEW_GENERATE_OPERATION_ID = 'workspace-preview.annotations.review.generate'
const ANNOTATION_REVIEW_IMPROVE_OPERATION_ID = 'workspace-preview.annotations.review.improve'

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
  docx: {
    annotationOverlays: WriteDocxAnnotationOverlay[]
    activeAnnotationId: string | null
    onApplyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
    onAnnotationSelect: (threadId: string) => void
    onOpenAnnotations: () => void
  }
  sidecar: PdfAnnotationSidecar | null
  panelOpen: boolean
}

export type DocumentAnnotationQuestionSideBlock = {
  id: string
  kind: string
  text?: string
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
      allowStandalone: boolean
      standalone: boolean
    }
  ) => Promise<string | null>
  sendSideMessage: (sideId: string, text: string) => Promise<boolean>
}

export type DocumentAnnotationPanelControllerProps = {
  context: WorkspacePreviewPanelShellContext
  observation?: WorkspaceObservation | null
  documentKind: 'pdf' | 'docx'
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
  const [jumpRevision, setJumpRevision] = useState(0)
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
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const sessionId = context.state.session?.id ?? null
  const path = observation?.file.path ?? context.state.session?.path ?? ''
  const operationIds = context.state.capability?.operations.map((operation) => operation.id) ?? []
  const canReadSidecar = Boolean(
    sessionId &&
    observation?.documentAnnotations &&
    operationIds.includes(ANNOTATION_LIST_OPERATION_ID)
  )
  const canImportSidecar = Boolean(documentKind === 'pdf' && sessionId)
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
    setSidecar(null)
    setSelectedThreadId(null)
    setHoveredThreadId(null)
    setPdfReviewSelection(null)
    setPdfReviewNotice(null)
    setAnnotationNotice(null)
    setPanelOpen(false)
    if (canReadSidecar) void loadSidecar()
  }, [canReadSidecar, loadSidecar, path])

  const activeThreadId = selectedThreadId ?? hoveredThreadId
  const pdfAnnotationOverlays = useMemo(() => createPdfAnnotationOverlaysFromSidecar(sidecar, {
    displayMode,
    activeThreadId
  }), [activeThreadId, displayMode, sidecar])
  const docxAnnotationOverlays = useMemo(() => createDocxAnnotationOverlaysFromSidecar(sidecar, {
    displayMode,
    activeThreadId
  }), [activeThreadId, displayMode, sidecar])
  const jumpToRect = useMemo(() => {
    const rect = firstPdfAnnotationThreadRect(sidecar, selectedThreadId)
    return rect ? { ...rect, requestId: jumpRevision } : null
  }, [jumpRevision, selectedThreadId, sidecar])

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
    setJumpRevision((revision) => revision + 1)
    setPanelOpen(true)
  }, [])

  const applyAnnotationOperation = useCallback(async (
    operation: WorkspacePreviewEditOperation | null,
    options: { revealThread?: boolean } = {}
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
      await context.host.observe(result.session.id)
      const sidecarLoaded = await loadSidecar()
      const threadId = annotationThreadIdFromOperation(operation)
      if (threadId && options.revealThread) {
        setSelectedThreadId(threadId)
        setJumpRevision((revision) => revision + 1)
        setPanelOpen(true)
      }
      if (sidecarLoaded) setAnnotationNotice(null)
      return sidecarLoaded
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }, [context.host, loadSidecar])

  const applyPreviewOperation = useCallback(async (operation: WorkspacePreviewEditOperation): Promise<void> => {
    if (isAnnotationEditOperation(operation)) {
      await applyAnnotationOperation(operation, { revealThread: true })
      return
    }
    try {
      const result = await context.host.applyEdit(operation)
      if (!result.ok) {
        setAnnotationNotice({ tone: 'error', message: result.message })
        return
      }
      await context.host.observe(result.session.id)
      setAnnotationNotice(null)
    } catch (error) {
      setAnnotationNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }
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
      const title = `${documentKind === 'docx' ? 'DOCX' : 'PDF'}: ${clipInlineText(trimmed, 48)}`
      const sideThreadId = existingSide
        ? existingSide.threadId
        : await questionBridge.spawnSideConversation(prompt, {
            source: 'pdf_annotation',
            title,
            openPanel: false,
            allowStandalone: true,
            standalone: true
          })
      if (!sideThreadId) {
        setAnnotationNotice({ tone: 'error', message: t('writePdfAnnotationQuestionFailed') })
        return
      }
      if (existingSide) {
        const sent = await questionBridge.sendSideMessage(existingSide.threadId, prompt)
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
      for (const thread of sidecar.threads) {
        if (cancelled || thread.kind !== 'question' || !thread.sourceMessageId) continue
        const side = questionBridge.sideConversations[thread.sourceMessageId]
        if (!side || side.source !== 'pdf_annotation') continue
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
          if (operation) await applyAnnotationOperation(operation)
        }
      }
    }
    void persist()
    return () => {
      cancelled = true
    }
  }, [applyAnnotationOperation, documentKind, path, questionBridge, sidecar])

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
        setJumpRevision((revision) => revision + 1)
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
      setJumpRevision((revision) => revision + 1)
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

  return (
    <div className={`flex h-full min-h-0 ${className}`} data-document-annotation-controller>
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
          docx: {
            annotationOverlays: docxAnnotationOverlays,
            activeAnnotationId: activeThreadId,
            onApplyEdit: applyPreviewOperation,
            onAnnotationSelect: selectThread,
            onOpenAnnotations: openPanel
          },
          sidecar,
          panelOpen
        })}
      </div>
      {panelOpen ? (
        <WritePdfAnnotationsPanel
          sidecar={sidecar}
          documentKind={documentKind}
          selectedThreadId={selectedThreadId}
          annotationDisplayMode={displayMode}
          exportingPackage={exportingPackage}
          importingPackage={importingPackage}
          reloadingSidecar={loadingSidecar}
          className="w-[360px] shrink-0"
          onAnnotationDisplayModeChange={setDisplayMode}
          onSelectThread={selectThread}
          onHoverThread={(threadId) => setHoveredThreadId(threadId)}
          onResolveThread={(threadId: string, _summary: PdfAnnotationThreadSummary) => resolveThread(threadId)}
          onReopenThread={(threadId: string, _summary: PdfAnnotationThreadSummary) => reopenThread(threadId)}
          onDeleteThread={(threadId: string, _summary: PdfAnnotationThreadSummary) => deleteThread(threadId)}
          onEditAnnotation={(annotationId: string, body: string) => editAnnotation(annotationId, body)}
          onAskQuestion={questionBridge ? (threadId, question, summary, options) => {
            void askQuestion(threadId, question, summary, options)
          } : undefined}
          questionReplies={questionReplies}
          pdfReviewAvailable={canGeneratePdfReview}
          pdfReviewHasSelection={pdfReviewHasSelection}
          pdfReviewSelectionLabel={pdfReviewSelectionLabel}
          pdfReviewGenerating={pdfReviewGenerating}
          pdfReviewImprovingThreadId={pdfReviewImprovingThreadId}
          pdfReviewNotice={pdfReviewNotice}
          notice={annotationNotice}
          onClearPdfReviewNotice={clearPdfReviewNotice}
          onGeneratePdfReview={(input) => void generatePdfReview(input)}
          onImproveAnnotation={canImprovePdfReview ? (threadId, summary) => void improvePdfReviewAnnotation(threadId, summary) : undefined}
          onExportPackage={documentKind === 'pdf' ? () => void exportPackage() : undefined}
          onImportPackage={canImportSidecar ? importPackage : undefined}
          onReloadSidecar={() => void loadSidecar()}
          onCollapse={() => setPanelOpen(false)}
        />
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

function sideBlockTurns(side: DocumentAnnotationQuestionSideConversation): AnnotationQuestionTurn[] {
  return side.blocks
    .filter((block) => (block.kind === 'user' || block.kind === 'assistant') && Boolean(block.text?.trim()))
    .map((block) => ({
      blockId: block.id,
      sourceMessageId: sideBlockSourceMessageId(side.threadId, block.id),
      kind: block.kind === 'user' ? 'question' : 'answer',
      role: block.kind === 'user' ? 'user' : 'assistant',
      text: block.text?.trim() ?? '',
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
  documentKind: 'pdf' | 'docx'
  intent?: 'question' | 'translate'
  previousDiscussion?: string
}): string {
  const documentLabel = input.documentKind === 'docx' ? 'DOCX document' : 'PDF'
  const pageRange = pageRangeText(input.summary)
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
  documentKind: 'pdf' | 'docx'
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
  documentKind: 'pdf' | 'docx'
  sidecar: PdfAnnotationSidecar
  threadId: string
  sideThreadId: string
  turn: AnnotationQuestionTurn
}): WorkspacePreviewEditOperation | null {
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
    annotationId: existing?.id ?? `annotation-${input.turn.kind}-${input.turn.blockId}`,
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
