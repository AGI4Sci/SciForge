import {
  isDeferredNonLifeScienceExtension,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewFileState,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewHostState } from './host'
import {
  rendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'

export type WorkspacePreviewChromeActionSource = 'manifest' | 'observation' | 'manifest+observation'

export type WorkspacePreviewToolbarAction = {
  id: string
  label: string
  source: WorkspacePreviewChromeActionSource
  enabled: boolean
  reason?: string
  format?: string
}

export type WorkspacePreviewBreadcrumbItem = {
  label: string
  path: string
  current: boolean
}

export type WorkspacePreviewChromeTitle = {
  text: string
  subtitle?: string
}

export type WorkspacePreviewChromeStatus =
  | {
      kind: 'ready'
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'error'
      variant: 'deferred' | 'unsupported' | 'host'
      title: string
      message: string
    }

export type WorkspacePreviewInspectorSummaryItem = {
  id: string
  label: string
  value: string
}

export type WorkspacePreviewInspectorRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type WorkspacePreviewInspectorSection = {
  id: string
  title: string
  summary?: string
  rows: WorkspacePreviewInspectorRow[]
}

export type WorkspacePreviewInspectorModel = {
  summary: WorkspacePreviewInspectorSummaryItem[]
  sections: WorkspacePreviewInspectorSection[]
}

export type WorkspacePreviewChromeModel = {
  status: WorkspacePreviewChromeStatus
  title: WorkspacePreviewChromeTitle
  breadcrumb: WorkspacePreviewBreadcrumbItem[]
  toolbar: {
    actions: WorkspacePreviewToolbarAction[]
  }
  inspector: WorkspacePreviewInspectorModel
}

export type WorkspacePreviewChromeInput = {
  state: Readonly<WorkspacePreviewHostState>
  registry?: RendererWorkspacePreviewRegistry
  requestedPath?: string
  mimeType?: string
}

type ChromeFileSnapshot = {
  path?: string
  workspaceRoot?: string
  relativePath?: string
  mimeType?: string
  size?: number
  mtimeMs?: number
}

const KNOWN_ACTION_LABELS: Record<string, string> = {
  'workspace.preview': 'Preview',
  'workspace.edit': 'Edit',
  'workspace.inspect': 'Inspect',
  'workspace.setSelection': 'Select',
  'annotation.upsert': 'Annotate',
  'molecular.preview': 'Preview Structure',
  'molecular.select': 'Select Structure',
  'molecular.measureDistance': 'Measure Distance',
  'sequence.selectRegion': 'Select Region',
  'sequence.search': 'Search Sequence',
  'sequence.inspectFeatures': 'Inspect Features',
  'sequence.exportSummary': 'Export Summary',
  'omics.preview': 'Preview Matrix',
  'omics.inspectMetadata': 'Inspect Metadata',
  'omics.declareCapabilities': 'Show Capabilities',
  'omics.selectDataset': 'Select Dataset',
  'bioimaging.observeMetadata': 'Observe Metadata',
  'bioimaging.inspectHeader': 'Inspect Header',
  'bioimaging.describeTilePlan': 'Describe Tiles',
  'bioimaging.selectRegion': 'Select ROI',
  'bioimaging.selectChannels': 'Select Channels',
  'bioimaging.annotateRegion': 'Annotate ROI',
  'bioimaging.exportRoiSet': 'Export ROI Set',
  'spectra.preview': 'Preview Spectra',
  'spectra.inspectScans': 'Inspect Scans',
  'spectra.selectPeaksByRange': 'Select Peaks',
  'spectra.annotateRange': 'Annotate Range',
  'spectra.exportPeakList': 'Export Peaks'
}

const ACTIONS_REQUIRING_EXPLICIT_UI = new Set([
  'workspace.edit',
  'annotation.upsert',
  'tabular.updateCell',
  'tabular.insertRows',
  'tabular.insertColumns',
  'tabular.deleteRows',
  'tabular.deleteColumns'
])

export function buildWorkspacePreviewChromeModel(input: WorkspacePreviewChromeInput): WorkspacePreviewChromeModel {
  const registry = input.registry ?? rendererWorkspacePreviewRegistry
  const descriptor = resolveChromeDescriptor(input, registry)
  const status = buildChromeStatus(input, registry)
  const file = getFileSnapshot(input.state, input.requestedPath)
  const title = buildTitle(input.state, descriptor, file)

  return {
    status,
    title,
    breadcrumb: buildBreadcrumb(displayPath(file)),
    toolbar: {
      actions: buildToolbarActions({
        manifest: descriptor?.manifest,
        observation: input.state.observation,
        enabled: status.kind !== 'error' && Boolean(input.state.session)
      })
    },
    inspector: buildInspectorModel(input.state, descriptor, file)
  }
}

export function buildToolbarActions(input: {
  manifest?: WorkspacePreviewPluginManifest | null
  observation?: WorkspaceObservation | null
  enabled?: boolean
}): WorkspacePreviewToolbarAction[] {
  const actions = new Map<string, WorkspacePreviewToolbarAction>()
  const enabled = input.enabled ?? true
  const reason = enabled ? undefined : 'Open a preview session to use this action.'

  const addAction = (action: WorkspacePreviewToolbarAction): void => {
    const existing = actions.get(action.id)
    if (!existing) {
      actions.set(action.id, action)
      return
    }

    actions.set(action.id, {
      ...existing,
      source: existing.source === action.source ? existing.source : 'manifest+observation',
      enabled: existing.enabled || action.enabled,
      reason: existing.enabled || action.enabled ? undefined : existing.reason ?? action.reason,
      format: existing.format ?? action.format
    })
  }

  const capabilities = input.manifest?.capabilities
  if (capabilities?.preview) addAction(createAction('workspace.preview', 'manifest', enabled, reason))
  if (capabilities?.edit) addAction(createAction('workspace.edit', 'manifest', enabled, reason))
  if (capabilities?.inspect) addAction(createAction('workspace.inspect', 'manifest', enabled, reason))
  if (capabilities?.structuredSelection) {
    addAction(createAction('workspace.setSelection', 'manifest', enabled, reason))
  }
  if (capabilities?.annotations) addAction(createAction('annotation.upsert', 'manifest', enabled, reason))

  for (const format of capabilities?.export ?? []) {
    const sourceCopyAvailable = enabled && isSourceCopyExportFormat(format, input.observation?.file.path)
    addAction({
      id: `workspace.export:${format}`,
      label: `Export ${format.toUpperCase()}`,
      source: 'manifest',
      enabled: sourceCopyAvailable,
      reason: sourceCopyAvailable
        ? undefined
        : enabled
          ? 'Export needs a renderer target picker or plugin implementation.'
          : reason,
      format
    })
  }

  for (const actionId of input.observation?.actions ?? []) {
    addAction(createAction(actionId, 'observation', enabled, reason))
  }

  return [...actions.values()]
}

export function buildInspectorModel(
  state: Readonly<WorkspacePreviewHostState>,
  descriptor: RendererWorkspacePreviewPluginDescriptor | null | undefined = state.descriptor,
  file: ChromeFileSnapshot = getFileSnapshot(state)
): WorkspacePreviewInspectorModel {
  const observation = state.observation
  const session = state.session
  const sections: WorkspacePreviewInspectorSection[] = []
  const summary: WorkspacePreviewInspectorSummaryItem[] = []
  const pluginName = descriptor?.manifest.displayName ?? observation?.view.pluginId ?? session?.pluginId
  const modality = observation?.view.modality ?? session?.modality ?? descriptor?.manifest.modality
  const mode = observation?.view.mode ?? session?.mode

  if (pluginName) summary.push({ id: 'plugin', label: 'Plugin', value: pluginName })
  if (modality) summary.push({ id: 'modality', label: 'Modality', value: formatModality(modality) })
  if (mode) summary.push({ id: 'mode', label: 'Mode', value: titleCase(mode) })

  const fileSection = buildFileSection(file, pluginName, modality, mode)
  if (fileSection) sections.push(fileSection)
  if (state.asset) sections.push(buildAssetTransportSection(state.asset))

  const selection = observation?.selection ?? session?.selection
  if (selection) sections.push(buildSelectionSection(selection))

  if (observation?.tables?.length) sections.push(buildTablesSection(observation.tables))
  if (observation?.slides?.length) sections.push(buildSlidesSection(observation.slides))
  if (observation?.molecular) sections.push(buildMolecularSection(observation.molecular))
  if (observation?.sequence) sections.push(buildSequenceSection(observation.sequence))
  if (observation?.omics) sections.push(buildOmicsSection(observation.omics))
  if (observation?.bioimaging) sections.push(buildBioimagingSection(observation.bioimaging))
  if (observation?.spectra) sections.push(buildSpectraSection(observation.spectra))
  if (observation?.annotations?.length) sections.push(buildAnnotationsSection(observation.annotations))

  return {
    summary,
    sections
  }
}

function resolveChromeDescriptor(
  input: WorkspacePreviewChromeInput,
  registry: RendererWorkspacePreviewRegistry
): RendererWorkspacePreviewPluginDescriptor | null {
  const state = input.state
  const pluginId = state.observation?.view.pluginId ?? state.session?.pluginId
  if (state.descriptor) return state.descriptor
  if (pluginId) return registry.get(pluginId)
  if (!input.requestedPath) return null
  return registry.resolve({
    path: input.requestedPath,
    mimeType: input.mimeType,
    includeFallback: false
  })
}

function buildChromeStatus(
  input: WorkspacePreviewChromeInput,
  registry: RendererWorkspacePreviewRegistry
): WorkspacePreviewChromeStatus {
  const state = input.state
  if (state.error) {
    return {
      kind: 'error',
      variant: 'host',
      title: 'Workspace preview error',
      message: state.error
    }
  }

  if (state.session || state.file || state.observation || state.descriptor) return { kind: 'ready' }

  if (input.requestedPath) {
    const descriptor = registry.resolve({
      path: input.requestedPath,
      mimeType: input.mimeType,
      includeFallback: false
    })
    if (!descriptor) {
      const deferred = isDeferredNonLifeScienceExtension(input.requestedPath)
      return {
        kind: 'error',
        variant: deferred ? 'deferred' : 'unsupported',
        title: deferred ? 'Preview deferred' : 'Unsupported preview',
        message: deferred
          ? `No renderer preview is active for ${input.requestedPath}; this scientific format is deferred to a future plugin.`
          : `No renderer preview plugin is registered for ${input.requestedPath}.`
      }
    }

    return {
      kind: 'empty',
      title: 'Preview not opened',
      message: `Open ${input.requestedPath} to start a workspace preview session.`
    }
  }

  return {
    kind: 'empty',
    title: 'No preview selected',
    message: 'Select a workspace file to preview it here.'
  }
}

function getFileSnapshot(
  state: Readonly<WorkspacePreviewHostState>,
  requestedPath?: string
): ChromeFileSnapshot {
  const observationFile = state.observation?.file
  const fileState: WorkspacePreviewFileState | null = state.file
  const session: WorkspacePreviewSession | null = state.session

  return {
    path: observationFile?.path ?? fileState?.path ?? session?.path ?? requestedPath,
    workspaceRoot: observationFile?.workspaceRoot ?? fileState?.workspaceRoot ?? session?.workspaceRoot,
    relativePath: fileState?.relativePath,
    mimeType: observationFile?.mimeType ?? fileState?.mimeType,
    size: observationFile?.size ?? fileState?.size,
    mtimeMs: observationFile?.mtimeMs ?? fileState?.mtimeMs ?? session?.mtimeMs
  }
}

function buildTitle(
  state: Readonly<WorkspacePreviewHostState>,
  descriptor: RendererWorkspacePreviewPluginDescriptor | null,
  file: ChromeFileSnapshot
): WorkspacePreviewChromeTitle {
  const title = state.observation?.view.title?.trim() || basename(displayPath(file)) || 'Workspace preview'
  const pluginName = descriptor?.manifest.displayName
  const modality = state.observation?.view.modality ?? state.session?.modality ?? descriptor?.manifest.modality
  const mode = state.observation?.view.mode ?? state.session?.mode
  const subtitleParts = [pluginName, modality ? formatModality(modality) : undefined, mode ? titleCase(mode) : undefined]
    .filter((part): part is string => Boolean(part && part !== title))

  return {
    text: title,
    subtitle: subtitleParts.length ? subtitleParts.join(' / ') : undefined
  }
}

function buildBreadcrumb(path: string): WorkspacePreviewBreadcrumbItem[] {
  const segments = normalizePath(path).split('/').filter(Boolean)
  let currentPath = ''

  return segments.map((segment, index) => {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    return {
      label: segment,
      path: currentPath,
      current: index === segments.length - 1
    }
  })
}

function buildFileSection(
  file: ChromeFileSnapshot,
  pluginName?: string,
  modality?: WorkspacePreviewModality,
  mode?: WorkspacePreviewSession['mode']
): WorkspacePreviewInspectorSection | null {
  const rows = compactRows([
    file.path ? row('path', 'Path', displayPath(file)) : null,
    pluginName ? row('plugin', 'Plugin', pluginName) : null,
    modality ? row('modality', 'Modality', formatModality(modality)) : null,
    mode ? row('mode', 'Mode', titleCase(mode)) : null,
    file.mimeType ? row('mime', 'MIME type', file.mimeType) : null,
    typeof file.size === 'number' ? row('size', 'Size', formatBytes(file.size)) : null,
    typeof file.mtimeMs === 'number' ? row('modified', 'Modified', formatTimestamp(file.mtimeMs)) : null
  ])

  if (!rows.length) return null
  return {
    id: 'file',
    title: 'File',
    rows
  }
}

function buildAssetTransportSection(
  asset: WorkspacePreviewAssetTransportDescriptor
): WorkspacePreviewInspectorSection {
  const strategyRows = asset.strategies.map((strategy) =>
    row(
      `strategy-${strategy.kind}`,
      titleCase(strategy.kind),
      titleCase(strategy.status),
      compactStrings([
        strategy.reason,
        strategy.maxChunkBytes ? `max ${formatBytes(strategy.maxChunkBytes)}` : undefined
      ]).join(' | ') || undefined
    )
  )

  return {
    id: 'asset-transport',
    title: 'Asset Transport',
    summary: compactStrings([
      `primary ${asset.primary}`,
      asset.eagerRead.allowed ? 'eager read allowed' : 'eager read disabled',
      asset.range.available ? 'byte range available' : 'byte range unavailable'
    ]).join(', '),
    rows: [
      row('primary', 'Primary', titleCase(asset.primary)),
      row(
        'eager-read',
        'Eager read',
        asset.eagerRead.allowed ? 'Allowed' : 'Disabled',
        asset.eagerRead.reason
      ),
      row(
        'range',
        'Byte range',
        asset.range.available ? 'Available' : 'Unavailable',
        `size ${formatBytes(asset.range.size)} | chunk ${formatBytes(asset.range.recommendedChunkBytes)} / max ${formatBytes(asset.range.maxChunkBytes)}`
      ),
      ...strategyRows
    ]
  }
}

function buildSelectionSection(selection: WorkspaceStructuredSelection): WorkspacePreviewInspectorSection {
  const rows: Array<WorkspacePreviewInspectorRow | null> = [
    row('kind', 'Kind', formatModality(selection.kind as WorkspacePreviewModality))
  ]

  switch (selection.kind) {
    case 'text':
      rows.push(row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')))
      break
    case 'tabular':
      rows.push(
        selection.sheet ? row('sheet', 'Sheet', selection.sheet) : null,
        row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
        selection.cells?.length ? row('cells', 'Cells', formatCount(selection.cells.length, 'cell')) : null
      )
      break
    case 'document':
      rows.push(row('anchors', 'Anchors', formatCount(selection.anchors.length, 'anchor')))
      break
    case 'deck':
      rows.push(
        row('slides', 'Slides', formatCount(selection.slideIds.length, 'slide')),
        selection.elementIds?.length ? row('elements', 'Elements', formatCount(selection.elementIds.length, 'element')) : null
      )
      break
    case 'molecular':
      rows.push(
        selection.chains?.length ? row('chains', 'Chains', joinList(selection.chains)) : null,
        selection.residues?.length ? row('residues', 'Residues', formatCount(selection.residues.length, 'residue')) : null,
        selection.atoms?.length ? row('atoms', 'Atoms', formatCount(selection.atoms.length, 'atom')) : null,
        selection.ligands?.length ? row('ligands', 'Ligands', joinList(selection.ligands)) : null
      )
      break
    case 'sequence':
      rows.push(
        selection.sequenceId ? row('sequence', 'Sequence', selection.sequenceId) : null,
        row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
        selection.features?.length ? row('features', 'Features', formatCount(selection.features.length, 'feature')) : null
      )
      break
    case 'omics':
      rows.push(
        selection.matrixIds?.length ? row('matrices', 'Matrices', joinList(selection.matrixIds)) : null,
        selection.obsKeys?.length ? row('obs-keys', 'Observation keys', joinList(selection.obsKeys)) : null,
        selection.varKeys?.length ? row('var-keys', 'Variable keys', joinList(selection.varKeys)) : null,
        selection.embeddings?.length ? row('embeddings', 'Embeddings', joinList(selection.embeddings)) : null,
        selection.ranges?.length ? row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')) : null
      )
      break
    case 'bioimaging':
      rows.push(
        selection.roiIds?.length ? row('rois', 'ROIs', formatCount(selection.roiIds.length, 'ROI', 'ROIs')) : null,
        selection.channels?.length ? row('channels', 'Channels', joinList(selection.channels)) : null,
        selection.regions?.length ? row('regions', 'Regions', formatCount(selection.regions.length, 'region')) : null
      )
      break
    case 'spectra':
      rows.push(
        row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
        selection.peaks?.length ? row('peaks', 'Peaks', formatCount(selection.peaks.length, 'peak')) : null
      )
      break
  }

  return {
    id: 'selection',
    title: 'Selection',
    summary: describeSelection(selection),
    rows: compactRows(rows)
  }
}

function buildTablesSection(
  tables: NonNullable<WorkspaceObservation['tables']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'tables',
    title: 'Tables',
    summary: formatCount(tables.length, 'table'),
    rows: tables.map((table, index) =>
      row(
        table.id || `table-${index}`,
        table.name || table.id || `Table ${index + 1}`,
        formatTableShape(table.rowCount, table.columnCount)
      )
    )
  }
}

function buildSlidesSection(
  slides: NonNullable<WorkspaceObservation['slides']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'slides',
    title: 'Slides',
    summary: formatCount(slides.length, 'slide'),
    rows: slides.map((slide) => ({
      id: slide.id,
      label: `Slide ${slide.index + 1}`,
      value: slide.title || slide.id,
      description: slide.notes
    }))
  }
}

