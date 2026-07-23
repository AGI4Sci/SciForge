import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

export type TextWorkspaceViewerSaveResult =
  | { ok: true }
  | { ok: false; message?: string }

type TextWorkspaceViewerSaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message?: string }

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

export async function saveTextWorkspaceViewerDraft(input: {
  observation: WorkspaceObservation
  beforeText: string
  text: string
  onApplyEdit: TextWorkspaceViewerApplyEditHandler
}): Promise<TextWorkspaceViewerSaveResult> {
  try {
    await input.onApplyEdit(createTextReplaceAllOperation(input))
    return { ok: true }
  } catch (error) {
    const message = errorMessage(error)
    return message ? { ok: false, message } : { ok: false }
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

export function textWorkspaceSelectionOffsets(
  text: string,
  range: Extract<WorkspaceObservation['selection'], { kind: 'text' }>['ranges'][number]
): { start: number; end: number } {
  const offset = (line: number, column: number): number => {
    const lines = text.split(/(?<=\n)/u)
    const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1))
    const prefix = lines.slice(0, lineIndex).join('').length
    const contentLength = (lines[lineIndex] ?? '').replace(/\r?\n$/u, '').length
    return prefix + Math.max(0, Math.min(contentLength, column - 1))
  }
  const start = offset(range.startLine, range.startColumn)
  const end = offset(range.endLine, range.endColumn)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

export function TextWorkspaceViewer({
  observation,
  model,
  className,
  onApplyEdit
}: TextWorkspaceViewerProps): ReactNode {
  const { t } = useTranslation('common')
  const resolvedModel = model ?? buildTextWorkspaceViewerModel(observation, Boolean(onApplyEdit))
  const draftSourceKey = textWorkspaceViewerDraftSourceKey(observation, resolvedModel)
  const [draft, setDraft] = useState(resolvedModel.text)
  const [persistedText, setPersistedText] = useState(resolvedModel.text)
  const [saveState, setSaveState] = useState<TextWorkspaceViewerSaveState>({ kind: 'idle' })
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const draftRef = useRef(draft)
  const persistedTextRef = useRef(persistedText)
  const draftSourceKeyRef = useRef(draftSourceKey)
  const resolvedTextRef = useRef(resolvedModel.text)
  const saveRequestIdRef = useRef(0)
  const savingRef = useRef(false)
  const savingTextRef = useRef<string | null>(null)
  const pendingSaveSourceKeyRef = useRef<string | null>(null)
  const initialTextRange = observation?.selection?.kind === 'text'
    ? observation.selection.ranges[0]
    : undefined
  const initialTextRangeKey = JSON.stringify(initialTextRange ?? null)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const dirty = draft !== persistedText

  if (
    savingRef.current &&
    savingTextRef.current !== null &&
    resolvedModel.text === savingTextRef.current
  ) {
    pendingSaveSourceKeyRef.current = draftSourceKey
  }

  draftRef.current = draft
  persistedTextRef.current = persistedText
  draftSourceKeyRef.current = draftSourceKey
  resolvedTextRef.current = resolvedModel.text

  useEffect(() => {
    const sourceUpdateReflectsPendingSave = pendingSaveSourceKeyRef.current === draftSourceKey
    pendingSaveSourceKeyRef.current = null
    if (!sourceUpdateReflectsPendingSave) {
      saveRequestIdRef.current += 1
      savingRef.current = false
      savingTextRef.current = null
      setSaveState({ kind: 'idle' })
    }
    setDraft(resolvedModel.text)
    setPersistedText(resolvedModel.text)
    draftRef.current = resolvedModel.text
    persistedTextRef.current = resolvedModel.text
  }, [draftSourceKey, resolvedModel.text])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !initialTextRange || draft !== resolvedModel.text) return
    const offsets = textWorkspaceSelectionOffsets(resolvedModel.text, initialTextRange)
    editor.setSelectionRange(offsets.start, offsets.end)
    editor.scrollTop = Math.max(0, initialTextRange.startLine - 1) * 20
  }, [draft, initialTextRange, initialTextRangeKey, resolvedModel.text])

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!resolvedModel.editable || !observation || !onApplyEdit || savingRef.current) return
    const text = draftRef.current
    const beforeText = persistedTextRef.current
    if (text === beforeText) return

    const sourceKey = draftSourceKeyRef.current
    const requestId = saveRequestIdRef.current + 1
    saveRequestIdRef.current = requestId
    savingRef.current = true
    savingTextRef.current = text
    setSaveState({ kind: 'saving' })
    const result = await saveTextWorkspaceViewerDraft({
      observation,
      beforeText,
      text,
      onApplyEdit
    })
    if (
      requestId !== saveRequestIdRef.current ||
      (
        sourceKey !== draftSourceKeyRef.current &&
        resolvedTextRef.current !== text
      )
    ) return
    savingRef.current = false
    savingTextRef.current = null

    if (!result.ok) {
      setSaveState({ kind: 'error', ...(result.message ? { message: result.message } : {}) })
      return
    }

    persistedTextRef.current = text
    setPersistedText(text)
    setSaveState(draftRef.current === text ? { kind: 'saved' } : { kind: 'idle' })
  }, [observation, onApplyEdit, resolvedModel.editable])

  const saveStatus = !resolvedModel.editable
    ? resolvedModel.editUnavailableReason ?? resolvedModel.status.message
    : saveState.kind === 'saving'
      ? t('workspacePreviewTextSaving')
      : saveState.kind === 'error'
        ? t('workspacePreviewTextSaveFailed', {
            message: saveState.message ?? t('workspacePreviewTextSaveUnknownError')
          })
        : saveState.kind === 'saved' && !dirty
          ? t('workspacePreviewTextSaved')
          : dirty
            ? t('workspacePreviewTextUnsaved')
            : t('workspacePreviewTextNoUnsavedChanges')

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
            ref={editorRef}
            className="min-h-0 flex-1 resize-none rounded-md border border-ds-border bg-ds-panel p-3 font-mono text-xs leading-5 text-ds-text outline-none focus:border-ds-accent"
            data-text-preview-editor
            data-initial-selection={initialTextRange ? 'true' : 'false'}
            value={draft}
            readOnly={!resolvedModel.editable}
            spellCheck={false}
            onChange={(event) => {
              const nextDraft = event.currentTarget.value
              draftRef.current = nextDraft
              setDraft(nextDraft)
              if (saveState.kind === 'saved' || saveState.kind === 'error') {
                setSaveState({ kind: 'idle' })
              }
            }}
            onKeyDown={(event) => {
              if (
                resolvedModel.editable &&
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 's'
              ) {
                event.preventDefault()
                void saveDraft()
              }
            }}
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <p
              className={saveState.kind === 'error' ? 'text-ds-danger' : 'text-ds-muted'}
              data-text-save-status={saveState.kind}
              role={saveState.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {saveStatus}
            </p>
            <button
              type="button"
              className="rounded-md border border-ds-border bg-ds-panel px-3 py-1.5 font-medium text-ds-text disabled:cursor-not-allowed disabled:opacity-50"
              data-text-save
              disabled={
                !resolvedModel.editable ||
                !observation ||
                !onApplyEdit ||
                !dirty ||
                saveState.kind === 'saving'
              }
              onClick={() => void saveDraft()}
            >
              {saveState.kind === 'saving'
                ? t('workspacePreviewTextSavingButton')
                : t('workspacePreviewTextSave')}
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

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message.trim() || undefined
  if (typeof error === 'string') return error.trim() || undefined
  return undefined
}
