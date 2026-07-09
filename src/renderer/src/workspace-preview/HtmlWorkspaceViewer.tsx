import {
  useEffect,
  useState,
  type ReactElement
} from 'react'
import {
  Code2,
  Columns2,
  ExternalLink,
  Eye,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  TextWorkspaceViewer,
  type TextWorkspaceViewerApplyEditHandler
} from './TextWorkspaceViewer'

export type HtmlWorkspaceViewerApplyEditHandler = (
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>
) => void | Promise<void>

export type HtmlWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  className?: string
  onApplyEdit?: HtmlWorkspaceViewerApplyEditHandler
  previewUrlState?: HtmlWorkspaceViewerPreviewUrlState
  loadPreviewUrl?: () => Promise<HtmlWorkspaceViewerPreviewUrlState>
  initialMode?: HtmlWorkspaceViewerMode
  initialZoom?: number
  onOpenPreviewExternal?: (url: string) => void | Promise<void>
}

export type HtmlWorkspaceViewerMode = 'preview' | 'source' | 'split'

export type HtmlWorkspaceViewerPreviewUrlState =
  | {
      ok: true
      url: string
      size?: number
      mtimeMs?: number
    }
  | {
      ok: false
      message: string
    }

export type HtmlWorkspaceViewerModel = {
  status: 'ready' | 'empty' | 'unsupported'
  title: string
  subtitle?: string
  html: string
  truncated: boolean
  editable: boolean
  summary: string
}

export function buildHtmlWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined,
  hasApplyEditHandler = false
): HtmlWorkspaceViewerModel {
  if (!observation) {
    return {
      status: 'empty',
      title: 'HTML viewer',
      html: '',
      truncated: false,
      editable: false,
      summary: 'Open an HTML workspace preview to populate this viewer.'
    }
  }

  if (!isHtmlObservation(observation)) {
    return {
      status: 'unsupported',
      title: observation.view.title || basename(observation.file.path),
      subtitle: compactStrings([observation.view.pluginId, formatLabel(observation.view.mode)]).join(' | '),
      html: '',
      truncated: false,
      editable: false,
      summary: `${formatLabel(observation.view.modality)} observations cannot be rendered by the HTML viewer.`
    }
  }

  const html = observation.visibleText ?? ''
  const truncated = Boolean(observation.text?.truncated)
  const canApplyEdit = observation.actions.includes('text.replaceRange') ||
    observation.actions.includes('applyEdit') ||
    observation.actions.includes('save')
  const editable = hasApplyEditHandler && canApplyEdit && !truncated
  const characterCount = observation.text?.characterCount ?? html.length
  const lineCount = observation.text?.lineCount ?? countTextLines(html)

  return {
    status: 'ready',
    title: observation.view.title || basename(observation.file.path),
    subtitle: compactStrings([observation.view.pluginId, formatLabel(observation.view.mode)]).join(' | '),
    html,
    truncated,
    editable,
    summary: [
      `${formatCount(lineCount, 'line')}`,
      `${formatCount(characterCount, 'character')}`,
      truncated ? 'truncated' : 'complete',
      editable ? 'editable' : 'read-only'
    ].join(', ')
  }
}