function buildMolecularSection(
  molecular: NonNullable<WorkspaceObservation['molecular']>
): WorkspacePreviewInspectorSection {
  const summaryParts = compactStrings([
    typeof molecular.modelCount === 'number' ? formatCount(molecular.modelCount, 'model') : undefined,
    molecular.chains?.length ? formatCount(molecular.chains.length, 'chain') : undefined,
    molecular.ligands?.length ? formatCount(molecular.ligands.length, 'ligand') : undefined
  ])

  return {
    id: 'molecular',
    title: 'Molecular',
    summary: summaryParts.length ? summaryParts.join(', ') : 'Molecular details',
    rows: compactRows([
      typeof molecular.modelCount === 'number' ? row('models', 'Models', String(molecular.modelCount)) : null,
      molecular.chains?.length ? row('chains', 'Chains', joinList(molecular.chains)) : null,
      molecular.ligands?.length ? row('ligands', 'Ligands', joinList(molecular.ligands)) : null,
      molecular.representations?.length
        ? row('representations', 'Representations', joinList(molecular.representations))
        : null
    ])
  }
}

function buildSequenceSection(
  sequence: NonNullable<WorkspaceObservation['sequence']>
): WorkspacePreviewInspectorSection {
  const summaryParts = compactStrings([
    typeof sequence.sequenceCount === 'number' ? formatCount(sequence.sequenceCount, 'sequence') : undefined,
    typeof sequence.totalLength === 'number' ? `${sequence.totalLength} bp/aa` : undefined,
    sequence.alphabet ? formatSequenceAlphabet(sequence.alphabet) : undefined
  ])

  return {
    id: 'sequence',
    title: 'Sequence',
    summary: summaryParts.length ? summaryParts.join(', ') : 'Sequence details',
    rows: compactRows([
      typeof sequence.sequenceCount === 'number' ? row('sequences', 'Sequences', String(sequence.sequenceCount)) : null,
      typeof sequence.totalLength === 'number' ? row('total-length', 'Total length', String(sequence.totalLength)) : null,
      sequence.alphabet ? row('alphabet', 'Alphabet', formatSequenceAlphabet(sequence.alphabet)) : null
    ])
  }
}

