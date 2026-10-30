/**
 * Port of packages/domains/life-science-preview/src/backend/providers.ts
 * (createLifeScienceWorkspacePreviewProvider, all six slots) into the 24-1
 * phase-1 core/ports/adapter shape:
 *
 * - node:fs direct reads/writes are replaced by the file read/write ports
 *   defined in ../ports/file-ports.ts (bounded text/binary reads with
 *   stat-first oversize rejection, safe write targets).
 * - The five workspace-* data-service calls go through the data ports typed
 *   in ../ports/data-ports.ts. The core never imports the service packages.
 * - Slot behavior is carried over verbatim from the trusted domain backend,
 *   including the molecular applyEdit session-update path, the passive
 *   biology-index-transport observe, and the bioimaging-only
 *   prepareArtifact (tile/thumbnail). The rehearsal-only cache-artifact
 *   generalisation from the core spike was dropped: it is not production
 *   behavior, and the SDK artifact-result union still has no byte-bearing
 *   success variant for it (spike README §3.1, documented in this plugin's
 *   README as a pending SDK decision).
 *
 * The core deliberately imports only:
 * - @sciforge/domain-sdk/workspace-preview (public SDK contract — the same
 *   contract a runtime plugin speaks on the host channel), zod (via wire),
 *   node:path, ../ports/*, and ./wire.js.
 * - No src/main, src/shared, @shared, @renderer, no node:fs inside core/.
 */
import { basename } from 'node:path'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  extensionFromPreviewPath,
  fileNameFromPreviewPath,
  workspaceObservationSchema,
  workspacePreviewSessionSchema,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewPluginActionInput,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewProviderActionInput,
  type WorkspacePreviewProviderActionResult,
  type WorkspacePreviewProviderApplyEditInput,
  type WorkspacePreviewProviderApplyEditResult,
  type WorkspacePreviewProviderArtifactInput,
  type WorkspacePreviewProviderArtifactResult,
  type WorkspacePreviewProviderExportInput,
  type WorkspacePreviewProviderExportResult,
  type WorkspacePreviewProviderObservationInput,
  type WorkspacePreviewProviderObservationResult
} from '@sciforge/domain-sdk/workspace-preview'
import {
  LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES,
  LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES,
  LifeSciencePortError,
  type LifeSciencePorts
} from '../ports/index.js'
import {
  decodeLifeScienceSelection,
  decodeLifeScienceSelectionsInValue,
  encodeLifeScienceObservationMetadata,
  encodeLifeScienceSelection,
  encodeLifeScienceSelectionsInValue,
  lifeScienceKindForPluginId,
  lifeScienceStructuredSelectionSchema,
  type LifeScienceBioimagingObservation,
  type LifeScienceMolecularObservation,
  type LifeScienceOmicsObservation,
  type LifeScienceSequenceObservation,
  type LifeScienceSpectraObservation,
  type LifeScienceStructuredSelection
} from './wire.js'

export const LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE =
  'sciforge.life-science-preview.molecular.set-selection'

type ObservationBuildInput = WorkspacePreviewProviderObservationInput & {
  visibleText?: string
  selection?: LifeScienceStructuredSelection
  molecular?: LifeScienceMolecularObservation
  sequence?: LifeScienceSequenceObservation
  omics?: LifeScienceOmicsObservation
  bioimaging?: LifeScienceBioimagingObservation
  spectra?: LifeScienceSpectraObservation
  annotations?: WorkspaceObservation['annotations']
  actions?: string[]
}

type WorkerObservationLike = Readonly<{
  visibleText?: string
  selection?: unknown
  annotations?: WorkspaceObservation['annotations']
  actions?: string[]
}> | undefined

export type ReadSideFailure = Extract<WorkspacePreviewProviderObservationResult, { ok: false }>

/**
 * The plugin-side provider surface: the five callbacks the trusted domain
 * backend implements today (the SDK WorkspacePreviewProvider members the
 * plugin actually populates).
 */
export type LifeScienceWorkspacePreviewProvider = Readonly<{
  pluginId: string
  observe?: (
    input: WorkspacePreviewProviderObservationInput
  ) => Promise<WorkspacePreviewProviderObservationResult>
  invokeAction?: (
    input: WorkspacePreviewProviderActionInput
  ) => Promise<WorkspacePreviewProviderActionResult>
  prepareArtifact?: (
    input: WorkspacePreviewProviderArtifactInput
  ) => Promise<WorkspacePreviewProviderArtifactResult>
  applyEdit?: (
    input: WorkspacePreviewProviderApplyEditInput
  ) => Promise<WorkspacePreviewProviderApplyEditResult | null>
  exportPreview?: (
    input: WorkspacePreviewProviderExportInput
  ) => Promise<WorkspacePreviewProviderExportResult>
}>

