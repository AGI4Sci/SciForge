import type {
  WorkspacePreviewApplyEditResult,
  WorkspacePreviewExportResult,
  WorkspacePreviewInvokeActionResult
} from '@shared/sciforge-api'
import {
  workspaceStructuredSelectionSchema,
  type WorkspaceObservation,
  type WorkspacePreviewPluginActionInput,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewToolbarAction } from './chrome-model'
import type { WorkspacePreviewHost, WorkspacePreviewHostState } from './host'

export type WorkspacePreviewActionRunnerContext = {
  state: Readonly<WorkspacePreviewHostState>
  host: WorkspacePreviewHost
}

export type WorkspacePreviewPluginActionBuildResult =
  | {
      ok: true
      action: WorkspacePreviewPluginActionInput
    }
  | {
      ok: false
      actionId: string
      reason: 'missing-observation' | 'missing-selection' | 'unsupported'
      message: string
    }

type WorkspacePreviewPluginActionBuildFailureReason = Extract<
  WorkspacePreviewPluginActionBuildResult,
  { ok: false }
>['reason']

export type WorkspacePreviewActionRunResult =
  | {
      ok: true
      kind: 'set-selection'
      actionId: string
      result: WorkspacePreviewApplyEditResult
    }
  | {
      ok: true
      kind: 'export'
      actionId: string
      result: WorkspacePreviewExportResult
    }
  | {
      ok: true
      kind: 'invoke-action'
      actionId: string
      result: WorkspacePreviewInvokeActionResult
      selectionResult?: WorkspacePreviewApplyEditResult
    }
  | {
      ok: false
      actionId: string
      reason: 'missing-session' | WorkspacePreviewPluginActionBuildFailureReason | 'bridge'
      message: string
    }

type MutableActionInput = Record<string, unknown>
type DeckObservationTextElement = NonNullable<NonNullable<WorkspaceObservation['deck']>['textElements']>[number]

const DECK_ACTION_MAX_ELEMENTS = 20
const DECK_TEXT_QUERY_MAX_CHARS = 512

export function buildWorkspacePreviewPluginActionInput(
  actionId: string,
  observation: WorkspaceObservation | null | undefined
): WorkspacePreviewPluginActionBuildResult {
  if (!observation) {
    return {
      ok: false,
      actionId,
      reason: 'missing-observation',
      message: `Action ${actionId} needs a workspace observation before it can run.`
    }
  }

  switch (actionId) {
    case 'tabular.preview':
    case 'tabular.inspectColumns':
      return buildAction(actionId, {})
    case 'tabular.filterRows':
    case 'tabular.sortRows':
      return buildAction(actionId, { maxRows: 50 })
    case 'tabular.selectCells':
      return buildAction(actionId, buildTabularSelectionInput(observation))
    case 'deck.selectSlide':
      return buildAction(actionId, buildDeckSlideInput(observation))
    case 'deck.selectText':
      return buildAction(actionId, buildDeckTextInput(observation))
    case 'molecular.select':
      return buildAction(actionId, buildMolecularSelectInput(observation))
    case 'molecular.measureDistance':
      return buildAction(actionId, buildMolecularDistanceInput(observation))
    case 'sequence.selectRegion':
      return buildAction(actionId, buildSequenceRegionInput(observation))
    case 'omics.selectDataset':
      return buildAction(actionId, buildOmicsDatasetInput(observation))
    case 'bioimaging.selectRegion':
      return buildAction(actionId, buildBioimagingRegionInput(observation))
    case 'bioimaging.selectChannels':
      return buildAction(actionId, buildBioimagingChannelsInput(observation))
    case 'bioimaging.annotateRegion':
      return buildAction(actionId, buildBioimagingAnnotationInput(observation))
    case 'bioimaging.exportRoiSet':
      return buildAction(actionId, buildBioimagingExportInput(observation))
    case 'spectra.selectPeaksByRange':
      return buildAction(actionId, buildSpectraRangeInput(observation))
    case 'spectra.annotateRange':
      return buildAction(actionId, buildSpectraAnnotationInput(observation))
    case 'spectra.exportPeakList':
      return buildAction(actionId, buildSpectraExportInput(observation))
    default:
      return {
        ok: false,
        actionId,
        reason: 'unsupported',
        message: `Action ${actionId} does not have a default renderer runner yet.`
      }
  }
}