function buildOmicsSection(
  omics: NonNullable<WorkspaceObservation['omics']>
): WorkspacePreviewInspectorSection {
  const summaryParts = compactStrings([
    omics.format ? omics.format : undefined,
    omics.matrixShape ? `${omics.matrixShape[0]} x ${omics.matrixShape[1]}` : undefined,
    omics.matrixIds?.length ? formatCount(omics.matrixIds.length, 'matrix', 'matrices') : undefined,
    typeof omics.observationCount === 'number' ? formatCount(omics.observationCount, 'observation') : undefined,
    typeof omics.variableCount === 'number' ? formatCount(omics.variableCount, 'variable') : undefined
  ])

  return {
    id: 'omics',
    title: 'Omics',
    summary: summaryParts.length ? summaryParts.join(', ') : 'Omics matrix details',
    rows: compactRows([
      omics.format ? row('format', 'Format', omics.format) : null,
      omics.matrixShape ? row('shape', 'Shape', `${omics.matrixShape[0]} x ${omics.matrixShape[1]}`) : null,
      omics.matrixIds?.length ? row('matrices', 'Matrices', joinList(omics.matrixIds)) : null,
      typeof omics.observationCount === 'number' ? row('observations', 'Observations', String(omics.observationCount)) : null,
      typeof omics.variableCount === 'number' ? row('variables', 'Variables', String(omics.variableCount)) : null,
      omics.obsKeys?.length ? row('obs-keys', 'Observation keys', joinList(omics.obsKeys)) : null,
      omics.varKeys?.length ? row('var-keys', 'Variable keys', joinList(omics.varKeys)) : null,
      omics.embeddings?.length ? row('embeddings', 'Embeddings', joinList(omics.embeddings)) : null,
      omics.metadataKeys?.length ? row('metadata-keys', 'Metadata keys', joinList(omics.metadataKeys)) : null
    ])
  }
}