export function createLifeScienceWorkspacePreviewProvider(
  manifest: WorkspacePreviewPluginManifest,
  ports: LifeSciencePorts
): LifeScienceWorkspacePreviewProvider {
  const exportPreview = (input: WorkspacePreviewProviderExportInput) => exportSourceCopy(input, ports)
  switch (manifest.id) {
    case 'molecular':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeMolecular(input, ports),
        invokeAction: (input) => invokeMolecularAction(input, ports),
        applyEdit: (input) => applyMolecularSelection(input),
        exportPreview
      })
    case 'sequence-genomics':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeSequence(input, ports),
        invokeAction: (input) => invokeSequenceAction(input, ports),
        exportPreview
      })
    case 'biology-index-transport':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeBiologyIndex(input)
      })
    case 'omics-matrix':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeOmics(input, ports),
        invokeAction: (input) => invokeOmicsAction(input, ports),
        exportPreview
      })
    case 'bioimaging':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeBioimaging(input, ports),
        invokeAction: (input) => invokeBioimagingAction(input, ports),
        prepareArtifact: (input) => prepareBioimagingArtifact(input, ports),
        exportPreview
      })
    case 'proteomics-spectra':
      return Object.freeze({
        pluginId: manifest.id,
        observe: (input) => observeSpectra(input, ports),
        invokeAction: (input) => invokeSpectraAction(input, ports),
        exportPreview
      })
    default:
      throw new Error(`Unsupported Life Science Preview provider manifest: ${manifest.id}.`)
  }
}

async function observeMolecular(
  input: WorkspacePreviewProviderObservationInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderObservationResult> {
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz', '.xtc', '.dcd', '.trr', '.mrc', '.ccp4'].includes(extension)) {
    return unsupportedFormat(`Molecular worker text observation is not implemented for ${extension || 'this format'}.`)
  }
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const result = ports.data.molecular.preview(workerTextInput(input, text.text, formatWithoutDot(extension)))
  const workerObservation = result.observation
  return observationOk(input, text, {
    visibleText: workerObservation?.visibleText,
    selection: lifeScienceSelectionFromWorker(workerObservation?.selection),
    molecular: {
      modelCount: result.modelCount,
      chains: result.chainIds,
      ligands: result.ligands,
      representations: workerObservation?.molecular?.representations
    },
    annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
    actions: workerObservation?.actions
  })
}

async function observeSequence(
  input: WorkspacePreviewProviderObservationInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const result = ports.data.sequence.preview(workerTextInput(input, text.text, 'auto'))
  const workerObservation = result.observation
  return observationOk(input, text, {
    visibleText: workerObservation?.visibleText,
    selection: lifeScienceSelectionFromWorker(workerObservation?.selection),
    sequence: {
      sequenceCount: result.sequenceCount,
      totalLength: result.totalLength,
      alphabet: result.alphabet,
      references: result.references.map(({ indexedRange: _indexedRange, ...reference }) => reference),
      features: result.features.map(({ indexedRange: _indexedRange, ...feature }) => feature),
      indexedRanges: result.indexedRanges,
      truncatedRecords: result.truncatedRecords,
      truncatedReferences: result.truncatedReferences
    },
    annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
    actions: workerObservation?.actions
  })
}

async function observeBiologyIndex(
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  return {
    ok: true,
    bytesRead: 0,
    truncated: false,
    observation: buildObservation({ ...input, actions: ['observe'] })
  }
}

async function observeOmics(
  input: WorkspacePreviewProviderObservationInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const result = ports.data.omics.preview(workerTextInput(input, text.text, 'auto'))
  const matrix = result.matrices[0]
  const matrixShape = matrix?.rowCount !== undefined && matrix.columnCount !== undefined
    ? [matrix.rowCount, matrix.columnCount] as [number, number]
    : undefined
  const workerObservation = result.observation as WorkerObservationLike
  return observationOk(input, text, {
    visibleText: workerObservation?.visibleText,
    selection: lifeScienceSelectionFromWorker(workerObservation?.selection),
    omics: {
      format: result.format,
      ...(result.matrices.length ? { matrixIds: result.matrices.map((candidate) => candidate.id) } : {}),
      ...(matrixShape ? { matrixShape } : {}),
      ...(matrix?.rowCount !== undefined ? { observationCount: matrix.rowCount } : {}),
      ...(matrix?.columnCount !== undefined ? { variableCount: matrix.columnCount } : {}),
      ...(result.dataset?.obsKeys?.length ? { obsKeys: result.dataset.obsKeys } : {}),
      ...(result.dataset?.varKeys?.length ? { varKeys: result.dataset.varKeys } : {}),
      ...(result.dataset?.embeddingNames?.length ? { embeddings: result.dataset.embeddingNames } : {}),
      ...(result.metadata.entries.length ? { metadataKeys: result.metadata.entries.map((entry) => entry.key) } : {})
    },
    annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
    actions: workerObservation?.actions
  })
}

