import {
  type WorkspaceStructuredSelection
} from '@sciforge/domain-sdk/workspace-preview'
import {
  decodeLifeScienceSelection,
  decodeLifeScienceWorkspaceObservation,
  encodeLifeScienceSelection,
  type LifeScienceWorkspaceObservation
} from '../wire'
import type {
  WorkspacePreviewActionContribution,
  WorkspacePreviewContributionContext
} from './contribution-types'

type ActionInput = Record<string, unknown>

const invoke = (
  id: string,
  label: string,
  buildInput?: (observation: LifeScienceWorkspaceObservation) => ActionInput | null
): WorkspacePreviewActionContribution => ({
  id,
  label,
  run: async (context) => runInvokeAction({ id, buildInput }, context)
})

const explicitUi = (id: string, label: string): WorkspacePreviewActionContribution => ({
  id,
  label,
  requiresExplicitUi: true,
  run: async () => failure(id, 'unsupported', 'This action needs a dedicated editor control before it can run.')
})

export const MOLECULAR_WORKSPACE_PREVIEW_ACTIONS = Object.freeze([
  invoke('molecular.preview', 'Preview Structure'),
  invoke('molecular.workbench', 'Molecular Workbench', buildMolecularWorkbenchInput)
])

export const SEQUENCE_WORKSPACE_PREVIEW_ACTIONS = Object.freeze([
  invoke('sequence.selectRegion', 'Select Region', buildSequenceRegionInput),
  explicitUi('sequence.search', 'Search Sequence'),
  invoke('sequence.inspectFeatures', 'Inspect Features'),
  invoke('sequence.exportSummary', 'Export Summary')
])

export const OMICS_WORKSPACE_PREVIEW_ACTIONS = Object.freeze([
  invoke('omics.preview', 'Preview Matrix'),
  invoke('omics.inspectMetadata', 'Inspect Metadata'),
  invoke('omics.declareCapabilities', 'Show Capabilities'),
  invoke('omics.selectDataset', 'Select Dataset', buildOmicsDatasetInput)
])

export const BIOIMAGING_WORKSPACE_PREVIEW_ACTIONS = Object.freeze([
  invoke('bioimaging.observeMetadata', 'Observe Metadata'),
  invoke('bioimaging.inspectHeader', 'Inspect Header'),
  invoke('bioimaging.describeTilePlan', 'Describe Tiles'),
  invoke('bioimaging.selectRegion', 'Select ROI', buildBioimagingRegionInput),
  invoke('bioimaging.selectChannels', 'Select Channels', buildBioimagingChannelsInput),
  invoke('bioimaging.annotateRegion', 'Annotate ROI', buildBioimagingAnnotationInput),
  invoke('bioimaging.exportRoiSet', 'Export ROI Set', buildBioimagingExportInput)
])

export const SPECTRA_WORKSPACE_PREVIEW_ACTIONS = Object.freeze([
  invoke('spectra.preview', 'Preview Spectra'),
  invoke('spectra.inspectScans', 'Inspect Scans'),
  invoke('spectra.selectPeaksByRange', 'Select Peaks', buildSpectraRangeInput),
  invoke('spectra.annotateRange', 'Annotate Range', buildSpectraAnnotationInput),
  invoke('spectra.exportPeakList', 'Export Peaks', buildSpectraExportInput)
])

async function runInvokeAction(
  input: Readonly<{
    id: string
    buildInput?: (observation: LifeScienceWorkspaceObservation) => ActionInput | null
  }>,
  context: WorkspacePreviewContributionContext
): Promise<Record<string, unknown>> {
  const session = context.state.session
  if (!session) return failure(input.id, 'missing-session', 'Open a workspace preview session before running preview actions.')
  const observation = decodeLifeScienceWorkspaceObservation(context.state.observation)
  if (input.buildInput && !observation) {
    return failure(input.id, 'missing-observation', `Action ${input.id} needs a workspace observation before it can run.`)
  }
  const actionInput = input.buildInput && observation ? input.buildInput(observation) : {}
  if (!actionInput) {
    return failure(
      input.id,
      'missing-selection',
      `Action ${input.id} needs a current selection or visible preview detail before it can run.`
    )
  }

  const result = await context.host.invokeAction(session.id, { actionId: input.id, input: actionInput })
  if (!result.ok) return failure(input.id, 'bridge', result.message)
  const selection = extractStructuredSelection(result.result)
  const selectionResult = selection
    ? await context.host.setSelection(selection, { sessionId: session.id, path: session.path })
    : undefined
  if (selectionResult && !selectionResult.ok) {
    return failure(input.id, 'bridge', selectionResult.message)
  }
  return {
    ok: true,
    kind: 'invoke-action',
    actionId: input.id,
    result,
    ...(selectionResult ? { selectionResult } : {})
  }
}

function buildMolecularWorkbenchInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = buildMolecularSelectionRequest(observation)
  const measurement = buildMolecularMeasurementRequest(observation)
  if (!selection && !measurement) return null
  return {
    ...(selection ? { selection } : {}),
    ...(measurement ? { measurement } : {})
  }
}

function buildMolecularSelectionRequest(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'molecular' ? observation.selection : null
  const input: ActionInput = {}
  if (selection?.chains?.length) input.chains = selection.chains
  if (selection?.residues?.length) input.residues = selection.residues
  if (selection?.ligands?.length) input.ligands = selection.ligands
  if (selection?.atoms?.length) input.atoms = selection.atoms
  if (Object.keys(input).length) return input
  if (observation.molecular?.chains?.[0]) return { chains: [observation.molecular.chains[0]] }
  if (observation.molecular?.ligands?.[0]) return { ligands: [observation.molecular.ligands[0]] }
  return null
}

function buildMolecularMeasurementRequest(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'molecular' ? observation.selection : null
  const atoms = selection?.atoms
    ?.map((atom) => ({ id: atom.id, index: atom.index }))
    .filter((atom) => atom.id || atom.index !== undefined)
    .slice(0, 2)
  return atoms?.length === 2 ? { kind: 'distance', atoms } : null
}

function buildSequenceRegionInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'sequence' ? observation.selection : null
  const range = selection?.ranges[0]
  if (!selection?.sequenceId || !range) return null
  return {
    reference: selection.sequenceId,
    start: range.start,
    end: range.end,
    ...(range.strand ? { strand: range.strand } : {})
  }
}

function buildOmicsDatasetInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'omics' ? observation.selection : null
  const input: ActionInput = {}
  if (selection?.matrixIds?.length) input.matrixIds = selection.matrixIds
  if (selection?.obsKeys?.length) input.obsKeys = selection.obsKeys
  if (selection?.varKeys?.length) input.varKeys = selection.varKeys
  if (selection?.embeddings?.length) input.embeddingNames = selection.embeddings
  if (selection?.ranges?.length) input.ranges = selection.ranges
  if (Object.keys(input).length) return input
  return observation.omics?.embeddings?.[0]
    ? { embeddingNames: [observation.omics.embeddings[0]] }
    : null
}

function buildBioimagingRegionInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  const region = selection?.regions?.[0]
  return region ? { region, ...(selection?.roiIds?.[0] ? { roiId: selection.roiIds[0] } : {}) } : null
}

function buildBioimagingChannelsInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  if (selection?.channels?.length) return { channels: selection.channels }
  return observation.bioimaging?.channels?.[0] ? { channels: [observation.bioimaging.channels[0]] } : null
}

function buildBioimagingAnnotationInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
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

function buildBioimagingExportInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : null
  return selection && (selection.roiIds?.length || selection.channels?.length || selection.regions?.length)
    ? { selection: encodeLifeScienceSelection(selection) }
    : null
}

function buildSpectraRangeInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const range = firstSpectraRange(observation)
  return range ? { range } : null
}

function buildSpectraAnnotationInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const range = firstSpectraRange(observation)
  return range ? { range, label: 'Spectra annotation' } : null
}

function buildSpectraExportInput(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const range = firstSpectraRange(observation)
  return range ? { range, format: 'csv' } : null
}

function firstSpectraRange(observation: LifeScienceWorkspaceObservation): ActionInput | null {
  const selection = observation.selection?.kind === 'spectra' ? observation.selection : null
  const range = selection?.ranges[0]
  return range
    ? {
        mzMin: range.xStart,
        mzMax: range.xEnd,
        ...(range.yStart !== undefined ? { intensityMin: range.yStart } : {}),
        ...(range.yEnd !== undefined ? { intensityMax: range.yEnd } : {})
      }
    : null
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
    if (decodeLifeScienceSelection(candidate)) return candidate as WorkspaceStructuredSelection
  }
  return null
}

function failure(actionId: string, reason: string, message: string): Record<string, unknown> {
  return { ok: false, actionId, reason, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