function buildBioimagingSection(
  bioimaging: NonNullable<WorkspaceObservation['bioimaging']>
): WorkspacePreviewInspectorSection {
  const dimensions = bioimaging.dimensions
  const shape = dimensions
    ? compactStrings([
        `${dimensions.width} x ${dimensions.height}`,
        dimensions.z ? `Z ${dimensions.z}` : undefined,
        dimensions.t ? `T ${dimensions.t}` : undefined
      ]).join(', ')
    : undefined
  const summaryParts = compactStrings([
    bioimaging.format ? bioimaging.format : undefined,
    shape,
    bioimaging.channels?.length ? formatCount(bioimaging.channels.length, 'channel') : undefined,
    bioimaging.tilePlan?.levelCount !== undefined ? formatCount(bioimaging.tilePlan.levelCount, 'tile level') : undefined
  ])

  return {
    id: 'bioimaging',
    title: 'Bioimaging',
    summary: summaryParts.length ? summaryParts.join(', ') : 'Bioimaging details',
    rows: compactRows([
      bioimaging.format ? row('format', 'Format', bioimaging.format) : null,
      bioimaging.detectedBy ? row('detected-by', 'Detected by', bioimaging.detectedBy) : null,
      typeof bioimaging.byteLength === 'number' ? row('byte-length', 'Bytes', formatBytes(bioimaging.byteLength)) : null,
      shape ? row('dimensions', 'Dimensions', shape) : null,
      bioimaging.channels?.length ? row('channels', 'Channels', joinList(bioimaging.channels)) : null,
      bioimaging.tilePlan ? row('tile-plan', 'Tile plan', formatBioimagingTilePlan(bioimaging.tilePlan)) : null
    ])
  }
}

