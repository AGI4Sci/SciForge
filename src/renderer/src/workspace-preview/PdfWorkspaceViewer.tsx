import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import {
  WritePdfViewer
} from '../components/write/WritePdfViewer'
import type { WorkspacePreviewAssetTransportClient } from './host'
import {
  createPdfWorkspacePreviewAnnotationOperation
} from './document-annotation-operations'
import type {
  WritePdfAnnotationAction,
  WritePdfAnnotationOverlay,
  WritePdfSelection
} from '../components/write/WritePdfViewer'
import type {
  WritePdfSelectionPageRect
} from '../components/write/WritePdfViewer'

export const PDF_WORKSPACE_VIEWER_MAX_BYTES = WORKSPACE_PREVIEW_MAX_RANGE_BYTES

export type PdfWorkspaceViewerStatus =
  | {
      kind: 'ready'
      title: string
      message: string
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'unsupported'
      title: string
      message: string
    }

export type PdfWorkspaceViewerModel = {
  status: PdfWorkspaceViewerStatus
  title: string
  subtitle?: string
  fileSummary: string
  agentSummary: string
  mimeType?: string
}

export type PdfWorkspaceViewerPreviewState =
  | {
      kind: 'idle' | 'loading'
      title: string
      message: string
    }
  | {
      kind: 'ready'
      title: string
      message: string
      data?: Uint8Array
      sourceUrl?: string
      mimeType: string
      bytesRead?: number
    }
  | {
      kind: 'fallback' | 'error'
      title: string
      message: string
    }

export type PdfWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
  model?: PdfWorkspaceViewerModel
  previewState?: PdfWorkspaceViewerPreviewState
  className?: string
  visualContextComponentId?: string
  onApplyEdit?: (operation: WorkspacePreviewEditOperation) => Promise<void> | void
  annotationOverlays?: WritePdfAnnotationOverlay[]
  activeAnnotationId?: string | null
  annotationsOpen?: boolean
  jumpToRect?: WritePdfSelectionPageRect | null
  onSelectionChange?: (selection: WritePdfSelection) => void
  onAnnotationSelect?: (threadId: string) => void
  onOpenAnnotations?: (selection: WritePdfSelection | null) => void
  onToggleAnnotations?: () => void
}

export type PdfWorkspaceViewerLoadResult =
  | Extract<PdfWorkspaceViewerPreviewState, { kind: 'ready' }>
  | Extract<PdfWorkspaceViewerPreviewState, { kind: 'fallback' | 'error' }>

export function buildPdfWorkspaceViewerModel(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
}): PdfWorkspaceViewerModel {
  const { observation, asset } = input
  if (!observation) {
    return {
      status: {
        kind: 'empty',
        title: 'No PDF observation',
        message: 'Open a PDF workspace preview to populate this viewer.'
      },
      title: 'PDF viewer',
      fileSummary: 'No PDF selected',
      agentSummary: 'No PDF observation'
    }
  }

  const mimeType = resolvePdfMimeType({ observation, asset })
  if (!isPdfObservation({ observation, asset })) {
    const modality = formatLabel(observation.view.modality)
    return {
      status: {
        kind: 'unsupported',
        title: 'Unsupported observation',
        message: `${modality} observations cannot be rendered by the PDF viewer.`
      },
      title: observation.view.title || basename(observation.file.path),
      subtitle: compactStrings([
        observation.view.pluginId,
        formatLabel(observation.view.mode)
      ]).join(' | '),
      fileSummary: buildPdfFileSummary(observation, asset),
      agentSummary: `${modality} observation`
    }
  }

  const fileSummary = buildPdfFileSummary(observation, asset)
  const mimeSummary = mimeType ?? 'application/pdf'

  return {
    status: {
      kind: 'ready',
      title: 'PDF preview ready',
      message: `${mimeSummary}; ${fileSummary}.`
    },
    title: observation.view.title || basename(observation.file.path) || asset?.file.name || 'PDF preview',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatLabel(observation.view.mode)
    ]).join(' | '),
    fileSummary,
    agentSummary: compactStrings([
      mimeSummary,
      fileSummary,
      'read-only'
    ]).join(', '),
    mimeType: mimeSummary
  }
}

