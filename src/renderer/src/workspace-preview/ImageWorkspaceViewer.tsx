import {
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type SetStateAction
} from 'react'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  workspacePreviewContentIdentity,
  workspacePreviewContentKey,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import type { WorkspacePreviewAssetTransportClient } from './host'

export const IMAGE_WORKSPACE_VIEWER_MAX_BYTES = WORKSPACE_PREVIEW_MAX_RANGE_BYTES

export type ImageWorkspaceViewerStatus =
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

export type ImageWorkspaceViewerModel = {
  status: ImageWorkspaceViewerStatus
  title: string
  subtitle?: string
  fileSummary: string
  agentSummary: string
}

export type ImageWorkspaceViewerPreviewState =
  | {
      kind: 'idle' | 'loading'
      title: string
      message: string
    }
  | {
      kind: 'ready'
      title: string
      message: string
      dataUrl: string
      mimeType: string
      bytesRead: number
    }
  | {
      kind: 'fallback' | 'error'
      title: string
      message: string
    }

type ImageWorkspaceViewerFrame = {
  path: string
  dataUrl: string
  mimeType: string
  bytesRead: number
}

export type ImageWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
  model?: ImageWorkspaceViewerModel
  previewState?: ImageWorkspaceViewerPreviewState
  /**
   * The owning shell is still opening this pane's document, so no renderable image exists yet.
   * While set, a frame already decoded for the current content path stays on screen as
   * `refreshing`, and a viewer with nothing to show reports `loading` instead of the model's
   * "no image observation" summary. A result already concluded for the current content identity,
   * and any explicit `previewState` override, keep precedence.
   */
  opening?: boolean
  className?: string
  onLoadError?: () => void
}

export type ImageWorkspaceViewerLoadResult = Extract<ImageWorkspaceViewerPreviewState, { kind: 'ready' }> |
  Extract<ImageWorkspaceViewerPreviewState, { kind: 'fallback' | 'error' }>

export function buildImageWorkspaceViewerModel(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
}): ImageWorkspaceViewerModel {
  const { observation, asset } = input
  if (!observation) {
    return {
      status: {
        kind: 'empty',
        title: 'No image observation',
        message: 'Open an image workspace preview to populate this viewer.'
      },
      title: 'Image viewer',
      fileSummary: 'No image selected',
      agentSummary: 'No image observation'
    }
  }

  if (observation.view.modality !== 'image') {
    const modality = formatLabel(observation.view.modality)
    return {
      status: {
        kind: 'unsupported',
        title: 'Unsupported observation',
        message: `${modality} observations cannot be rendered by the image viewer.`
      },
      title: observation.view.title || basename(observation.file.path),
      subtitle: compactStrings([
        observation.view.pluginId,
        formatLabel(observation.view.mode)
      ]).join(' | '),
      fileSummary: buildImageFileSummary(observation, asset),
      agentSummary: `${modality} observation`
    }
  }

  const resolvedMimeType = resolveImageMimeType({
    observation,
    asset
  })
  const fileSummary = buildImageFileSummary(observation, asset)
  const mimeSummary = resolvedMimeType ?? 'image MIME pending'

  return {
    status: {
      kind: 'ready',
      title: 'Image preview ready',
      message: `${mimeSummary}; ${fileSummary}.`
    },
    title: observation.view.title || basename(observation.file.path) || asset?.file.name || 'Image preview',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatLabel(observation.view.mode)
    ]).join(' | '),
    fileSummary,
    agentSummary: compactStrings([
      mimeSummary,
      fileSummary
    ]).join(', ')
  }
}