function buildSpectraSection(
  spectra: NonNullable<WorkspaceObservation['spectra']>
): WorkspacePreviewInspectorSection {
  const summaryParts = compactStrings([
    spectra.format ? spectra.format : undefined,
    typeof spectra.spectrumCount === 'number' ? formatCount(spectra.spectrumCount, 'spectrum', 'spectra') : undefined,
    typeof spectra.peakCount === 'number' ? formatCount(spectra.peakCount, 'peak') : undefined,
    typeof spectra.scanCount === 'number' && spectra.scanCount > 0 ? formatCount(spectra.scanCount, 'scan') : undefined,
    spectra.xAxis ? `x: ${spectra.xAxis}` : undefined
  ])

  return {
    id: 'spectra',
    title: 'Spectra',
    summary: summaryParts.length ? summaryParts.join(', ') : 'Spectra details',
    rows: compactRows([
      spectra.format ? row('format', 'Format', spectra.format) : null,
      typeof spectra.spectrumCount === 'number' ? row('spectra', 'Spectra', String(spectra.spectrumCount)) : null,
      typeof spectra.peakCount === 'number' ? row('peaks', 'Peaks', String(spectra.peakCount)) : null,
      typeof spectra.scanCount === 'number' ? row('scans', 'Scans', String(spectra.scanCount)) : null,
      spectra.xAxis ? row('x-axis', 'X axis', spectra.xAxis) : null,
      spectra.mzRange ? row('mz-range', 'm/z range', formatNumericRange(spectra.mzRange)) : null,
      spectra.intensityRange ? row('intensity-range', 'Intensity range', formatNumericRange(spectra.intensityRange)) : null,
      spectra.sampledPeaks?.length ? row('sampled-peaks', 'Sampled peaks', formatCount(spectra.sampledPeaks.length, 'peak')) : null,
      spectra.scanMarkers?.length ? row('scan-markers', 'Scan markers', formatCount(spectra.scanMarkers.length, 'marker')) : null
    ])
  }
}