export async function runWorkspacePreviewToolbarAction(
  action: WorkspacePreviewToolbarAction,
  context: WorkspacePreviewActionRunnerContext
): Promise<WorkspacePreviewActionRunResult> {
  const session = context.state.session
  if (!session) {
    return {
      ok: false,
      actionId: action.id,
      reason: 'missing-session',
      message: 'Open a workspace preview session before running preview actions.'
    }
  }

  if (action.id === 'workspace.setSelection') {
    const selection = context.state.observation?.selection ?? context.state.session?.selection
    if (!selection) {
      return {
        ok: false,
        actionId: action.id,
        reason: 'missing-selection',
        message: 'No structured selection is available to apply.'
      }
    }

    const result = await context.host.setSelection(selection, {
      sessionId: session.id,
      path: session.path
    })
    return result.ok
      ? { ok: true, kind: 'set-selection', actionId: action.id, result }
      : { ok: false, actionId: action.id, reason: 'bridge', message: result.message }
  }

  if (action.id.startsWith('workspace.export:')) {
    const format = action.format ?? action.id.slice('workspace.export:'.length)
    const result = await context.host.export(session.id, {
      kind: 'workspace-file',
      format
    })
    return result.ok
      ? { ok: true, kind: 'export', actionId: action.id, result }
      : { ok: false, actionId: action.id, reason: 'bridge', message: result.message }
  }

  const actionInput = buildWorkspacePreviewPluginActionInput(action.id, context.state.observation)
  if (!actionInput.ok) return actionInput

  const result = await context.host.invokeAction(session.id, actionInput.action)
  if (!result.ok) {
    return {
      ok: false,
      actionId: action.id,
      reason: 'bridge',
      message: result.message
    }
  }

  const selection = extractStructuredSelection(result.result)
  const selectionResult = selection
    ? await context.host.setSelection(selection, {
        sessionId: session.id,
        path: session.path
      })
    : undefined

  if (selectionResult && !selectionResult.ok) {
    return {
      ok: false,
      actionId: action.id,
      reason: 'bridge',
      message: selectionResult.message
    }
  }

  return {
    ok: true,
    kind: 'invoke-action',
    actionId: action.id,
    result,
    selectionResult
  }
}

function buildAction(
  actionId: string,
  input: MutableActionInput | null
): WorkspacePreviewPluginActionBuildResult {
  if (!input) {
    return {
      ok: false,
      actionId,
      reason: 'missing-selection',
      message: `Action ${actionId} needs a current selection or visible preview detail before it can run.`
    }
  }

  return {
    ok: true,
    action: {
      actionId,
      input
    }
  }
}

function buildMolecularSelectInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'molecular' ? observation.selection : null
  const input: MutableActionInput = {}

  if (selection?.chains?.length) input.chains = selection.chains
  if (selection?.residues?.length) input.residues = selection.residues
  if (selection?.ligands?.length) input.ligands = selection.ligands
  if (selection?.atoms?.length) input.atoms = selection.atoms
  if (Object.keys(input).length) return input

  const firstChain = observation.molecular?.chains?.[0]
  if (firstChain) return { chains: [firstChain] }

  const firstLigand = observation.molecular?.ligands?.[0]
  if (firstLigand) return { ligands: [firstLigand] }

  return null
}

function buildTabularSelectionInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'tabular' ? observation.selection : null
  if (selection) {
    return {
      selection: {
        ...(selection.sheet ? { sheet: selection.sheet } : {}),
        ranges: selection.ranges,
        cells: selection.cells?.map((cell) => ({
          row: cell.row,
          column: cell.column
        })) ?? [],
        includeCellValues: true
      }
    }
  }

  const table = observation.tables?.[0]
  if (!table) return null
  const rowEnd = Math.max(0, Math.min((table.rowCount ?? 1) - 1, 4))
  const columnEnd = Math.max(0, Math.min((table.columnCount ?? 1) - 1, 4))
  return {
    selection: {
      ranges: [{
        rowStart: 0,
        rowEnd,
        columnStart: 0,
        columnEnd
      }],
      includeCellValues: true
    }
  }
}

function buildDeckSlideInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'deck' ? observation.selection : null
  const selectedSlideId = selection?.slideIds[0]
  if (selectedSlideId) return { slideId: selectedSlideId, maxElements: DECK_ACTION_MAX_ELEMENTS }

  const firstSlide = observation.slides?.[0]
  if (!firstSlide) return null
  return {
    slideId: firstSlide.id,
    maxElements: DECK_ACTION_MAX_ELEMENTS
  }
}

function buildDeckTextInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'deck' ? observation.selection : null
  const textElements = (observation.deck?.textElements ?? []).filter(hasDeckTextElementIdentity)
  const textElement = firstSelectedDeckTextElement(textElements, selection?.elementIds) ?? textElements[0]
  if (!textElement) return null

  const query = boundedDeckTextQuery(textElement.text)
  return {
    slideId: textElement.slideId,
    elementId: textElement.elementId,
    kind: textElement.kind,
    ...(query ? { query } : {}),
    maxElements: DECK_ACTION_MAX_ELEMENTS
  }
}