export async function loadPdfWorkspacePreviewData(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
}): Promise<PdfWorkspaceViewerLoadResult> {
  const descriptor = input.asset ?? input.transport?.descriptor ?? null
  const model = buildPdfWorkspaceViewerModel({
    observation: input.observation,
    asset: descriptor
  })

  if (model.status.kind !== 'ready') {
    return {
      kind: 'fallback',
      title: model.status.title,
      message: model.status.message
    }
  }

  if (!descriptor) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: 'No workspace preview asset descriptor is available for this PDF.'
    }
  }

  if (!input.transport) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: 'No workspace preview asset transport client is available for this PDF.'
    }
  }

  if (input.transport.sourceUrl) {
    return {
      kind: 'ready',
      title: 'PDF stream ready',
      message: `${formatBytes(descriptor.range.size)} available through workspace preview URL transport.`,
      sourceUrl: input.transport.sourceUrl,
      mimeType: model.mimeType ?? 'application/pdf'
    }
  }

  const maxBytes = input.maxBytes ?? PDF_WORKSPACE_VIEWER_MAX_BYTES
  const result = await input.transport.readBytesIfWithin(maxBytes)
  if (!result.ok) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: pdfReadFailureMessage({
        descriptor,
        maxBytes,
        message: result.message
      })
    }
  }

  if (result.bytes.length === 0) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: 'The PDF asset is empty.'
    }
  }

  return {
    kind: 'ready',
    title: 'PDF bytes ready',
    message: `${formatBytes(result.bytesRead)} loaded through workspace preview transport.`,
    data: result.bytes,
    mimeType: model.mimeType ?? 'application/pdf',
    bytesRead: result.bytesRead
  }
}