function buildAnnotationsSection(
  annotations: NonNullable<WorkspaceObservation['annotations']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'annotations',
    title: 'Annotations',
    summary: formatCount(annotations.length, 'annotation'),
    rows: annotations.map((annotation) =>
      row(annotation.id, titleCase(annotation.kind), annotation.summary || annotation.id)
    )
  }
}

function createAction(
  id: string,
  source: WorkspacePreviewChromeActionSource,
  enabled: boolean,
  reason?: string
): WorkspacePreviewToolbarAction {
  const requiresExplicitUi = ACTIONS_REQUIRING_EXPLICIT_UI.has(id)
  return {
    id,
    label: KNOWN_ACTION_LABELS[id] ?? labelFromActionId(id),
    source,
    enabled: enabled && !requiresExplicitUi,
    reason: requiresExplicitUi
      ? 'This action needs a dedicated editor control before it can run.'
      : reason
  }
}

function isSourceCopyExportFormat(format: string, path: string | undefined): boolean {
  if (!path) return false
  const normalizedFormat = format.replace(/^\./u, '').trim().toLowerCase()
  if (!normalizedFormat) return false
  if (normalizedFormat === 'sidecar') return /\.(?:pdf|docx)$/iu.test(path.trim())
  return path.trim().toLowerCase().endsWith(`.${normalizedFormat}`)
}

