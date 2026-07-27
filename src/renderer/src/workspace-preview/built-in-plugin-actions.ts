import {
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import {
  createInvokeWorkspacePreviewAction,
  createUiWorkspacePreviewAction
} from './action-runner'
import type { WorkspacePreviewActionContribution } from './registry'

type ActionInput = Record<string, unknown>
type DeckTextElement = NonNullable<NonNullable<WorkspaceObservation['deck']>['textElements']>[number]

const DECK_ACTION_MAX_ELEMENTS = 20
const DECK_TEXT_QUERY_MAX_CHARS = 512

const invoke = (
  id: string,
  label: string,
  buildInput?: (observation: WorkspaceObservation) => ActionInput | null
): WorkspacePreviewActionContribution => createInvokeWorkspacePreviewAction({
  id,
  label,
  buildInput,
  extractSelection: extractStructuredSelection
})

const explicitUi = (id: string, label: string): WorkspacePreviewActionContribution =>
  createUiWorkspacePreviewAction({ id, label, requiresExplicitUi: true })

export const TEXT_WORKSPACE_PREVIEW_ACTIONS: readonly WorkspacePreviewActionContribution[] = [
  explicitUi('text.replaceRange', 'Replace Text')
]

export const TABULAR_WORKSPACE_PREVIEW_ACTIONS: readonly WorkspacePreviewActionContribution[] = [
  invoke('tabular.preview', 'Preview Table'),
  invoke('tabular.inspectColumns', 'Inspect Columns'),
  invoke('tabular.filterRows', 'Filter Rows', () => ({ maxRows: 50 })),
  invoke('tabular.sortRows', 'Sort Rows', () => ({ maxRows: 50 })),
  invoke('tabular.selectCells', 'Select Cells', buildTabularSelectionInput),
  explicitUi('tabular.updateCell', 'Tabular Update Cell'),
  explicitUi('tabular.insertRows', 'Tabular Insert Rows'),
  explicitUi('tabular.insertColumns', 'Tabular Insert Columns'),
  explicitUi('tabular.deleteRows', 'Tabular Delete Rows'),
  explicitUi('tabular.deleteColumns', 'Tabular Delete Columns')
]

export const DECK_WORKSPACE_PREVIEW_ACTIONS: readonly WorkspacePreviewActionContribution[] = [
  invoke('deck.selectSlide', 'Select Slide', buildDeckSlideInput),
  invoke('deck.selectText', 'Select Text', buildDeckTextInput),
  explicitUi('deck.updateTextElement', 'Update Text Element')
]

function buildTabularSelectionInput(observation: WorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'tabular' ? observation.selection : null
  if (selection) {
    return {
      selection: {
        ...(selection.sheet ? { sheet: selection.sheet } : {}),
        ranges: selection.ranges,
        cells: selection.cells?.map((cell) => ({ row: cell.row, column: cell.column })) ?? [],
        includeCellValues: true
      }
    }
  }

  const table = observation.tables?.[0]
  if (!table) return null
  return {
    selection: {
      ranges: [{
        rowStart: 0,
        rowEnd: Math.max(0, Math.min((table.rowCount ?? 1) - 1, 4)),
        columnStart: 0,
        columnEnd: Math.max(0, Math.min((table.columnCount ?? 1) - 1, 4))
      }],
      includeCellValues: true
    }
  }
}

function buildDeckSlideInput(observation: WorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'deck' ? observation.selection : null
  const slideId = selection?.slideIds[0] ?? observation.slides?.[0]?.id
  return slideId ? { slideId, maxElements: DECK_ACTION_MAX_ELEMENTS } : null
}

function buildDeckTextInput(observation: WorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'deck' ? observation.selection : null
  const elements = (observation.deck?.textElements ?? []).filter(hasDeckTextElementIdentity)
  const selectedIds = new Set(selection?.elementIds ?? [])
  const element = elements.find((candidate) => selectedIds.has(candidate.elementId)) ?? elements[0]
  if (!element) return null
  const query = element.text.trim().slice(0, DECK_TEXT_QUERY_MAX_CHARS).trim()
  return {
    slideId: element.slideId,
    elementId: element.elementId,
    kind: element.kind,
    ...(query ? { query } : {}),
    maxElements: DECK_ACTION_MAX_ELEMENTS
  }
}

function hasDeckTextElementIdentity(element: DeckTextElement): boolean {
  return Boolean(element.slideId.trim() && element.elementId.trim())
}

function extractStructuredSelection(result: unknown): WorkspaceStructuredSelection | null {
  if (!isRecord(result)) return null
  const candidates = [
    result.selection,
    isRecord(result.state) ? result.state.selection : undefined,
    isRecord(result.state) && isRecord(result.state.measurement)
      ? result.state.measurement.selection
      : undefined
  ]
  for (const candidate of candidates) {
    const parsed = workspaceStructuredSelectionSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