async function observeBioimaging(
  input: WorkspacePreviewProviderObservationInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderObservationResult> {
  const bytes = await readBoundedBinaryPrefix(input.file, ports)
  if (!bytes.ok) return bytes
  const result = ports.data.bioimaging.preview(workerBinaryInput(input, bytes.bytes))
  const workerObservation = result.observation
  const bioimaging: LifeScienceBioimagingObservation = {
    ...(result.format ? { format: result.format } : {}),
    ...(result.detectedBy ? { detectedBy: result.detectedBy } : {}),
    ...(result.byteLength !== undefined ? { byteLength: result.byteLength } : {}),
    ...(result.channels?.length ? { channels: result.channels } : {}),
    ...(result.dimensions?.width && result.dimensions.height
      ? {
          dimensions: {
            width: result.dimensions.width,
            height: result.dimensions.height,
            ...(result.dimensions.z ? { z: result.dimensions.z } : {}),
            ...(result.dimensions.t ? { t: result.dimensions.t } : {})
          }
        }
      : {}),
    ...(result.tilePlan
      ? {
          tilePlan: {
            ...(result.tilePlan.status ? { status: result.tilePlan.status } : {}),
            ...(result.tilePlan.source ? { source: result.tilePlan.source } : {}),
            levelCount: result.tilePlan.levels.length,
            tileSize: result.tilePlan.recommendedTileSize,
            pixelDecoding: result.tilePlan.pixelDecoding,
            tileRendererImplemented: result.tilePlan.tileRendererImplemented
          }
        }
      : {})
  }
  return observationOk(input, bytes, {
    visibleText: workerObservation?.visibleText,
    selection: lifeScienceSelectionFromWorker(workerObservation?.selection),
    bioimaging,
    annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
    actions: workerObservation?.actions
  })
}

async function observeSpectra(
  input: WorkspacePreviewProviderObservationInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const result = ports.data.spectra.preview(workerTextInput(input, text.text, 'auto'))
  const workerObservation = result.observation as WorkerObservationLike
  return observationOk(input, text, {
    visibleText: workerObservation?.visibleText,
    selection: lifeScienceSelectionFromWorker(workerObservation?.selection),
    spectra: {
      format: result.format,
      spectrumCount: result.spectrumCount,
      peakCount: result.peakCount,
      scanCount: result.scanCount,
      xAxis: result.format === 'fcs' ? 'event' : 'm/z',
      ...(result.mzRange ? { mzRange: result.mzRange } : {}),
      ...(result.intensityRange ? { intensityRange: result.intensityRange } : {}),
      ...(result.sampledPeaks.length
        ? { sampledPeaks: result.sampledPeaks }
        : {}),
      ...(result.scanMarkers.length
        ? { scanMarkers: result.scanMarkers }
        : {})
    },
    annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
    actions: workerObservation?.actions
  })
}

async function invokeMolecularAction(
  input: WorkspacePreviewProviderActionInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderActionResult> {
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz'].includes(extension)) {
    return unsupportedFormat(`Molecular worker actions are not implemented for ${extension || 'this format'}.`)
  }
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const preview = ports.data.molecular.preview(workerTextInput(input, text.text, formatWithoutDot(extension)))
  if (input.action.actionId === 'molecular.workbench') {
    return actionOk(ports.data.molecular.workbench(
      withActionPreview(input.action, preview) as Parameters<typeof ports.data.molecular.workbench>[0]
    ), text)
  }
  return unsupportedAction(input)
}

async function invokeSequenceAction(
  input: WorkspacePreviewProviderActionInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const preview = ports.data.sequence.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'sequence.selectRegion') {
    return actionOk(
      ports.data.sequence.selectRegion(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.sequence.selectRegion>[0]
      ),
      text
    )
  }
  if (input.action.actionId === 'sequence.search') {
    return actionOk(
      ports.data.sequence.search(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.sequence.search>[0]
      ),
      text
    )
  }
  if (input.action.actionId === 'sequence.inspectFeatures') {
    return actionOk({
      ok: true,
      format: preview.format,
      featureCount: preview.featureCount ?? preview.features.length,
      intervalCount: preview.intervalCount,
      variantCount: preview.variantCount ?? preview.variants.length,
      features: preview.features,
      variants: preview.variants,
      regionSummary: preview.regionSummary,
      visibleText: preview.observation?.visibleText
    }, text)
  }
  if (input.action.actionId === 'sequence.exportSummary') {
    return actionOk({
      ok: true,
      format: preview.format,
      sequenceCount: preview.sequenceCount,
      totalLength: preview.totalLength,
      alphabet: preview.alphabet,
      readCount: preview.readCount,
      featureCount: preview.featureCount,
      intervalCount: preview.intervalCount,
      variantCount: preview.variantCount,
      records: preview.records,
      references: preview.references,
      visibleText: preview.observation?.visibleText
    }, text)
  }
  return unsupportedAction(input)
}

