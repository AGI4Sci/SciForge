import { useEffect, useState, type ReactNode } from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation
} from '@shared/workspace-preview'

export type TextWorkspaceViewerReplaceOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'text.replaceRange' }
>

export type TextWorkspaceViewerApplyEditHandler = (
  operation: TextWorkspaceViewerReplaceOperation
) => void | Promise<void>

export type TextWorkspaceViewerStatus =
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

export type TextWorkspaceViewerModel = {
  status: TextWorkspaceViewerStatus
  title: string
  subtitle?: string
  text: string
  lineCount: number
  characterCount: number
  truncated: boolean
  editable: boolean
  editUnavailableReason?: string
  agentSummary: string
}

export type TextWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: TextWorkspaceViewerModel
  className?: string
  onApplyEdit?: TextWorkspaceViewerApplyEditHandler
}

export function buildTextWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined,
  hasApplyEditHandler = false
): TextWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No text observation',
      message: 'Open a text workspace preview to populate this viewer.'
    })
  }

  const hasTextContext = observation.view.modality === 'text' || observation.visibleText !== undefined
  if (!hasTextContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatLabel(observation.view.modality)} observations cannot be rendered by the text viewer.`
    }, observation)
  }

  const text = observation.visibleText ?? ''
  const truncated = Boolean(observation.text?.truncated)
  const canApplyEdit = observation.actions.includes('text.replaceRange') ||
    observation.actions.includes('applyEdit') ||
    observation.actions.includes('save')
  const editable = hasApplyEditHandler && canApplyEdit && !truncated
  const editUnavailableReason = editable
    ? undefined
    : !hasApplyEditHandler
      ? 'Connect an edit apply handler before editing text.'
      : truncated
        ? 'This text preview is truncated.'
        : 'This observation does not advertise text editing.'
  const lineCount = observation.text?.lineCount ?? countTextLines(text)
  const characterCount = observation.text?.characterCount ?? text.length

  return {
    status: {
      kind: 'ready',
      title: 'Text preview ready',
      message: `${formatCount(lineCount, 'line')}, ${formatCount(characterCount, 'character')}.`
    },
    title: observation.view.title || basename(observation.file.path),
    subtitle: compactStrings([
      observation.view.pluginId,
      formatLabel(observation.view.mode)
    ]).join(' | '),
    text,
    lineCount,
    characterCount,
    truncated,
    editable,
    ...(editUnavailableReason ? { editUnavailableReason } : {}),
    agentSummary: [
      `${formatCount(lineCount, 'line')}`,
      `${formatCount(characterCount, 'character')}`,
      truncated ? 'truncated' : 'complete',
      editable ? 'editable' : 'read-only'
    ].join(', ')
  }
}

export function createTextReplaceAllOperation(input: {
  observation: WorkspaceObservation
  beforeText: string
  text: string
}): TextWorkspaceViewerReplaceOperation {
  return {
    kind: 'text.replaceRange',
    path: input.observation.file.path,
    range: {
      start: { line: 1, column: 1 },
      end: textEndPosition(input.beforeText)
    },
    text: input.text
  }
}

export function textWorkspaceViewerDraftSourceKey(
  observation: WorkspaceObservation | null | undefined,
  model: TextWorkspaceViewerModel
): string {
  return [
    observation?.file.path ?? '',
    observation?.file.mtimeMs ?? '',
    observation?.text?.lineCount ?? model.lineCount,
    observation?.text?.characterCount ?? model.characterCount,
    model.truncated ? 'truncated' : 'complete'
  ].join('\u0000')
}

export function TextWorkspaceViewer({
  observation,
  model,
  className,
  onApplyEdit
}: TextWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildTextWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const draftSourceKey = textWorkspaceViewerDraftSourceKey(observation, resolvedModel)
  const [draft, setDraft] = useState(resolvedModel.text)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'

  useEffect(() => {
    setDraft(resolvedModel.text)
  }, [draftSourceKey, resolvedModel.text])

  return (
    <section
      className={compactClassName(
        'workspace-preview-text-viewer flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
      data-workspace-preview-text-viewer
      data-status={resolvedModel.status.kind}
      data-truncated={resolvedModel.truncated ? 'true' : 'false'}
      data-editable={resolvedModel.editable ? 'true' : 'false'}
    >
      {resolvedModel.status.kind !== 'ready' ? (
        <div className="p-4 text-sm text-ds-text" role={statusRole}>
          <strong>{resolvedModel.status.title}</strong>
          <p className="mt-1 text-ds-muted">{resolvedModel.status.message}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pr-20">
          <textarea
            className="min-h-0 flex-1 resize-none rounded-md border border-ds-border bg-ds-panel p-3 font-mono text-xs leading-5 text-ds-text outline-none focus:border-ds-accent"
            data-text-preview-editor
            value={draft}
            readOnly={!resolvedModel.editable}
            spellCheck={false}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <p className="text-ds-muted">{resolvedModel.editUnavailableReason ?? resolvedModel.status.message}</p>
            <button
              type="button"
              className="rounded-md border border-ds-border px-3 py-1.5 text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
              data-text-apply-edit
              disabled={!resolvedModel.editable || !observation || !onApplyEdit}
              onClick={() => {
                if (!resolvedModel.editable || !observation || !onApplyEdit) return
                onApplyEdit(createTextReplaceAllOperation({
                  observation,
                  beforeText: resolvedModel.text,
                  text: draft
                }))
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function createInactiveModel(
  status: Extract<TextWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): TextWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Text viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatLabel(observation.view.mode)
    ]).join(' | ') : undefined,
    text: '',
    lineCount: 0,
    characterCount: 0,
    truncated: false,
    editable: false,
    editUnavailableReason: status.message,
    agentSummary: status.message
  }
}

function textEndPosition(value: string): { line: number; column: number } {
  let line = 1
  let column = 1
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '\r') {
      if (value[index + 1] === '\n') index += 1
      line += 1
      column = 1
    } else if (char === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
    index += 1
  }
  return { line, column }
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
