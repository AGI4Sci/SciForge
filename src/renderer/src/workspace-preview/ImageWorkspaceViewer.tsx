import {
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
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

export type ImageWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
  model?: ImageWorkspaceViewerModel
  previewState?: ImageWorkspaceViewerPreviewState
  className?: string
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
  className
}: ImageWorkspaceViewerProps): ReactElement {
  const resolvedAsset = asset ?? transport?.descriptor ?? null
  const resolvedModel = useMemo(() => model ?? buildImageWorkspaceViewerModel({
    observation,
    asset: resolvedAsset
  }), [model, observation, resolvedAsset])
  const [loadedPreviewState, setLoadedPreviewState] = useState<ImageWorkspaceViewerPreviewState>(() =>
    initialImagePreviewState({
      model: resolvedModel,
      asset: resolvedAsset,
      transport
    })
  )
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (previewState) return
    let cancelled = false

    const initialState = initialImagePreviewState({
      model: resolvedModel,
      asset: resolvedAsset,
      transport
    })
    setLoadedPreviewState(initialState)

    if (resolvedModel.status.kind !== 'ready' || !resolvedAsset || !transport) return

    setLoadedPreviewState({
      kind: 'loading',
      title: 'Loading image',
      message: 'Reading image bytes through workspace preview transport.'
    })

    void loadImageWorkspacePreviewDataUrl({
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
          title: 'Image render failed',
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

  useEffect(() => {
    setZoomMode('fit')
    setZoom(1)
  }, [observation?.file.path, previewState?.kind])

  const activePreviewState = previewState ?? loadedPreviewState
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const imageStyle = buildImageStyle({ zoom, zoomMode })

  return (
    <section
      className={compactClassName('workspace-preview-image-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-image-viewer
      data-status={resolvedModel.status.kind}
      data-image-preview-state={activePreviewState.kind}
      data-fit-mode={zoomMode}
      data-zoom-factor={zoom.toFixed(2)}
    >
      {resolvedModel.status.kind !== 'ready' ? (
        <ImageFallbackSummary
          title={resolvedModel.status.title}
          message={resolvedModel.status.message}
          role={statusRole}
        />
      ) : activePreviewState.kind !== 'ready' ? (
        <ImageFallbackSummary
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
            <div className="flex h-full min-h-[16rem] items-center justify-center">
              <img
                src={activePreviewState.dataUrl}
                alt={resolvedModel.title}
                className="block rounded border border-ds-border bg-ds-panel shadow-sm"
                data-image-preview-img
                data-image-mime-type={activePreviewState.mimeType}
                data-image-bytes-read={activePreviewState.bytesRead}
                style={imageStyle}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ImageFallbackSummary({
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
      data-image-fallback-summary
    >
      <strong>{title}</strong>
      <p className="mt-1 text-ds-muted">{message}</p>
    </div>
  )
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
