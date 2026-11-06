import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Download, LoaderCircle, Minus, PencilLine, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type ImagePreviewWindowProps = {
  open: boolean
  src: string
  alt: string
  title?: string
  downloadDisabled?: boolean
  downloadLabel?: string
  onDownload?: () => void | Promise<void>
  editDisabled?: boolean
  editLabel?: string
  onEdit?: () => void | Promise<void>
  statusMessage?: string
  onClose: () => void
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function ImagePreviewWindow({
  open,
  src,
  alt,
  title,
  downloadDisabled = false,
  downloadLabel,
  onDownload,
  editDisabled = false,
  editLabel,
  onEdit,
  statusMessage,
  onClose
}: ImagePreviewWindowProps): ReactElement | null {
  const { t } = useTranslation('common')
  const [zoom, setZoom] = useState(1)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editRequestRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [fitWidth, setFitWidth] = useState<number | null>(null)
  const measureImage = (): void => {
    const image = imageRef.current, viewport = viewportRef.current
    if (!image?.naturalWidth || !image.naturalHeight || !viewport) return
    const style = getComputedStyle(viewport)
    const width = viewport.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
    const height = viewport.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0')
    if (width > 0 && height > 0) setFitWidth(Math.min(image.naturalWidth, width, height * image.naturalWidth / image.naturalHeight))
  }
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [position, setPosition] = useState({ x: 24, y: 80 })
  const titleId = useId()

  const constrainPosition = (x: number, y: number): { x: number; y: number } => {
    const bounds = panelRef.current?.getBoundingClientRect()
    return {
      x: Math.max(12, Math.min(x, window.innerWidth - (bounds?.width ?? 0) - 12)),
      y: Math.max(12, Math.min(y, window.innerHeight - (bounds?.height ?? 0) - 12))
    }
  }
  const startDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const bounds = panelRef.current?.getBoundingClientRect()
    if (!bounds) return
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top }
    event.currentTarget.setPointerCapture(event.pointerId)
    panelRef.current?.focus({ preventScroll: true })
    event.preventDefault()
  }
  const finishDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resolvedTitle = title || alt || t('imagePreviewTitle')
  const resolvedDownloadLabel = downloadLabel ?? t('imagePreviewDownload')
  const resolvedEditLabel = editLabel ?? t('imagePreviewOpenSystemEditor')

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    setZoom(1)
    dragRef.current = null
    const bounds = panelRef.current?.getBoundingClientRect()
    setPosition(constrainPosition(window.innerWidth - (bounds?.width ?? 680) - 24, 80))
    const onResize = (): void => setPosition((current) => constrainPosition(current.x, current.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  useEffect(() => {
    editRequestRef.current += 1
    setEditBusy(false)
    setEditError(null)
  }, [open, src])

  useEffect(() => {
    setZoom(1); setFitWidth(null)
    if (!open) return
    measureImage()
    if (typeof ResizeObserver === 'undefined' || !viewportRef.current) return
    const observer = new ResizeObserver(measureImage)
    observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [open, src])

  if (!open || typeof document === 'undefined') return null

  const zoomPercent = `${Math.round(zoom * 100)}%`
  const imageClass =
    zoom === 1
      ? 'm-auto shrink-0 max-h-full max-w-full object-contain'
      : 'm-auto shrink-0 max-w-none object-contain'
  const imageStyle =
    fitWidth !== null ? { width: `${fitWidth * zoom}px`, maxHeight: 'none' } : undefined
  const runEdit = async (): Promise<void> => {
    if (!onEdit || editBusy || editDisabled) return
    const requestId = editRequestRef.current + 1
    editRequestRef.current = requestId
    setEditBusy(true)
    setEditError(null)
    try {
      await onEdit()
    } catch (error) {
      if (editRequestRef.current !== requestId) return
      setEditError(error instanceof Error && error.message.trim()
        ? error.message
        : String(error))
    } finally {
      if (editRequestRef.current === requestId) setEditBusy(false)
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      className="ds-no-drag fixed z-[1100] flex h-[min(560px,70vh)] w-[min(680px,calc(100vw-24px))] min-h-[min(240px,calc(100vh-24px))] min-w-[min(320px,calc(100vw-24px))] resize flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card text-ds-ink shadow-[0_12px_48px_rgba(0,0,0,0.25)]"
      style={{ left: position.x, top: position.y, maxWidth: `calc(100vw - ${position.x + 12}px)`, maxHeight: `calc(100vh - ${position.y + 12}px)` }}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      }}
    >
      <header
        className="flex shrink-0 touch-none select-none items-center gap-3 border-b border-ds-border px-3 py-2 cursor-move"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (drag?.pointerId !== event.pointerId) return
          setPosition(constrainPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY))
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={() => { dragRef.current = null }}
      >
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium" title={resolvedTitle}>
          {resolvedTitle}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={() => void runEdit()}
              disabled={editDisabled || editBusy}
              aria-label={resolvedEditLabel}
              aria-busy={editBusy ? 'true' : undefined}
              title={resolvedEditLabel}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-800"
            >
              {editBusy
                ? <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.9} />
                : <PencilLine className="h-5 w-5" strokeWidth={1.9} />}
            </button>
          ) : null}
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
      </header>
      {editError || statusMessage ? (
        <div
          className={`shrink-0 px-4 py-2 text-center text-xs font-medium shadow-lg ${editError ? 'bg-red-50 text-red-800' : 'bg-white text-zinc-700'}`}
          role={editError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {editError
            ? t('imagePreviewOpenSystemEditorFailed', { message: editError })
            : statusMessage}
        </div>
      ) : null}
      <div ref={viewportRef} className="flex min-h-0 flex-1 overflow-auto bg-ds-panel p-2">
          <img
            ref={imageRef}
            onLoad={measureImage}
            src={src}
            alt={alt}
            className={imageClass}
            style={imageStyle}
            draggable={false}
          />
      </div>
      <div className="flex shrink-0 items-center justify-center border-t border-ds-border bg-ds-card text-ds-ink">
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