function describeSelection(selection: WorkspaceStructuredSelection): string {
  switch (selection.kind) {
    case 'text':
      return `Text ${formatCount(selection.ranges.length, 'range')}`
    case 'tabular':
      return compactStrings([
        'Tabular',
        formatCount(selection.ranges.length, 'range'),
        selection.cells?.length ? formatCount(selection.cells.length, 'cell') : undefined
      ]).join(', ')
    case 'document':
      return `Document ${formatCount(selection.anchors.length, 'anchor')}`
    case 'deck':
      return compactStrings([
        'Deck',
        formatCount(selection.slideIds.length, 'slide'),
        selection.elementIds?.length ? formatCount(selection.elementIds.length, 'element') : undefined
      ]).join(', ')
    case 'molecular':
      return compactStrings([
        'Molecular',
        selection.chains?.length ? formatCount(selection.chains.length, 'chain') : undefined,
        selection.residues?.length ? formatCount(selection.residues.length, 'residue') : undefined,
        selection.atoms?.length ? formatCount(selection.atoms.length, 'atom') : undefined,
        selection.ligands?.length ? formatCount(selection.ligands.length, 'ligand') : undefined
      ]).join(', ')
    case 'sequence':
      return `Sequence ${formatCount(selection.ranges.length, 'range')}`
    case 'omics':
      return compactStrings([
        'Omics',
        selection.matrixIds?.length ? formatCount(selection.matrixIds.length, 'matrix', 'matrices') : undefined,
        selection.obsKeys?.length ? formatCount(selection.obsKeys.length, 'obs key') : undefined,
        selection.varKeys?.length ? formatCount(selection.varKeys.length, 'var key') : undefined,
        selection.embeddings?.length ? formatCount(selection.embeddings.length, 'embedding') : undefined,
        selection.ranges?.length ? formatCount(selection.ranges.length, 'range') : undefined
      ]).join(', ')
    case 'bioimaging':
      return compactStrings([
        'Bioimaging',
        selection.roiIds?.length ? formatCount(selection.roiIds.length, 'ROI', 'ROIs') : undefined,
        selection.regions?.length ? formatCount(selection.regions.length, 'region') : undefined
      ]).join(', ')
    case 'spectra':
      return compactStrings([
        'Spectra',
        formatCount(selection.ranges.length, 'range'),
        selection.peaks?.length ? formatCount(selection.peaks.length, 'peak') : undefined
      ]).join(', ')
  }
}