function hasDeckTextElementIdentity(element: DeckObservationTextElement): boolean {
  return Boolean(element.slideId.trim() && element.elementId.trim())
}

function firstSelectedDeckTextElement(
  textElements: DeckObservationTextElement[],
  elementIds: string[] | undefined
): DeckObservationTextElement | undefined {
  if (!elementIds?.length) return undefined

  const textElementById = new Map<string, DeckObservationTextElement>()
  for (const textElement of textElements) {
    if (!textElementById.has(textElement.elementId)) {
      textElementById.set(textElement.elementId, textElement)
    }
  }

  for (const elementId of elementIds) {
    const textElement = textElementById.get(elementId)
    if (textElement) return textElement
  }

  return undefined
}

function boundedDeckTextQuery(text: string): string | undefined {
  const query = text.trim().slice(0, DECK_TEXT_QUERY_MAX_CHARS).trim()
  return query || undefined
}

function buildMolecularDistanceInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'molecular' ? observation.selection : null
  const atoms = selection?.atoms
    ?.map((atom) => ({
      id: atom.id,
      index: atom.index
    }))
    .filter((atom) => atom.id || atom.index !== undefined)
    .slice(0, 2)

  return atoms && atoms.length === 2 ? { atoms } : null
}

function buildSequenceRegionInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'sequence' ? observation.selection : null
  const firstRange = selection?.ranges[0]
  if (!selection?.sequenceId || !firstRange) return null

  return {
    reference: selection.sequenceId,
    start: firstRange.start,
    end: firstRange.end,
    ...(firstRange.strand ? { strand: firstRange.strand } : {})
  }
}

function buildOmicsDatasetInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'omics' ? observation.selection : null
  const input: MutableActionInput = {}

  if (selection?.matrixIds?.length) input.matrixIds = selection.matrixIds
  if (selection?.obsKeys?.length) input.obsKeys = selection.obsKeys
  if (selection?.varKeys?.length) input.varKeys = selection.varKeys
  if (selection?.embeddings?.length) input.embeddingNames = selection.embeddings
  if (selection?.ranges?.length) input.ranges = selection.ranges
  if (Object.keys(input).length) return input

  const firstEmbedding = observation.omics?.embeddings?.[0]
  return firstEmbedding ? { embeddingNames: [firstEmbedding] } : null
}

function buildBioimagingRegionInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  const region = selection?.regions?.[0]
  if (!region) return null

  return {
    region,
    ...(selection?.roiIds?.[0] ? { roiId: selection.roiIds[0] } : {})
  }
}

function buildBioimagingChannelsInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  if (selection?.channels?.length) return { channels: selection.channels }

  const firstChannel = observation.bioimaging?.channels?.[0]
  return firstChannel ? { channels: [firstChannel] } : null
}

function buildBioimagingAnnotationInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  const region = selection?.regions?.[0]
  if (!region) return null

  return {
    region,
    label: 'ROI annotation',
    ...(selection?.roiIds?.[0] ? { roiId: selection.roiIds[0] } : {}),
    ...(selection?.channels?.length ? { channels: selection.channels } : {})
  }
}

function buildBioimagingExportInput(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  if (!selection?.roiIds?.length && !selection?.channels?.length && !selection?.regions?.length) return null
  return { selection }
}

function buildSpectraRangeInput(observation: WorkspaceObservation): MutableActionInput | null {
  const range = firstSpectraRange(observation)
  return range ? { range } : null
}

function buildSpectraAnnotationInput(observation: WorkspaceObservation): MutableActionInput | null {
  const range = firstSpectraRange(observation)
  return range
    ? {
        range,
        label: 'Spectra annotation'
      }
    : null
}

function buildSpectraExportInput(observation: WorkspaceObservation): MutableActionInput | null {
  const range = firstSpectraRange(observation)
  return range
    ? {
        range,
        format: 'csv'
      }
    : null
}

function firstSpectraRange(observation: WorkspaceObservation): MutableActionInput | null {
  const selection = observation.selection?.kind === 'spectra' ? observation.selection : null
  const range = selection?.ranges[0]
  if (!range) return null

  return {
    mzMin: range.xStart,
    mzMax: range.xEnd,
    ...(range.yStart !== undefined ? { intensityMin: range.yStart } : {}),
    ...(range.yEnd !== undefined ? { intensityMax: range.yEnd } : {})
  }
}

function extractStructuredSelection(result: unknown): WorkspaceStructuredSelection | null {
  if (!isRecord(result)) return null
  const parsed = workspaceStructuredSelectionSchema.safeParse(result.selection)
  return parsed.success ? parsed.data : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
