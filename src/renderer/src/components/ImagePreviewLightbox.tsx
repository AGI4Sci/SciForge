import { useEffect, useId, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Download, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type ImagePreviewLightboxProps = {
  open: boolean
  src: string
  alt: string
  title?: string
  downloadDisabled?: boolean
  downloadLabel?: string
  onDownload?: () => void | Promise<void>
  onClose: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function ImagePreviewLightbox({
  open,
  src,
  alt,
  title,
  downloadDisabled = false,
  downloadLabel,
  onDownload,
  onClose
}: ImagePreviewLightboxProps): ReactElement | null {
  const { t } = useTranslation('common')
  const [zoom, setZoom] = useState(1)
  const titleId = useId()
  const resolvedTitle = title || alt || t('imagePreviewTitle')
  const resolvedDownloadLabel = downloadLabel ?? t('imagePreviewDownload')

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    setZoom(1)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const zoomPercent = `${Math.round(zoom * 100)}%`
  const imageClass =
    zoom === 1
      ? 'max-h-full max-w-full object-contain'
      : 'max-w-none object-contain'
  const imageStyle =
    zoom === 1
      ? undefined
      : { width: `${zoom * 100}%` }

  return createPortal(
    <div
      className="ds-no-drag fixed inset-0 z-[1100] bg-zinc-950/82 text-white backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <h2 id={titleId} className="sr-only">
        {resolvedTitle}
      </h2>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2 sm:right-4 sm:top-4">
        {onDownload ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={downloadDisabled}
            aria-label={resolvedDownloadLabel}
            title={resolvedDownloadLabel}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-800"
          >
            <Download className="h-5 w-5" strokeWidth={1.9} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('imagePreviewClose')}
          title={t('imagePreviewClose')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition hover:bg-zinc-50 hover:text-zinc-950 dark:bg-zinc-100 dark:text-zinc-800"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
      <div className="flex h-full w-full items-center justify-center px-4 py-20 sm:px-8">
        <div className="flex max-h-[calc(100dvh-128px)] w-full max-w-[min(1120px,calc(100vw-32px))] items-center justify-center overflow-auto rounded-[18px] border border-white/16 bg-[rgba(255,250,242,0.96)] p-2 shadow-[0_30px_90px_rgba(0,0,0,0.42)] dark:bg-zinc-950/88 sm:max-h-[calc(100dvh-144px)]">
          <img
            src={src}
            alt={alt}
            className={imageClass}
            style={imageStyle}
            draggable={false}
          />
        </div>
      </div>
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center overflow-hidden rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.24)] dark:bg-zinc-100 dark:text-zinc-800">
        <button
          type="button"
          onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
          disabled={zoom <= MIN_ZOOM}
          aria-label={t('imagePreviewZoomOut')}
          title={t('imagePreviewZoomOut')}
          className="inline-flex h-10 w-11 items-center justify-center transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Minus className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          aria-label={t('imagePreviewResetZoom')}
          title={t('imagePreviewResetZoom')}
          className="h-10 min-w-16 px-3 text-[13px] font-semibold transition hover:bg-zinc-100"
        >
          {zoomPercent}
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          aria-label={t('imagePreviewZoomIn')}
          title={t('imagePreviewZoomIn')}
          className="inline-flex h-10 w-11 items-center justify-center transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>,
    document.body
  )
}
