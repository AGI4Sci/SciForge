export const WORKSPACE_PREVIEW_PRESENTATION_MAX_TITLE_CHARS = 300
export const WORKSPACE_PREVIEW_PRESENTATION_MAX_VISIBLE_TEXT_CHARS = 6_000
export const WORKSPACE_PREVIEW_PRESENTATION_MAX_SELECTION_TEXT_CHARS = 2_000

export type WorkspacePreviewPresentationText = {
  kind: 'text'
  label?: string
  text: string
  truncated: boolean
}

export type WorkspacePreviewPresentationState = {
  schemaVersion: 1
  kind: string
  title?: string
  position?: {
    index: number
    count?: number
    label?: string
  }
  visibleContent?: WorkspacePreviewPresentationText
  selection?: {
    kind: string
    text?: string
    summary?: string
  } | null
}

export type WorkspacePreviewPresentationStateChangeHandler = (
  state: WorkspacePreviewPresentationState | null
) => void

export function boundWorkspacePreviewPresentationState(
  state: WorkspacePreviewPresentationState | null | undefined
): WorkspacePreviewPresentationState | null {
  if (!state) return null

  const kind = boundedString(state.kind, 80) || 'unknown'
  const title = boundedString(state.title, WORKSPACE_PREVIEW_PRESENTATION_MAX_TITLE_CHARS)
  const position = normalizePosition(state.position)
  const visibleContent = state.visibleContent
    ? {
        kind: 'text' as const,
        ...(boundedString(state.visibleContent.label, 120)
          ? { label: boundedString(state.visibleContent.label, 120) }
          : {}),
        ...boundedText(state.visibleContent.text, WORKSPACE_PREVIEW_PRESENTATION_MAX_VISIBLE_TEXT_CHARS),
        truncated: state.visibleContent.truncated ||
          state.visibleContent.text.trim().length > WORKSPACE_PREVIEW_PRESENTATION_MAX_VISIBLE_TEXT_CHARS
      }
    : undefined
  const selection = state.selection
    ? {
        kind: boundedString(state.selection.kind, 80) || 'unknown',
        ...(boundedString(state.selection.summary, 300)
          ? { summary: boundedString(state.selection.summary, 300) }
          : {}),
        ...(boundedString(state.selection.text, WORKSPACE_PREVIEW_PRESENTATION_MAX_SELECTION_TEXT_CHARS)
          ? { text: boundedString(state.selection.text, WORKSPACE_PREVIEW_PRESENTATION_MAX_SELECTION_TEXT_CHARS) }
          : {})
      }
    : state.selection === null
      ? null
      : undefined

  return {
    schemaVersion: 1,
    kind,
    ...(title ? { title } : {}),
    ...(position ? { position } : {}),
    ...(visibleContent ? { visibleContent } : {}),
    ...(selection !== undefined ? { selection } : {})
  }
}

export function workspacePreviewPresentationStatesEqual(
  left: WorkspacePreviewPresentationState | null,
  right: WorkspacePreviewPresentationState | null
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizePosition(
  position: WorkspacePreviewPresentationState['position']
): WorkspacePreviewPresentationState['position'] | undefined {
  if (!position || !Number.isFinite(position.index)) return undefined
  const index = Math.max(1, Math.round(position.index))
  const count = position.count != null && Number.isFinite(position.count)
    ? Math.max(index, Math.round(position.count))
    : undefined
  const label = boundedString(position.label, 120)
  return {
    index,
    ...(count != null ? { count } : {}),
    ...(label ? { label } : {})
  }
}

function boundedText(value: string, maxChars: number): { text: string } {
  return { text: value.trim().slice(0, maxChars) }
}

function boundedString(value: string | null | undefined, maxChars: number): string {
  return value?.trim().slice(0, maxChars) ?? ''
}