export async function loadImageWorkspacePreviewDataUrl(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
}): Promise<ImageWorkspaceViewerLoadResult> {
  const descriptor = input.asset ?? input.transport?.descriptor ?? null
  const model = buildImageWorkspaceViewerModel({
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
      title: 'Image bytes unavailable',
      message: 'No workspace preview asset descriptor is available for this image.'
    }
  }

  if (!input.transport) {
    return {
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: 'No workspace preview asset transport client is available for this image.'
    }
  }

  const mimeType = resolveImageMimeType({
    observation: input.observation,
    asset: descriptor
  })
  if (!mimeType) {
    return {
      kind: 'fallback',
      title: 'Unsupported image MIME',
      message: 'The preview metadata does not advertise an image MIME type.'
    }
  }

  const maxBytes = input.maxBytes ?? IMAGE_WORKSPACE_VIEWER_MAX_BYTES
  const result = await input.transport.readBytesIfWithin(maxBytes)
  if (!result.ok) {
    return {
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: imageReadFailureMessage({
        descriptor,
        maxBytes,
        message: result.message
      })
    }
  }

  if (result.bytes.length === 0) {
    return {
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: 'The image asset is empty.'
    }
  }

  return {
    kind: 'ready',
    title: 'Image rendered',
    message: `${mimeType}; ${formatBytes(result.bytesRead)} loaded through workspace preview transport.`,
    dataUrl: createImageWorkspaceViewerDataUrl(result.bytes, mimeType),
    mimeType,
    bytesRead: result.bytesRead
  }
}

export function createImageWorkspaceViewerDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

export function resolveImageMimeType(input: {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
}): string | null {
  return [
    input.asset?.file.mimeType,
    input.observation?.file.mimeType
  ]
    .map((mimeType) => normalizeImageMimeType(mimeType))
    .find((mimeType): mimeType is string => Boolean(mimeType)) ?? null
}