function displayPath(file: ChromeFileSnapshot): string {
  if (file.relativePath?.trim()) return normalizePath(file.relativePath)
  if (!file.path) return ''
  const path = normalizePath(file.path)
  const workspaceRoot = file.workspaceRoot ? normalizePath(file.workspaceRoot).replace(/\/+$/, '') : ''
  if (workspaceRoot && path === workspaceRoot) return basename(path)
  if (workspaceRoot && path.startsWith(`${workspaceRoot}/`)) return path.slice(workspaceRoot.length + 1)
  return path
}

function formatTableShape(rowCount?: number, columnCount?: number): string {
  const rows = typeof rowCount === 'number' ? formatCount(rowCount, 'row') : 'Unknown rows'
  const columns = typeof columnCount === 'number' ? formatCount(columnCount, 'column') : 'unknown columns'
  return `${rows} x ${columns}`
}

function row(id: string, label: string, value: string, description?: string): WorkspacePreviewInspectorRow {
  return { id, label, value, description }
}

function compactRows(
  rows: Array<WorkspacePreviewInspectorRow | null | undefined>
): WorkspacePreviewInspectorRow[] {
  return rows.filter((item): item is WorkspacePreviewInspectorRow => Boolean(item))
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function joinList(values: readonly string[], limit = 6): string {
  const shown = values.slice(0, limit)
  const suffix = values.length > limit ? `, +${values.length - limit} more` : ''
  return `${shown.join(', ')}${suffix}`
}

function formatNumericRange(range: { min: number; max: number }): string {
  return `${formatDecimal(range.min)} - ${formatDecimal(range.max)}`
}

function formatBioimagingTilePlan(
  tilePlan: NonNullable<NonNullable<WorkspaceObservation['bioimaging']>['tilePlan']>
): string {
  const parts = compactStrings([
    tilePlan.status,
    tilePlan.source,
    tilePlan.levelCount !== undefined ? formatCount(tilePlan.levelCount, 'level') : undefined,
    tilePlan.tileSize ? `${tilePlan.tileSize.width} x ${tilePlan.tileSize.height}` : undefined,
    tilePlan.pixelDecoding === false ? 'no pixel decoding' : undefined,
    tilePlan.tileRendererImplemented === false ? 'renderer pending' : undefined
  ])
  return parts.length ? parts.join(', ') : 'Tile plan'
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  for (const unit of units) {
    if (value < 1024) return `${formatDecimal(value)} ${unit}`
    value /= 1024
  }
  return `${formatDecimal(value)} PB`
}

function formatDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, '')
}

function formatTimestamp(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  if (Number.isNaN(date.getTime())) return String(mtimeMs)
  return date.toISOString()
}

function formatModality(modality: WorkspacePreviewModality): string {
  return titleCase(modality.replace(/-/g, ' '))
}

function formatSequenceAlphabet(alphabet: NonNullable<NonNullable<WorkspaceObservation['sequence']>['alphabet']>): string {
  if (alphabet === 'dna' || alphabet === 'rna') return alphabet.toUpperCase()
  return titleCase(alphabet)
}

function labelFromActionId(id: string): string {
  const normalized = id
    .replace(/^workspace\./, '')
    .replace(/[:.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
  return titleCase(normalized)
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function basename(path: string): string {
  const segments = normalizePath(path).split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}
