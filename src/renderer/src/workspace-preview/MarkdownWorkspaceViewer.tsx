import {
  useEffect,
  useRef,
  type ReactElement
} from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import {
  WriteMarkdownPreview,
  type WriteMarkdownWorkspaceImageLoader
} from '../components/write/WriteMarkdownPreview'
import {
  createTextReplaceAllOperation,
  TextWorkspaceViewer,
  type TextWorkspaceViewerApplyEditHandler
} from './TextWorkspaceViewer'

export type MarkdownWorkspaceViewerApplyEditHandler = (
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>
) => void | Promise<void>

export type MarkdownWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  className?: string
  onApplyEdit?: MarkdownWorkspaceViewerApplyEditHandler
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
}

export type MarkdownWorkspaceViewerModel = {
  status: 'ready' | 'empty' | 'unsupported'
  title: string
  subtitle?: string
  markdown: string
  truncated: boolean
  editable: boolean
  summary: string
}

export function buildMarkdownWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined,
  hasApplyEditHandler = false
): MarkdownWorkspaceViewerModel {
  if (!observation) {
    return {
      status: 'empty',
      title: 'Markdown viewer',
      markdown: '',
      truncated: false,
      editable: false,
      summary: 'Open a Markdown workspace preview to populate this viewer.'
    }
  }

  if (!isMarkdownObservation(observation)) {
    return {
      status: 'unsupported',
      title: observation.view.title || basename(observation.file.path),
      subtitle: compactStrings([observation.view.pluginId, formatLabel(observation.view.mode)]).join(' | '),
      markdown: '',
      truncated: false,
      editable: false,
      summary: `${formatLabel(observation.view.modality)} observations cannot be rendered by the Markdown viewer.`
    }
  }

  const markdown = observation.visibleText ?? ''
  const truncated = Boolean(observation.text?.truncated)
  const canApplyEdit = observation.actions.includes('text.replaceRange') ||
    observation.actions.includes('applyEdit') ||
    observation.actions.includes('save')
  const editable = hasApplyEditHandler && canApplyEdit && !truncated
  const characterCount = observation.text?.characterCount ?? markdown.length
  const lineCount = observation.text?.lineCount ?? countTextLines(markdown)

  return {
    status: 'ready',
    title: observation.view.title || basename(observation.file.path),
    subtitle: compactStrings([observation.view.pluginId, formatLabel(observation.view.mode)]).join(' | '),
    markdown,
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

export function MarkdownWorkspaceViewer({
  observation,
  className,
  onApplyEdit,
  loadWorkspaceImage
}: MarkdownWorkspaceViewerProps): ReactElement {
  const model = buildMarkdownWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const previewPaneRef = useRef<HTMLDivElement | null>(null)
  const applyTextEdit: TextWorkspaceViewerApplyEditHandler = async (operation) => {
    await onApplyEdit?.(operation)
  }

  useEffect(() => {
    const pane = previewPaneRef.current
    if (!pane) return undefined
    const wheelListenerOptions: AddEventListenerOptions = { capture: true, passive: false }
    const onWheel = (event: WheelEvent): void => {
      if (!scrollMarkdownPreviewPane(pane, normalizeMarkdownPreviewWheelDeltaY(pane, event))) return
      event.preventDefault()
      event.stopPropagation()
    }
    pane.addEventListener('wheel', onWheel, wheelListenerOptions)
    return () => pane.removeEventListener('wheel', onWheel, wheelListenerOptions)
  }, [model.status])

  return (
    <section
      className={compactClassName('workspace-preview-markdown-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-markdown-viewer
      data-status={model.status}
      data-editable={model.editable ? 'true' : 'false'}
      data-truncated={model.truncated ? 'true' : 'false'}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-4 py-3 pr-20">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ds-text">{model.title}</h3>
          {model.subtitle ? <p className="mt-1 text-xs text-ds-muted">{model.subtitle}</p> : null}
        </div>
        <p className="shrink-0 text-xs text-ds-muted" data-markdown-agent-summary>
          {model.summary}
        </p>
      </header>

      {model.status !== 'ready' ? (
        <div
          className="p-4 text-sm text-ds-text"
          role={model.status === 'unsupported' ? 'alert' : 'status'}
        >
          <strong>{model.status === 'empty' ? 'No Markdown observation' : 'Unsupported observation'}</strong>
          <p className="mt-1 text-ds-muted">{model.summary}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
          <div className="min-h-0 overflow-hidden border-b border-ds-border lg:border-b-0 lg:border-r">
            <TextWorkspaceViewer
              observation={observation}
              className="h-full min-h-0"
              showHeader={false}
              onApplyEdit={onApplyEdit ? applyTextEdit : undefined}
            />
          </div>
          <div
            ref={previewPaneRef}
            className="h-full min-h-0 overflow-auto bg-ds-bg px-5 py-4 pr-20"
            data-markdown-preview-pane
          >
            <WriteMarkdownPreview
              content={model.markdown}
              isMarkdown
              filePath={observation?.file.path}
              workspaceRoot={observation?.file.workspaceRoot}
              loadWorkspaceImage={loadWorkspaceImage}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function scrollMarkdownPreviewPane(pane: HTMLElement, deltaY: number): boolean {
  if (deltaY === 0) return false
  const maxScrollTop = pane.scrollHeight - pane.clientHeight
  if (maxScrollTop <= 0) return false

  const nextScrollTop = Math.min(
    maxScrollTop,
    Math.max(0, pane.scrollTop + deltaY)
  )
  const previousScrollTop = pane.scrollTop
  if (nextScrollTop === previousScrollTop) return false

  if (applyMarkdownPreviewScroll(pane, nextScrollTop, previousScrollTop)) return true

  try {
    pane.scrollTop = nextScrollTop
  } catch {
    return false
  }
  return pane.scrollTop !== previousScrollTop
}

function applyMarkdownPreviewScroll(
  pane: HTMLElement,
  nextScrollTop: number,
  previousScrollTop: number
): boolean {
  try {
    pane.scrollTo({ top: nextScrollTop, behavior: 'auto' })
    if (pane.scrollTop !== previousScrollTop) return true
  } catch {
    // Older wrappers may not expose scrollTo with object options.
  }

  try {
    pane.scrollBy({ top: nextScrollTop - previousScrollTop, behavior: 'auto' })
  } catch {
    return false
  }
  return pane.scrollTop !== previousScrollTop
}

function normalizeMarkdownPreviewWheelDeltaY(pane: HTMLElement, event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * pane.clientHeight
  return event.deltaY
}

export function createMarkdownReplaceAllOperation(input: {
  observation: WorkspaceObservation
  beforeText: string
  text: string
}): Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }> {
  return createTextReplaceAllOperation(input)
}

function isMarkdownObservation(observation: WorkspaceObservation): boolean {
  return observation.view.pluginId === 'markdown' ||
    /\.(?:md|mdx|markdown)$/i.test(observation.file.path) ||
    observation.file.mimeType === 'text/markdown' ||
    observation.file.mimeType === 'text/x-markdown'
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
