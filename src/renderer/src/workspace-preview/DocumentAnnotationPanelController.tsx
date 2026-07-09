import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement
} from 'react'
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

export type DocumentAnnotationPanelRenderInput = {
  pdf: {
    annotationOverlays: WritePdfAnnotationOverlay[]
    activeAnnotationId: string | null
    jumpToRect: WritePdfSelectionPageRect | null
    onAnnotationSelect: (threadId: string) => void
    onOpenAnnotations: (selection: WritePdfSelection | null) => void
  }
  docx: {
    annotationOverlays: WriteDocxAnnotationOverlay[]
    activeAnnotationId: string | null
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
  const [sidecar, setSidecar] = useState<PdfAnnotationSidecar | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<WritePdfAnnotationDisplayMode>('current')
  const [loadingSidecar, setLoadingSidecar] = useState(false)
  const [exportingPackage, setExportingPackage] = useState(false)
  const [importingPackage, setImportingPackage] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const sessionId = context.state.session?.id ?? null
  const path = observation?.file.path ?? context.state.session?.path ?? ''
  const canReadSidecar = Boolean(observation?.actions.includes('annotation.sidecar.read') && sessionId)
  const canImportSidecar = Boolean(documentKind === 'pdf' && observation?.actions.includes('annotation.sidecar.import') && sessionId)

  const loadSidecar = useCallback(async (): Promise<void> => {
    if (!sessionId || !canReadSidecar) return
    setLoadingSidecar(true)
    try {
      const result = await context.host.invokeAction(sessionId, {
        actionId: 'annotation.sidecar.read',
        input: {}
      })
      const nextSidecar = sidecarFromActionResult(result)
      if (nextSidecar) setSidecar(nextSidecar)
    } finally {
      setLoadingSidecar(false)
    }
  }, [canReadSidecar, context.host, sessionId])

  useEffect(() => {
    setSidecar(null)
    setSelectedThreadId(null)
    setHoveredThreadId(null)
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
  const jumpToRect = useMemo(() => firstPdfAnnotationThreadRect(sidecar, selectedThreadId), [selectedThreadId, sidecar])

  const openPanel = useCallback((): void => {
    setPanelOpen(true)
    if (!sidecar && canReadSidecar) void loadSidecar()
  }, [canReadSidecar, loadSidecar, sidecar])

  const selectThread = useCallback((threadId: string): void => {
    setSelectedThreadId(threadId)
    setPanelOpen(true)
  }, [])

  const applyAnnotationOperation = useCallback(async (operation: WorkspacePreviewEditOperation | null): Promise<void> => {
    if (!operation) return
    const result = await context.host.applyEdit(operation)
    if (!result.ok) return
    await context.host.observe(result.session.id)
    await loadSidecar()
  }, [context.host, loadSidecar])

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
    const trimmed = question.trim()
    if (!trimmed || !path || !sidecar || !questionBridge) return
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
    if (!sideThreadId) return
    if (existingSide) {
      const sent = await questionBridge.sendSideMessage(existingSide.threadId, prompt)
      if (!sent) return
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
    if (!operation) return
    await applyAnnotationOperation(operation)
  }, [applyAnnotationOperation, context.state.session?.workspaceRoot, documentKind, observation?.file.workspaceRoot, path, questionBridge, sidecar])

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
      const result = await context.host.invokeAction(sessionId, {
        actionId: 'annotation.sidecar.import',
        input: { packageBase64 }
      })
      if (result.ok) {
        await context.host.observe(result.sessionId)
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
            jumpToRect,
            onAnnotationSelect: selectThread,
            onOpenAnnotations: openPanel
          },
          docx: {
            annotationOverlays: docxAnnotationOverlays,
            activeAnnotationId: activeThreadId,
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
          onExportPackage={documentKind === 'pdf' ? () => void exportPackage() : undefined}
          onImportPackage={canImportSidecar ? importPackage : undefined}
          onReloadSidecar={() => void loadSidecar()}
          onCollapse={() => setPanelOpen(false)}
        />
      ) : null}
    </div>
  )
}

function sidecarFromActionResult(result: Awaited<ReturnType<WorkspacePreviewPanelShellContext['host']['invokeAction']>>): PdfAnnotationSidecar | null {
  if (!result.ok || !isRecord(result.result) || !isRecord(result.result.sidecar)) return null
  const parsed = pdfAnnotationSidecarSchema.safeParse(result.result.sidecar)
  return parsed.success ? parsed.data : null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