export function HtmlWorkspaceViewer({
  observation,
  className,
  onApplyEdit,
  previewUrlState,
  loadPreviewUrl,
  initialMode = 'preview',
  initialZoom = 1,
  onOpenPreviewExternal
}: HtmlWorkspaceViewerProps): ReactElement {
  const model = buildHtmlWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const applyTextEdit: TextWorkspaceViewerApplyEditHandler = async (operation) => {
    await onApplyEdit?.(operation)
  }
  const [mode, setMode] = useState<HtmlWorkspaceViewerMode>(initialMode)
  const [zoom, setZoom] = useState(() => clampHtmlZoom(initialZoom))
  const [loadedPreviewUrlState, setLoadedPreviewUrlState] = useState<HtmlWorkspaceViewerPreviewUrlState | null>(
    previewUrlState ?? null
  )

  useEffect(() => {
    if (previewUrlState) {
      setLoadedPreviewUrlState(previewUrlState)
      return undefined
    }
    if (model.status !== 'ready' || !loadPreviewUrl) {
      setLoadedPreviewUrlState(null)
      return undefined
    }

    let cancelled = false
    setLoadedPreviewUrlState(null)
    void loadPreviewUrl()
      .then((result) => {
        if (!cancelled) setLoadedPreviewUrlState(result)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadedPreviewUrlState({
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        })
      })
    return () => {
      cancelled = true
    }
  }, [loadPreviewUrl, model.status, observation?.file.path, previewUrlState])

  useEffect(() => {
    setMode(initialMode)
    setZoom(clampHtmlZoom(initialZoom))
  }, [initialMode, initialZoom, observation?.file.path])

  const activePreviewUrlState = previewUrlState ?? loadedPreviewUrlState
  const showSource = mode === 'source' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <section
      className={compactClassName('workspace-preview-html-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-html-viewer
      data-status={model.status}
      data-editable={model.editable ? 'true' : 'false'}
      data-truncated={model.truncated ? 'true' : 'false'}
    >
      <header className="flex items-start justify-between gap-3 border-b border-ds-border px-4 py-3 pr-20">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ds-text">{model.title}</h3>
          {model.subtitle ? <p className="mt-1 text-xs text-ds-muted">{model.subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {model.status === 'ready' ? (
            <HtmlModeControl mode={mode} onModeChange={setMode} />
          ) : null}
          <p className="text-xs text-ds-muted" data-html-agent-summary>
            {model.summary}
          </p>
        </div>
      </header>

      {model.status !== 'ready' ? (
        <div
          className="p-4 text-sm text-ds-text"
          role={model.status === 'unsupported' ? 'alert' : 'status'}
        >
          <strong>{model.status === 'empty' ? 'No HTML observation' : 'Unsupported observation'}</strong>
          <p className="mt-1 text-ds-muted">{model.summary}</p>
        </div>
      ) : (
        <div
          className={compactClassName(
            'min-h-0 flex-1',
            showSource && showPreview ? 'grid grid-cols-1 lg:grid-cols-2' : 'flex flex-col'
          )}
          data-html-view-mode={mode}
        >
          {showSource ? (
            <div className={compactClassName(
              'min-h-0',
              showPreview ? 'border-b border-ds-border lg:border-b-0 lg:border-r' : 'flex-1'
            )}>
              <TextWorkspaceViewer
                observation={observation}
                className="h-full min-h-0"
                onApplyEdit={onApplyEdit ? applyTextEdit : undefined}
              />
            </div>
          ) : null}
          {showPreview ? (
            <HtmlPreviewPane
              model={model}
              previewUrlState={activePreviewUrlState}
              hasPreviewUrlLoader={Boolean(loadPreviewUrl)}
              zoom={zoom}
              onZoomChange={setZoom}
              onOpenPreviewExternal={onOpenPreviewExternal}
            />
          ) : null}
        </div>
      )}
    </section>
  )
}

function HtmlModeControl({
  mode,
  onModeChange
}: {
  mode: HtmlWorkspaceViewerMode
  onModeChange: (mode: HtmlWorkspaceViewerMode) => void
}): ReactElement {
  const modes: Array<{ mode: HtmlWorkspaceViewerMode; label: string; icon: ReactElement }> = [
    { mode: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'source', label: 'Source', icon: <Code2 className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'split', label: 'Split', icon: <Columns2 className="h-3.5 w-3.5" aria-hidden="true" /> }
  ]
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-lg border border-ds-border bg-ds-panel p-1"
      data-html-mode-control
    >
      {modes.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onModeChange(item.mode)}
          className={compactClassName(
            'inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[11.5px] font-semibold transition',
            mode === item.mode
              ? 'bg-white text-accent shadow-sm ring-1 ring-ds-border dark:bg-white/10 dark:ring-white/10'
              : 'text-ds-muted hover:bg-ds-hover hover:text-ds-text'
          )}
          aria-pressed={mode === item.mode}
          data-html-mode-button={item.mode}
        >
          {item.icon}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

export function htmlPreviewUrlStateFromActionResult(result: unknown): HtmlWorkspaceViewerPreviewUrlState {
  if (!result || typeof result !== 'object') {
    return { ok: false, message: 'HTML preview action returned an invalid result.' }
  }
  const record = result as {
    ok?: unknown
    result?: unknown
    message?: unknown
  }
  if (record.ok !== true) {
    return {
      ok: false,
      message: typeof record.message === 'string' ? record.message : 'HTML preview action failed.'
    }
  }
  const payload = record.result
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'HTML preview action did not return a preview URL.' }
  }
  const value = payload as { url?: unknown; size?: unknown; mtimeMs?: unknown }
  if (typeof value.url !== 'string' || !value.url.trim()) {
    return { ok: false, message: 'HTML preview action did not return a preview URL.' }
  }
  return {
    ok: true,
    url: value.url,
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
    ...(typeof value.mtimeMs === 'number' ? { mtimeMs: value.mtimeMs } : {})
  }
}

function HtmlPreviewPane({
  model,
  previewUrlState,
  hasPreviewUrlLoader,
  zoom,
  onZoomChange,
  onOpenPreviewExternal
}: {
  model: HtmlWorkspaceViewerModel
  previewUrlState: HtmlWorkspaceViewerPreviewUrlState | null
  hasPreviewUrlLoader: boolean
  zoom: number
  onZoomChange: (zoom: number) => void
  onOpenPreviewExternal?: (url: string) => void | Promise<void>
}): ReactElement {
  if (previewUrlState?.ok) {
    return (
      <div className="flex min-h-0 flex-col bg-ds-bg" data-html-preview-pane data-html-preview-mode="url">
        <HtmlPreviewToolbar
          zoom={zoom}
          onZoomChange={onZoomChange}
          previewUrl={previewUrlState.url}
          onOpenPreviewExternal={onOpenPreviewExternal}
        />
        <HtmlPreviewFrame model={model} src={previewUrlState.url} zoom={zoom} />
      </div>
    )
  }

  if (previewUrlState && !previewUrlState.ok) {
    return (
      <div className="min-h-0 bg-ds-bg p-4 pr-20" data-html-preview-pane data-html-preview-mode="error">
        <div className="rounded-md border border-ds-border bg-ds-panel p-3 text-sm text-ds-text" role="status">
          <strong>HTML preview URL unavailable</strong>
          <p className="mt-1 text-ds-muted">{previewUrlState.message}</p>
        </div>
        <HtmlSrcDocFrame model={model} />
      </div>
    )
  }

  if (hasPreviewUrlLoader) {
    return (
      <div className="min-h-0 bg-ds-bg p-4 pr-20" data-html-preview-pane data-html-preview-mode="loading">
        <div className="rounded-md border border-ds-border bg-ds-panel p-3 text-sm text-ds-text" role="status">
          Resolving HTML preview URL...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 bg-ds-bg p-4 pr-20" data-html-preview-pane data-html-preview-mode="srcdoc">
      <HtmlPreviewFrame model={model} srcDoc={model.html} zoom={zoom} />
    </div>
  )
}

function HtmlSrcDocFrame({ model }: { model: HtmlWorkspaceViewerModel }): ReactElement {
  return <HtmlPreviewFrame model={model} srcDoc={model.html} zoom={1} />
}

function HtmlPreviewToolbar({
  zoom,
  onZoomChange,
  previewUrl,
  onOpenPreviewExternal
}: {
  zoom: number
  onZoomChange: (zoom: number) => void
  previewUrl: string
  onOpenPreviewExternal?: (url: string) => void | Promise<void>
}): ReactElement {
  const changeZoom = (delta: number): void => onZoomChange(clampHtmlZoom(zoom + delta))
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-2 pr-20" data-html-preview-toolbar>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
          title="Zoom out"
          aria-label="Zoom out"
          data-html-zoom-out
          disabled={zoom <= 0.5}
          onClick={() => changeZoom(-0.1)}
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text"
          title="Reset zoom"
          aria-label="Reset zoom"
          data-html-zoom-reset
          onClick={() => onZoomChange(1)}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
          title="Zoom in"
          aria-label="Zoom in"
          data-html-zoom-in
          disabled={zoom >= 3}
          onClick={() => changeZoom(0.1)}
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="ml-1 min-w-[3rem] text-right text-[11.5px] font-semibold text-ds-muted" data-html-preview-zoom>
          {Math.round(zoom * 100)}%
        </span>
      </div>
      <button
        type="button"
        className="inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md border border-ds-border px-2 text-[11.5px] font-semibold text-ds-text transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
        title="Open preview externally"
        aria-label="Open preview externally"
        data-html-open-external
        disabled={!onOpenPreviewExternal}
        onClick={() => void onOpenPreviewExternal?.(previewUrl)}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">Open</span>
      </button>
    </div>
  )
}

function HtmlPreviewFrame({
  model,
  src,
  srcDoc,
  zoom
}: {
  model: HtmlWorkspaceViewerModel
  src?: string
  srcDoc?: string
  zoom: number
}): ReactElement {
  const frameStyle = {
    transform: `scale(${zoom})`,
    transformOrigin: 'top left',
    width: `${100 / zoom}%`,
    height: `${100 / zoom}%`
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 pr-20" data-html-preview-viewport>
      <iframe
        className="h-full min-h-[18rem] w-full rounded-md border border-ds-border bg-white"
        title={model.title}
        sandbox=""
        style={frameStyle}
        {...(src ? { src } : {})}
        {...(srcDoc ? { srcDoc } : {})}
      />
    </div>
  )
}

function clampHtmlZoom(value: number): number {
  return Math.min(3, Math.max(0.5, Math.round((Number.isFinite(value) ? value : 1) * 10) / 10))
}

function isHtmlObservation(observation: WorkspaceObservation): boolean {
  return observation.view.pluginId === 'html' ||
    /\.(?:html|htm)$/i.test(observation.file.path) ||
    observation.file.mimeType === 'text/html'
}

function countTextLines(value: string): number {
  if (value.length === 0) return 0
  return value.split(/\r\n|\r|\n/u).length
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
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

function compactStrings(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function compactClassName(...values: Array<string | undefined | null | false>): string {
  return compactStrings(values).join(' ')
}