async function invokeOmicsAction(
  input: WorkspacePreviewProviderActionInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const preview = ports.data.omics.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'omics.preview') {
    return actionOk({ ok: true, format: preview.format, matrices: preview.matrices, dataset: preview.dataset, placeholder: preview.placeholder, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'omics.inspectMetadata') {
    return actionOk({ ok: true, format: preview.format, metadata: preview.metadata, dataset: preview.dataset, matrices: preview.matrices, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'omics.selectDataset') {
    return actionOk(
      ports.data.omics.selectDataset(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.omics.selectDataset>[0]
      ),
      text
    )
  }
  if (input.action.actionId === 'omics.declareCapabilities') {
    return actionOk({ ok: true, format: preview.format, capabilities: preview.capabilities, placeholder: preview.placeholder }, text)
  }
  return unsupportedAction(input)
}

async function invokeBioimagingAction(
  input: WorkspacePreviewProviderActionInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderActionResult> {
  const bytes = await readBoundedBinaryPrefix(input.file, ports)
  if (!bytes.ok) return bytes
  const preview = ports.data.bioimaging.preview(workerBinaryInput(input, bytes.bytes))
  if (input.action.actionId === 'bioimaging.observeMetadata') {
    return actionOk({ ok: true, format: preview.format, detectedBy: preview.detectedBy, byteLength: preview.byteLength, dimensions: preview.dimensions, channels: preview.channels, placeholder: preview.placeholder, warnings: preview.warnings, visibleText: preview.observation?.visibleText }, bytes)
  }
  if (input.action.actionId === 'bioimaging.inspectHeader') {
    return actionOk({ ok: true, format: preview.format, detectedBy: preview.detectedBy, tiff: preview.tiff, ome: preview.ome, placeholder: preview.placeholder, warnings: preview.warnings }, bytes)
  }
  if (input.action.actionId === 'bioimaging.describeTilePlan') {
    return actionOk({ ok: true, format: preview.format, tilePlan: preview.tilePlan, dimensions: preview.dimensions, channels: preview.channels, placeholder: preview.placeholder, warnings: preview.warnings }, bytes)
  }
  if (input.action.actionId === 'bioimaging.selectRegion') {
    return actionOk(
      ports.data.bioimaging.selectRegion(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.bioimaging.selectRegion>[0]
      ),
      bytes
    )
  }
  if (input.action.actionId === 'bioimaging.selectChannels') {
    return actionOk(
      ports.data.bioimaging.selectChannels(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.bioimaging.selectChannels>[0]
      ),
      bytes
    )
  }
  if (input.action.actionId === 'bioimaging.annotateRegion') {
    return actionOk(
      ports.data.bioimaging.annotateRegion(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.bioimaging.annotateRegion>[0]
      ),
      bytes
    )
  }
  if (input.action.actionId === 'bioimaging.exportRoiSet') {
    return actionOk(
      ports.data.bioimaging.exportRoiSet(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.bioimaging.exportRoiSet>[0]
      ),
      bytes
    )
  }
  return unsupportedAction(input)
}

async function invokeSpectraAction(
  input: WorkspacePreviewProviderActionInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readBoundedTextPrefix(input.file, ports)
  if (!text.ok) return text
  const preview = ports.data.spectra.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'spectra.preview') {
    return actionOk({ ok: true, format: preview.format, spectrumCount: preview.spectrumCount, peakCount: preview.peakCount, scanCount: preview.scanCount, mzRange: preview.mzRange, intensityRange: preview.intensityRange, spectra: preview.spectra, scanMarkers: preview.scanMarkers, sampledPeaks: preview.sampledPeaks, fcs: preview.fcs, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'spectra.inspectScans') {
    return actionOk({ ok: true, format: preview.format, scanCount: preview.scanCount, scanMarkers: preview.scanMarkers, mzRange: preview.mzRange, intensityRange: preview.intensityRange, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'spectra.selectPeaksByRange') {
    return actionOk(
      ports.data.spectra.selectPeaksByRange({
        ...(decodeLifeScienceSelectionsInValue(input.action.input) as Record<string, unknown>),
        peaks: preview.sampledPeaks
      } as Parameters<typeof ports.data.spectra.selectPeaksByRange>[0]),
      text
    )
  }
  if (input.action.actionId === 'spectra.annotateRange') {
    return actionOk(
      ports.data.spectra.annotateRange(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.spectra.annotateRange>[0]
      ),
      text
    )
  }
  if (input.action.actionId === 'spectra.exportPeakList') {
    return actionOk(
      ports.data.spectra.exportPeakList(
        withActionPreview(input.action, preview) as Parameters<typeof ports.data.spectra.exportPeakList>[0]
      ),
      text
    )
  }
  return unsupportedAction(input)
}

async function prepareBioimagingArtifact(
  input: WorkspacePreviewProviderArtifactInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderArtifactResult> {
  if (input.request.kind !== 'tile' && input.request.kind !== 'thumbnail') return unsupportedArtifact(input)
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.tif', '.tiff', '.ome.tif', '.ome.tiff'].includes(extension)) {
    return unsupportedFormat(`Bioimaging tile artifacts are only implemented for TIFF and OME-TIFF files; received ${extension || 'unknown format'}.`)
  }
  const bytes = await readBinaryWithinLimit(input.file, ports)
  if (!bytes.ok) return bytes
  if (input.request.kind === 'thumbnail') {
    const decoded = ports.data.bioimaging.decodeThumbnail({
      ...workerBinaryInput(input, bytes.bytes),
      width: input.request.width,
      height: input.request.height,
      ...(input.request.channelIndex !== undefined ? { channelIndex: input.request.channelIndex } : {}),
      ...(input.request.z !== undefined ? { z: input.request.z } : {}),
      ...(input.request.t !== undefined ? { t: input.request.t } : {})
    })
    return { ok: true, kind: 'thumbnail', mimeType: decoded.mimeType, bytes: decoded.bytes, thumbnail: decoded.thumbnail, bytesRead: bytes.bytesRead, truncated: false, pixelDecoding: decoded.pixelDecoding, thumbnailRendererImplemented: decoded.thumbnailRendererImplemented }
  }
  const decoded = ports.data.bioimaging.decodeTile({
    ...workerBinaryInput(input, bytes.bytes),
    level: input.request.level,
    x: input.request.x,
    y: input.request.y,
    width: input.request.width,
    height: input.request.height,
    ...(input.request.channelIndex !== undefined ? { channelIndex: input.request.channelIndex } : {}),
    ...(input.request.z !== undefined ? { z: input.request.z } : {}),
    ...(input.request.t !== undefined ? { t: input.request.t } : {})
  })
  return { ok: true, kind: 'tile', mimeType: decoded.mimeType, bytes: decoded.bytes, tile: decoded.tile, bytesRead: bytes.bytesRead, truncated: false, pixelDecoding: decoded.pixelDecoding, tileRendererImplemented: decoded.tileRendererImplemented }
}

async function applyMolecularSelection(
  input: WorkspacePreviewProviderApplyEditInput
): Promise<WorkspacePreviewProviderApplyEditResult | null> {
  if (input.operation.kind !== 'domain.applyEdit' ||
      input.operation.operationType !== LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE) return null
  if (!isRecord(input.operation.data)) return { ok: false, message: 'Molecular selection edit data must be an object.' }
  const selection = decodeLifeScienceSelection(input.operation.data.selection)
  if (selection?.kind !== 'molecular') {
    return { ok: false, message: 'Molecular selection edit requires a valid v2 domain selection.' }
  }
  const session = workspacePreviewSessionSchema.parse({
    ...input.session,
    selection: encodeLifeScienceSelection(selection),
    updatedAt: input.now
  })
  return {
    ok: true,
    session,
    operationKind: input.operation.kind,
    appliedAt: input.now,
    audit: {
      pluginId: input.manifest.id,
      path: input.file.path,
      operationKind: input.operation.kind,
      effect: 'session-update'
    }
  }
}

async function exportSourceCopy(
  input: WorkspacePreviewProviderExportInput,
  ports: LifeSciencePorts
): Promise<WorkspacePreviewProviderExportResult> {
  const sourceFormat = extensionFromPreviewPath(input.file.path).replace(/^\./, '').trim().toLowerCase() || 'unknown'
  const requestedFormat = input.target.format.replace(/^\./, '').trim().toLowerCase()
  if (sourceFormat !== requestedFormat) {
    return { ok: false, message: `Life Science Preview source export can only copy the source ${sourceFormat} file; ${input.target.format} export requires a plugin implementation.` }
  }
  const writeTarget = input.target.path?.trim()
    ? await ports.writes.resolveSafeWriteTarget({
      path: input.target.path,
      workspaceRoot: input.file.workspaceRoot,
      createParentDirectories: true,
      targetKind: 'file'
    })
    : await resolveDefaultExportWriteTarget(input.file, requestedFormat, ports)
  await ports.writes.copyExclusive({ sourcePath: input.file.path, targetPath: writeTarget.path })
  return {
    ok: true,
    sessionId: input.session.id,
    path: writeTarget.path,
    target: input.target,
    exportedAt: input.now,
    audit: {
      pluginId: input.manifest.id,
      sourcePath: input.file.path,
      targetKind: input.target.kind,
      format: input.target.format,
      effect: 'source-copy'
    }
  }
}

async function resolveDefaultExportWriteTarget(
  file: WorkspacePreviewFileState,
  format: string,
  ports: LifeSciencePorts
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const relativeSourcePath = file.relativePath || basename(file.path)
    const normalizedPath = normalizePathSeparators(relativeSourcePath).replace(/^\/+/, '')
    const slashIndex = normalizedPath.lastIndexOf('/')
    const directory = slashIndex >= 0 ? `${normalizedPath.slice(0, slashIndex)}/` : ''
    const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath
    const extension = extensionFromPreviewPath(fileName)
    const baseName = extension ? fileName.slice(0, -extension.length) : fileName
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const candidate = `${directory}${baseName || 'export'}.export${suffix}.${format}`
    const writeTarget = await ports.writes.resolveSafeWriteTarget({
      path: candidate,
      workspaceRoot: file.workspaceRoot,
      createParentDirectories: true,
      targetKind: 'file'
    })
    if (!(await ports.writes.exists(writeTarget.path))) return writeTarget
  }
  throw new Error('Could not find an available default workspace export path after 100 attempts.')
}

function observationOk(
  input: WorkspacePreviewProviderObservationInput,
  read: { bytesRead: number; truncated: boolean },
  fields: Omit<ObservationBuildInput, keyof WorkspacePreviewProviderObservationInput>
): WorkspacePreviewProviderObservationResult {
  return { ok: true, bytesRead: read.bytesRead, truncated: read.truncated, observation: buildObservation({ ...input, ...fields }) }
}

function buildObservation(input: ObservationBuildInput): WorkspaceObservation {
  const kind = lifeScienceKindForPluginId(input.manifest.id)
  const workerSelection = input.selection
  const sessionSelection = input.session.selection
  const selection = sessionSelection ?? (workerSelection ? encodeLifeScienceSelection(workerSelection) : undefined)
  const observationMetadata = kind
    ? encodeObservationMetadata(input, kind)
    : null
  return workspaceObservationSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      ...(input.file.mimeType ? { mimeType: input.file.mimeType } : {}),
      ...(input.file.size !== undefined ? { size: input.file.size } : {}),
      ...(input.file.mtimeMs !== undefined ? { mtimeMs: input.file.mtimeMs } : {})
    },
    view: {
      pluginId: input.manifest.id,
      modality: input.manifest.modality,
      mode: input.session.mode,
      title: fileNameFromPreviewPath(input.file.relativePath || input.file.path) || basename(input.file.path)
    },
    ...(selection ? { selection } : {}),
    ...(input.visibleText ? { visibleText: input.visibleText } : {}),
    ...(input.annotations?.length ? { annotations: input.annotations } : {}),
    ...(observationMetadata ? { pluginMetadata: [observationMetadata] } : {}),
    actions: mergeActions(input.manifest, input.actions)
  })
}

function encodeObservationMetadata(
  input: ObservationBuildInput,
  kind: NonNullable<ReturnType<typeof lifeScienceKindForPluginId>>
): NonNullable<WorkspaceObservation['pluginMetadata']>[number] | null {
  switch (kind) {
    case 'molecular': return input.molecular
      ? encodeLifeScienceObservationMetadata(kind, input.molecular)
      : null
    case 'sequence': return input.sequence
      ? encodeLifeScienceObservationMetadata(kind, input.sequence)
      : null
    case 'omics': return input.omics
      ? encodeLifeScienceObservationMetadata(kind, input.omics)
      : null
    case 'bioimaging': return input.bioimaging
      ? encodeLifeScienceObservationMetadata(kind, sanitizeBioimagingObservation(input.bioimaging))
      : null
    case 'spectra': return input.spectra
      ? encodeLifeScienceObservationMetadata(kind, input.spectra)
      : null
  }
}

function workerTextInput<TFormat extends string>(
  input: WorkspacePreviewProviderObservationInput,
  text: string,
  format: TFormat
): { text: string; format: TFormat } & ReturnType<typeof workerFileFields> {
  return { text, format, ...workerFileFields(input) }
}

/**
 * The bioimaging worker contract pins `bytes: Uint8Array<ArrayBuffer>`.
 * Port reads may hand back views over a broader backing store, so normalize
 * to a fresh ArrayBuffer-backed copy at the worker boundary (same guarantee
 * as the production backend's readBinaryPrefix allocation).
 */
function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy
}

function workerBinaryInput(input: WorkspacePreviewProviderObservationInput, bytes: Uint8Array) {
  return { bytes: toArrayBufferBytes(bytes), format: 'auto' as const, ...workerFileFields(input) }
}

function workerFileFields(input: WorkspacePreviewProviderObservationInput) {
  return {
    path: input.file.relativePath ?? input.file.path,
    workspaceRoot: input.file.workspaceRoot,
    mimeType: input.file.mimeType,
    size: input.file.size,
    mtimeMs: input.file.mtimeMs
  }
}

type BoundedTextRead =
  | { ok: true; text: string; bytesRead: number; truncated: boolean }
  | ReadSideFailure

type BoundedBinaryRead =
  | { ok: true; bytes: Uint8Array; bytesRead: number; truncated: boolean }
  | ReadSideFailure

/** Text prefix read over the file ports; never fails with too-large (truncates at the text limit). */
async function readBoundedTextPrefix(
  file: WorkspacePreviewFileState,
  ports: LifeSciencePorts
): Promise<BoundedTextRead> {
  const binary = await readBoundedBinaryPrefix(file, ports, LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES)
  if (!binary.ok) return binary
  return { ok: true, text: decodeUtf8(binary.bytes), bytesRead: binary.bytesRead, truncated: binary.truncated }
}

/** Binary prefix read over the file ports (observation path: truncate, never too-large). */
async function readBoundedBinaryPrefix(
  file: WorkspacePreviewFileState,
  ports: LifeSciencePorts,
  maxBytes: number = LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES
): Promise<BoundedBinaryRead> {
  const info = await statThroughPorts(file, ports)
  if (!info.ok) return info
  if (!info.isFile) {
    return { ok: false, reason: 'worker-error', message: `Workspace preview path is not a file: ${file.path}.` }
  }
  let read
  try {
    read = await ports.files.readPrefix({
      path: file.path,
      workspaceRoot: file.workspaceRoot,
      maxBytes: Math.min(info.size, maxBytes)
    })
  } catch (error) {
    return portReadFailure(error)
  }
  return { ok: true, bytes: read.bytes, bytesRead: read.bytesRead, truncated: info.size > read.bytesRead }
}

/**
 * Full-file binary read guarded by the binary limit — the ported
 * readBinaryIfWithinLimit. Returns too-large WITHOUT reading when the file
 * exceeds the lightweight worker limit (stat-first governance).
 */
async function readBinaryWithinLimit(
  file: WorkspacePreviewFileState,
  ports: LifeSciencePorts
): Promise<
  | { ok: true; bytes: Uint8Array; bytesRead: number }
  | Extract<WorkspacePreviewProviderArtifactResult, { ok: false }>
> {
  const info = await statThroughPorts(file, ports)
  if (!info.ok) return info
  if (info.size > LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES) {
    return { ok: false, reason: 'too-large', message: `File is ${info.size} bytes; lightweight worker observation limit is ${LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES} bytes.` }
  }
  const binary = await readBoundedBinaryPrefix(file, ports, LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES)
  if (!binary.ok) return binary
  return { ok: true, bytes: binary.bytes, bytesRead: binary.bytesRead }
}

async function statThroughPorts(
  file: WorkspacePreviewFileState,
  ports: LifeSciencePorts
): Promise<{ ok: true; size: number; isFile: boolean } | ReadSideFailure> {
  try {
    return { ok: true, ...(await ports.files.stat({ path: file.path, workspaceRoot: file.workspaceRoot })) }
  } catch (error) {
    return portReadFailure(error)
  }
}

/** Maps port governance rejections onto provider failure results; rethrows anything else. */
function portReadFailure(error: unknown): ReadSideFailure {
  if (error instanceof LifeSciencePortError) {
    return {
      ok: false,
      reason: 'worker-error',
      message: `Workspace file port rejected the read (${error.code}): ${error.message}`
    }
  }
  throw error
}

function actionOk(result: unknown, read: { bytesRead: number; truncated: boolean }): Extract<WorkspacePreviewProviderActionResult, { ok: true }> {
  return {
    ok: true,
    result: encodeLifeScienceSelectionsInValue(result),
    bytesRead: read.bytesRead,
    truncated: read.truncated
  }
}

function withActionPreview<TPreview>(
  action: WorkspacePreviewPluginActionInput,
  preview: TPreview
): Record<string, unknown> & { preview: TPreview } {
  return {
    ...(decodeLifeScienceSelectionsInValue(action.input) as Record<string, unknown>),
    preview
  }
}

function unsupportedAction(input: WorkspacePreviewProviderActionInput): Extract<WorkspacePreviewProviderActionResult, { ok: false }> {
  return { ok: false, reason: 'unsupported-action', message: `Workspace preview action ${input.action.actionId} is not implemented for plugin ${input.manifest.id}.` }
}

function unsupportedArtifact(input: WorkspacePreviewProviderArtifactInput): Extract<WorkspacePreviewProviderArtifactResult, { ok: false }> {
  return { ok: false, reason: 'unsupported-artifact', message: `Workspace preview bioimaging artifacts are not implemented for plugin ${input.manifest.id}.` }
}

function unsupportedFormat(message: string): { ok: false; reason: 'unsupported-format'; message: string } {
  return { ok: false, reason: 'unsupported-format', message }
}

function sanitizeBioimagingObservation(
  bioimaging: LifeScienceBioimagingObservation
): LifeScienceBioimagingObservation {
  const dimensions = bioimaging.dimensions
  return {
    ...(bioimaging.format ? { format: bioimaging.format } : {}),
    ...(bioimaging.detectedBy ? { detectedBy: bioimaging.detectedBy } : {}),
    ...(bioimaging.byteLength !== undefined ? { byteLength: bioimaging.byteLength } : {}),
    ...(bioimaging.channels ? { channels: bioimaging.channels } : {}),
    ...(dimensions?.width && dimensions.height
      ? { dimensions: { width: dimensions.width, height: dimensions.height, ...(dimensions.z ? { z: dimensions.z } : {}), ...(dimensions.t ? { t: dimensions.t } : {}) } }
      : {}),
    ...(bioimaging.tilePlan ? { tilePlan: bioimaging.tilePlan } : {})
  }
}

function lifeScienceSelectionFromWorker(value: unknown): LifeScienceStructuredSelection | undefined {
  const parsed = lifeScienceStructuredSelectionSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function mergeActions(manifest: WorkspacePreviewPluginManifest, workerActions: string[] | undefined): string[] {
  return [...new Set([
    'observe',
    ...(manifest.capabilities.structuredSelection ? ['select'] : []),
    ...(manifest.capabilities.edit ? ['applyEdit', 'save'] : []),
    ...(manifest.capabilities.export?.length ? ['export'] : []),
    ...(workerActions ?? [])
  ])].slice(0, 256)
}

function mergeAnnotations(workerAnnotations: WorkspaceObservation['annotations'] | undefined, warnings: readonly string[] | undefined): WorkspaceObservation['annotations'] {
  const annotations = [...(workerAnnotations ?? [])]
  const existing = new Set(annotations.map((annotation) => annotation.summary).filter(Boolean))
  for (const warning of warnings ?? []) {
    if (existing.has(warning)) continue
    annotations.push({ id: `worker-warning-${annotations.length + 1}`, kind: 'warning', summary: warning })
  }
  return annotations.slice(0, 1000)
}

function formatWithoutDot(extension: string): 'pdb' | 'cif' | 'mmcif' | 'sdf' | 'mol' | 'mol2' | 'xyz' | 'xtc' | 'dcd' | 'trr' | 'mrc' | 'ccp4' {
  const format = extension.replace(/^\./, '')
  if (['pdb', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'xtc', 'dcd', 'trr', 'mrc', 'ccp4'].includes(format)) {
    return format as ReturnType<typeof formatWithoutDot>
  }
  return 'pdb'
}

function normalizePathSeparators(value: string): string {
  // Same semantics as @sciforge/domain-sdk/node/workspace-paths
  // normalizePathSeparators (pure string op — kept in core, not behind a port).
  return value.replaceAll('\\', '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const utf8Decoder = new TextDecoder('utf8')

function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}