export function PdfWorkspaceViewer({
  observation,
  asset,
  transport,
  maxBytes = PDF_WORKSPACE_VIEWER_MAX_BYTES,
  model,
  previewState,
  className,
  visualContextComponentId,
  onApplyEdit,
  annotationOverlays = [],
  activeAnnotationId = null,
  annotationsOpen = false,
  jumpToRect = null,
  onSelectionChange,
  onAnnotationSelect,
  onOpenAnnotations,
  onToggleAnnotations
}: PdfWorkspaceViewerProps): ReactElement {
  const { t } = useTranslation()
  const resolvedAsset = asset ?? transport?.descriptor ?? null
  const resolvedModel = useMemo(() => model ?? buildPdfWorkspaceViewerModel({
    observation,
    asset: resolvedAsset
  }), [model, observation, resolvedAsset])
  const [loadedPreviewState, setLoadedPreviewState] = useState<PdfWorkspaceViewerPreviewState>(() =>
    initialPdfPreviewState({
      model: resolvedModel,
      asset: resolvedAsset,
      transport
    })
  )
  const activeDocumentKeyRef = useRef(`${observation?.file.path ?? ''}:${resolvedAsset?.assetId ?? ''}`)

  useEffect(() => {
    if (previewState) return
    let cancelled = false
    const documentKey = `${observation?.file.path ?? ''}:${resolvedAsset?.assetId ?? ''}`
    const preserveReadyPreview = activeDocumentKeyRef.current === documentKey
    activeDocumentKeyRef.current = documentKey

    const initialState = initialPdfPreviewState({
      model: resolvedModel,
      asset: resolvedAsset,
      transport
    })
    setLoadedPreviewState((current) => preserveReadyPreview && current.kind === 'ready' ? current : initialState)

    if (resolvedModel.status.kind !== 'ready' || !resolvedAsset || !transport) return

    setLoadedPreviewState((current) => preserveReadyPreview && current.kind === 'ready'
      ? current
      : {
          kind: 'loading',
          title: 'Loading PDF',
          message: 'Reading PDF bytes through workspace preview transport.'
        })

    void loadPdfWorkspacePreviewData({
      observation,
      asset: resolvedAsset,
      transport,
      maxBytes
    })
      .then((result) => {
        if (!cancelled) setLoadedPreviewState(result)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadedPreviewState({
          kind: 'error',
          title: 'PDF render failed',
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
    }
  }, [
    maxBytes,
    observation,
    previewState,
    resolvedAsset,
    resolvedModel,
    transport
  ])

  const activePreviewState = previewState ?? loadedPreviewState
  const initialDocumentAnchor = observation?.selection?.kind === 'document'
    ? observation.selection.anchors[0]
    : undefined
  const initialAnchorRect = initialDocumentAnchor?.rects?.[0]
  const initialPage = initialDocumentAnchor?.page ?? initialAnchorRect?.page ?? 1
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const handleAnnotationAction = useCallback((action: WritePdfAnnotationAction, selection: WritePdfSelection): void => {
    if (!observation || !onApplyEdit) return
    const operation = createPdfWorkspacePreviewAnnotationOperation({
      path: observation.file.path,
      action,
      selection,
      translationBody: t('writePdfAnnotationTranslatePrompt'),
      visualSelectionQuote: t('writePdfAnnotationVisualSelectionQuote')
    })
    if (!operation) return
    void onApplyEdit(operation)
  }, [observation, onApplyEdit, t])

  return (
    <section
      className={compactClassName('workspace-preview-pdf-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-pdf-viewer
      data-status={resolvedModel.status.kind}
      data-pdf-preview-state={activePreviewState.kind}
    >
      {resolvedModel.status.kind !== 'ready' ? (
        <PdfFallbackSummary
          title={resolvedModel.status.title}
          message={resolvedModel.status.message}
          role={statusRole}
        />
      ) : activePreviewState.kind !== 'ready' ? (
        <PdfFallbackSummary
          title={activePreviewState.title}
          message={activePreviewState.message}
          role={activePreviewState.kind === 'error' ? 'alert' : 'status'}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" data-pdf-ready-shell>
          <div className="min-h-0 flex-1 pr-20" data-pdf-preview-viewport>
            <WritePdfViewer
              filePath={resolvePdfFilePath(observation, resolvedAsset)}
              workspaceRoot={observation?.file.workspaceRoot}
              data={activePreviewState.data}
              sourceUrl={activePreviewState.sourceUrl}
              mimeType={activePreviewState.mimeType}
              size={resolvePdfFileSize(observation, resolvedAsset)}
              mtimeMs={observation?.file.mtimeMs}
              visualContextComponentId={visualContextComponentId}
              initialPage={initialPage}
              onAnnotationAction={onApplyEdit ? handleAnnotationAction : undefined}
              annotationOverlays={annotationOverlays}
              activeAnnotationId={activeAnnotationId}
              annotationsOpen={annotationsOpen}
              jumpToRect={jumpToRect ?? initialAnchorRect ?? null}
              onSelectionChange={onSelectionChange}
              onAnnotationSelect={onAnnotationSelect}
              onOpenAnnotations={onOpenAnnotations}
              onToggleAnnotations={onToggleAnnotations}
              className="h-full min-h-0"
            />
          </div>
        </div>
      )}
    </section>
  )
}

export function resolvePdfMimeType(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
}): string | null {
  const advertisedMimeType = [
    input.asset?.file.mimeType,
    input.observation?.file.mimeType
  ]
    .map((mimeType) => normalizePdfMimeType(mimeType))
    .find((mimeType): mimeType is string => Boolean(mimeType)) ?? null

  if (advertisedMimeType) return advertisedMimeType
  if (hasPdfExtension(input.asset?.file.relativePath) ||
    hasPdfExtension(input.asset?.file.name) ||
    hasPdfExtension(input.observation?.file.path)) {
    return 'application/pdf'
  }
  return null
}

function PdfFallbackSummary({
  title,
  message,
  role
}: {
  title: string
  message: string
  role: 'status' | 'alert'
}): ReactElement {
  return (
    <div
      className="p-4 text-sm text-ds-text"
      role={role}
      data-pdf-fallback-summary
    >
      <strong>{title}</strong>
      <p className="mt-1 text-ds-muted">{message}</p>
    </div>
  )
}

function initialPdfPreviewState(input: {
  model: PdfWorkspaceViewerModel
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
}): PdfWorkspaceViewerPreviewState {
  if (input.model.status.kind !== 'ready') {
    return {
      kind: 'fallback',
      title: input.model.status.title,
      message: input.model.status.message
    }
  }
  if (!input.asset) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: 'No workspace preview asset descriptor is available for this PDF.'
    }
  }
  if (!input.transport) {
    return {
      kind: 'fallback',
      title: 'PDF bytes unavailable',
      message: 'No workspace preview asset transport client is available for this PDF.'
    }
  }
  return {
    kind: 'idle',
    title: 'PDF bytes pending',
    message: 'Waiting to read PDF bytes through workspace preview transport.'
  }
}

function isPdfObservation(input: {
  observation: WorkspaceObservation
  asset?: WorkspacePreviewAssetTransportDescriptor | null
}): boolean {
  if (input.observation.view.modality !== 'document') return false
  if (normalizePdfMimeType(input.observation.file.mimeType)) return true
  if (hasPdfExtension(input.observation.file.path)) return true
  if (input.observation.file.mimeType?.trim()) return false
  return Boolean(
    normalizePdfMimeType(input.asset?.file.mimeType) ||
    hasPdfExtension(input.asset?.file.relativePath) ||
    hasPdfExtension(input.asset?.file.name)
  )
}

function pdfReadFailureMessage(input: {
  descriptor: WorkspacePreviewAssetTransportDescriptor
  maxBytes: number
  message: string
}): string {
  if (input.descriptor.range.size > input.maxBytes) {
    return `This PDF is ${formatBytes(input.descriptor.range.size)}; inline PDF preview is limited to ${formatBytes(input.maxBytes)}.`
  }
  return input.message
}

function buildPdfFileSummary(
  observation: WorkspaceObservation,
  asset?: WorkspacePreviewAssetTransportDescriptor | null
): string {
  const size = resolvePdfFileSize(observation, asset)
  return compactStrings([
    size === undefined ? undefined : formatBytes(size),
    basename(asset?.file.relativePath || asset?.file.name || observation.file.path)
  ]).join(', ') || 'PDF file'
}

function resolvePdfFilePath(
  observation?: WorkspaceObservation | null,
  asset?: WorkspacePreviewAssetTransportDescriptor | null
): string {
  return observation?.file.path || asset?.file.relativePath || asset?.file.name || 'preview.pdf'
}

function resolvePdfFileSize(
  observation?: WorkspaceObservation | null,
  asset?: WorkspacePreviewAssetTransportDescriptor | null
): number | undefined {
  return asset?.range.size ?? asset?.file.size ?? observation?.file.size
}

function normalizePdfMimeType(mimeType: string | null | undefined): string | null {
  const normalized = mimeType?.trim().toLowerCase()
  if (normalized === 'application/pdf' || normalized === 'application/x-pdf') return 'application/pdf'
  return null
}

function hasPdfExtension(path: string | null | undefined): boolean {
  return Boolean(path && /\.pdf$/iu.test(path.trim()))
}

function compactStrings(values: Array<string | null | undefined | false>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function compactClassName(...values: Array<string | null | undefined | false>): string {
  return compactStrings(values).join(' ')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}