export function ImageWorkspaceViewer({
  observation,
  asset,
  transport,
  maxBytes = IMAGE_WORKSPACE_VIEWER_MAX_BYTES,
  model,
  previewState,
  opening = false,
  className,
  onLoadError
}: ImageWorkspaceViewerProps): ReactElement {
  const resolvedAsset = asset ?? transport?.descriptor ?? null
  const contentPath = workspacePreviewContentIdentity({
    observation,
    asset: resolvedAsset
  }).path
  const contentKey = workspacePreviewContentKey({
    observation,
    asset: resolvedAsset
  })
  const resolvedModel = useMemo(() => model ?? buildImageWorkspaceViewerModel({
    observation,
    asset: resolvedAsset
  }), [model, observation, resolvedAsset])
  const canLoadImage = resolvedModel.status.kind === 'ready' &&
    Boolean(resolvedAsset) &&
    Boolean(transport)
  const loadInputRef = useRef({
    observation,
    asset: resolvedAsset,
    transport,
    model: resolvedModel,
    maxBytes
  })
  loadInputRef.current = {
    observation,
    asset: resolvedAsset,
    transport,
    model: resolvedModel,
    maxBytes
  }
  const [loadedPreviewState, setLoadedPreviewState] = useState<ImageWorkspaceViewerPreviewState>(() =>
    initialImagePreviewState({
      model: resolvedModel,
      asset: resolvedAsset,
      transport
    })
  )
  const [loadedFrame, setLoadedFrame] = useState<ImageWorkspaceViewerFrame | null>(null)
  // Content key whose load already reached a terminal result, together with that result. A render
  // carrying the same content identity must neither reset the viewer nor repeat the transport read,
  // and a transient state (for example the shell clearing the asset while it re-opens the same
  // document) must not permanently replace the concluded result.
  const [settledLoad, setSettledLoad] = useState<{
    key: string
    state: ImageWorkspaceViewerPreviewState
  } | null>(null)
  // Content key of the newest request; results for superseded keys are dropped.
  const activeContentKeyRef = useRef<string | null>(null)
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (previewState) return
    if (settledLoad?.key === contentKey) {
      setLoadedPreviewState((current) => current === settledLoad.state ? current : settledLoad.state)
      return
    }

    const current = loadInputRef.current
    const requestKey = contentKey
    const requestPath = contentPath
    activeContentKeyRef.current = requestKey
    let cancelled = false

    setLoadedPreviewState(initialImagePreviewState({
      model: current.model,
      asset: current.asset,
      transport: current.transport
    }))

    if (!canLoadImage) return

    setLoadedPreviewState({
      kind: 'loading',
      title: 'Loading image',
      message: 'Reading image bytes through workspace preview transport.'
    })

    void loadImageWorkspacePreviewDataUrl({
      observation: current.observation,
      asset: current.asset,
      transport: current.transport,
      maxBytes: current.maxBytes
    })
      .then((result) => {
        if (cancelled || activeContentKeyRef.current !== requestKey) return
        if (result.kind === 'ready') {
          setLoadedFrame({
            path: requestPath,
            dataUrl: result.dataUrl,
            mimeType: result.mimeType,
            bytesRead: result.bytesRead
          })
        } else {
          // A terminal non-ready result must show its own message instead of the previous
          // revision's pixels.
          clearImageWorkspaceViewerFrame(setLoadedFrame, requestPath)
        }
        setSettledLoad({ key: requestKey, state: result })
        setLoadedPreviewState(result)
      })
      .catch((error) => {
        if (cancelled || activeContentKeyRef.current !== requestKey) return
        clearImageWorkspaceViewerFrame(setLoadedFrame, requestPath)
        const errorState: ImageWorkspaceViewerPreviewState = {
          kind: 'error',
          title: 'Image render failed',
          message: error instanceof Error ? error.message : String(error)
        }
        setSettledLoad({ key: requestKey, state: errorState })
        setLoadedPreviewState(errorState)
      })

    return () => {
      cancelled = true
    }
  }, [canLoadImage, contentKey, contentPath, maxBytes, previewState, settledLoad])

  useEffect(() => {
    setZoomMode('fit')
    setZoom(1)
  }, [observation?.file.path, previewState?.kind])

  const activePreviewState = previewState ?? loadedPreviewState
  // The last successfully decoded frame stays on screen while newer bytes for the same file are in
  // flight, so a successful same-file reload never unmounts the <img>. A terminal non-ready result
  // clears it again so the fallback/error message is what the user sees.
  const retainedFrame = !previewState && loadedFrame?.path === contentPath ? loadedFrame : null
  const displayedFrame = activePreviewState.kind === 'ready'
    ? {
        dataUrl: activePreviewState.dataUrl,
        mimeType: activePreviewState.mimeType,
        bytesRead: activePreviewState.bytesRead
      }
    : retainedFrame
  // While the shell is still opening this pane's document, nothing has failed yet, so the model's
  // empty summary ("No image observation ...") and a missing-descriptor fallback would both be
  // misleading. A concluded result for this exact content identity still wins, as does a frame we
  // can keep showing. An explicit previewState override always wins.
  const openingWithoutOverride = opening && !previewState
  const settledResult = settledLoad?.key === contentKey ? settledLoad.state : null
  const showOpeningLoading = openingWithoutOverride &&
    !displayedFrame &&
    (settledResult === null || settledResult.kind === 'ready')
  const displayedPreviewStateKind = showOpeningLoading
    ? 'loading'
    : resolvedModel.status.kind !== 'ready'
      ? activePreviewState.kind
      : activePreviewState.kind === 'ready'
        ? openingWithoutOverride ? 'refreshing' : 'ready'
        : retainedFrame && (openingWithoutOverride ||
            activePreviewState.kind === 'idle' ||
            activePreviewState.kind === 'loading')
          ? 'refreshing'
          : activePreviewState.kind
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const imageStyle = buildImageStyle({ zoom, zoomMode })

  return (
    <section
      className={compactClassName('workspace-preview-image-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-image-viewer
      data-status={resolvedModel.status.kind}
      data-image-preview-state={displayedPreviewStateKind}
      data-fit-mode={zoomMode}
      data-zoom-factor={zoom.toFixed(2)}
    >
      {showOpeningLoading ? (
        <ImageStatusSummary
          marker="loading"
          role="status"
          title="Opening image"
          message="The workspace preview session is opening this document; image bytes load as soon as it is available."
        />
      ) : resolvedModel.status.kind !== 'ready' ? (
        <ImageStatusSummary
          marker="fallback"
          title={resolvedModel.status.title}
          message={resolvedModel.status.message}
          role={statusRole}
        />
      ) : !displayedFrame ? (
        <ImageStatusSummary
          marker="fallback"
          title={activePreviewState.title}
          message={activePreviewState.message}
          role={activePreviewState.kind === 'error' ? 'alert' : 'status'}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-end gap-3 border-b border-ds-border px-4 py-2 pr-20">
            <div className="flex shrink-0 items-center gap-1" data-image-zoom-controls>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
                title="Zoom out"
                aria-label="Zoom out"
                data-image-zoom-out
                disabled={zoomMode === 'manual' && zoom <= 0.25}
                onClick={() => {
                  setZoomMode('manual')
                  setZoom((value) => Math.max(0.25, roundZoom(value - 0.25)))
                }}
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text"
                title="Reset zoom"
                aria-label="Reset zoom"
                data-image-zoom-reset
                onClick={() => {
                  setZoomMode('manual')
                  setZoom(1)
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text"
                title="Fit image"
                aria-label="Fit image"
                data-image-zoom-fit
                onClick={() => {
                  setZoomMode('fit')
                  setZoom(1)
                }}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
                title="Zoom in"
                aria-label="Zoom in"
                data-image-zoom-in
                disabled={zoomMode === 'manual' && zoom >= 4}
                onClick={() => {
                  setZoomMode('manual')
                  setZoom((value) => Math.min(4, roundZoom(value + 0.25)))
                }}
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto bg-ds-bg p-4 pr-20"
            data-image-preview-viewport
          >
            <div className="flex h-full min-h-[16rem]">
              <img
                src={displayedFrame.dataUrl}
                onError={onLoadError}
                alt={resolvedModel.title}
                className="m-auto block rounded border border-ds-border bg-ds-panel shadow-sm"
                data-image-preview-img
                data-image-mime-type={displayedFrame.mimeType}
                data-image-bytes-read={displayedFrame.bytesRead}
                style={imageStyle}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ImageStatusSummary({
  title,
  message,
  role,
  marker
}: {
  title: string
  message: string
  role: 'status' | 'alert'
  marker: 'fallback' | 'loading'
}): ReactElement {
  const markerAttributes: Record<string, boolean> = marker === 'loading'
    ? { 'data-image-loading-summary': true }
    : { 'data-image-fallback-summary': true }

  return (
    <div
      className="p-4 text-sm text-ds-text"
      role={role}
      {...markerAttributes}
    >
      <strong>{title}</strong>
      <p className="mt-1 text-ds-muted">{message}</p>
    </div>
  )
}

function clearImageWorkspaceViewerFrame(
  setLoadedFrame: Dispatch<SetStateAction<ImageWorkspaceViewerFrame | null>>,
  path: string
): void {
  setLoadedFrame((current) => current?.path === path ? null : current)
}

function initialImagePreviewState(input: {
  model: ImageWorkspaceViewerModel
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
}): ImageWorkspaceViewerPreviewState {
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
      title: 'Image bytes unavailable',
      message: 'No workspace preview asset descriptor is available for this image.'
    }
  }
  if (!input.transport) {
    return {
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: 'No workspace preview asset transport client is available for this image.'
    }
  }
  return {
    kind: 'idle',
    title: 'Image bytes pending',
    message: 'Waiting to read image bytes through workspace preview transport.'
  }
}

function imageReadFailureMessage(input: {
  descriptor: WorkspacePreviewAssetTransportDescriptor
  maxBytes: number
  message: string
}): string {
  if (input.descriptor.range.size > input.maxBytes) {
    return `This image is ${formatBytes(input.descriptor.range.size)}; inline image preview is limited to ${formatBytes(input.maxBytes)}.`
  }
  return input.message
}

function buildImageStyle(input: {
  zoom: number
  zoomMode: 'fit' | 'manual'
}): CSSProperties {
  if (input.zoomMode === 'fit') {
    return {
      height: '100%',
      maxHeight: '100%',
      maxWidth: '100%',
      objectFit: 'contain',
      width: '100%'
    }
  }

  return {
    height: 'auto',
    maxHeight: 'none',
    maxWidth: 'none',
    objectFit: 'contain',
    width: `${Math.round(input.zoom * 100)}%`
  }
}

function buildImageFileSummary(
  observation: WorkspaceObservation,
  asset?: WorkspacePreviewAssetTransportDescriptor | null
): string {
  const size = asset?.range.size ?? asset?.file.size ?? observation.file.size
  return compactStrings([
    size === undefined ? undefined : formatBytes(size),
    basename(asset?.file.relativePath || asset?.file.name || observation.file.path)
  ]).join(', ') || 'image file'
}

function normalizeImageMimeType(mimeType: string | null | undefined): string | null {
  const normalized = mimeType?.trim().toLowerCase()
  if (!normalized?.startsWith('image/')) return null
  return normalized
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100
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
