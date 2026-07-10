import {
  useEffect,
  useState,
  type ReactElement
} from 'react'
import { Columns2, Eye, PencilLine } from 'lucide-react'
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
import { CopyTextButton } from '../components/CopyTextButton'

export type MarkdownWorkspaceViewerApplyEditHandler = (
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>
) => void | Promise<void>

export type MarkdownWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  className?: string
  onApplyEdit?: MarkdownWorkspaceViewerApplyEditHandler
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
  initialMode?: MarkdownWorkspaceViewerMode
}

export type MarkdownWorkspaceViewerMode = 'edit' | 'preview' | 'split'

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
      title: displayFilePath(observation.file.path, observation.file.workspaceRoot),
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
    title: displayFilePath(observation.file.path, observation.file.workspaceRoot),
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
  loadWorkspaceImage,
  initialMode = 'preview'
}: MarkdownWorkspaceViewerProps): ReactElement {
  const model = buildMarkdownWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const applyTextEdit: TextWorkspaceViewerApplyEditHandler = async (operation) => {
    await onApplyEdit?.(operation)
  }
  const [mode, setMode] = useState<MarkdownWorkspaceViewerMode>(initialMode)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode, observation?.file.path])

  const showEditor = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <section
      className={compactClassName('workspace-preview-markdown-viewer flex h-full min-h-0 flex-col', className)}
      data-workspace-preview-markdown-viewer
      data-status={model.status}
      data-editable={model.editable ? 'true' : 'false'}
      data-truncated={model.truncated ? 'true' : 'false'}
    >
      <header className="flex items-start justify-between gap-3 border-b border-ds-border px-4 py-3 pr-20">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-ds-text" title={model.title}>{model.title}</h3>
            {model.status === 'ready' ? (
              <CopyTextButton text={model.title} iconOnly className="-mr-1" />
            ) : null}
          </div>
          {model.subtitle ? <p className="mt-1 text-xs text-ds-muted">{model.subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {model.status === 'ready' ? (
            <MarkdownModeControl mode={mode} onModeChange={setMode} />
          ) : null}
        </div>
        <p className="sr-only" data-markdown-agent-summary>
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
        <div
          className={compactClassName(
            'min-h-0 flex-1',
            showEditor && showPreview ? 'grid grid-cols-1 lg:grid-cols-2' : 'flex flex-col'
          )}
          data-markdown-view-mode={mode}
        >
          {showEditor ? (
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
            <div
              className={compactClassName(
                'min-h-0 overflow-auto bg-ds-bg px-5 py-4 pr-20',
                showEditor ? false : 'flex-1'
              )}
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
          ) : null}
        </div>
      )}
    </section>
  )
}

function MarkdownModeControl({
  mode,
  onModeChange
}: {
  mode: MarkdownWorkspaceViewerMode
  onModeChange: (mode: MarkdownWorkspaceViewerMode) => void
}): ReactElement {
  const modes: Array<{ mode: MarkdownWorkspaceViewerMode; label: string; icon: ReactElement }> = [
    { mode: 'edit', label: 'Edit', icon: <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'preview', label: 'Preview', icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" /> },
    { mode: 'split', label: 'Split', icon: <Columns2 className="h-3.5 w-3.5" aria-hidden="true" /> }
  ]
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-lg border border-ds-border bg-ds-panel p-1"
      data-markdown-mode-control
    >
      {modes.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onModeChange(item.mode)}
          className={compactClassName(
            'inline-flex h-7 w-7 min-w-0 items-center justify-center rounded-md text-[11.5px] font-semibold transition',
            mode === item.mode
              ? 'bg-white text-accent shadow-sm ring-1 ring-ds-border dark:bg-white/10 dark:ring-white/10'
              : 'text-ds-muted hover:bg-ds-hover hover:text-ds-text'
          )}
          title={item.label}
          aria-label={item.label}
          aria-pressed={mode === item.mode}
          data-markdown-mode-button={item.mode}
        >
          {item.icon}
          <span className="sr-only">{item.label}</span>
        </button>
      ))}
    </div>
  )
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

function displayFilePath(filePath: string, workspaceRoot?: string): string {
  if (isAbsoluteFilePath(filePath)) return filePath
  const root = workspaceRoot?.trim()
  if (!root) return filePath
  return `${root.replace(/[\\/]+$/u, '')}/${filePath.replace(/^[\\/]+/u, '')}`
}

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') ||
    filePath.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/u.test(filePath)
}

function compactStrings(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function compactClassName(...values: Array<string | undefined | null | false>): string {
  return compactStrings(values).join(' ')
}
