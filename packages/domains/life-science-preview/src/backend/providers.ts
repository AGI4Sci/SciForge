import { constants } from 'node:fs'
import { copyFile, open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createWorkspaceBioimagingService } from '@sciforge/workspace-bioimaging/service'
import { createWorkspaceMolecularService } from '@sciforge/workspace-molecular/service'
import { createWorkspaceOmicsService } from '@sciforge/workspace-omics/service'
import { createWorkspaceSequenceService } from '@sciforge/workspace-sequence/service'
import { createWorkspaceSpectraService } from '@sciforge/workspace-spectra/service'
import {
  resolveSafeWorkspaceWriteTarget,
  normalizePathSeparators
} from '@sciforge/domain-sdk/node/workspace-paths'
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
  type WorkspacePreviewProvider,
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
} from '../wire.js'

export const LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE =
  'sciforge.life-science-preview.molecular.set-selection'

export const LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES = 2_000_000
export const LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES = 4 * 1024 * 1024

const molecularService = createWorkspaceMolecularService()
const sequenceService = createWorkspaceSequenceService()
const omicsService = createWorkspaceOmicsService()
const bioimagingService = createWorkspaceBioimagingService()
const spectraService = createWorkspaceSpectraService()

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

export function createLifeScienceWorkspacePreviewProvider(
  manifest: WorkspacePreviewPluginManifest
): WorkspacePreviewProvider {
  const exportPreview = (input: WorkspacePreviewProviderExportInput) => exportSourceCopy(input)
  switch (manifest.id) {
    case 'molecular':
      return Object.freeze({
        pluginId: manifest.id,
        observe: observeMolecular,
        invokeAction: invokeMolecularAction,
        applyEdit: applyMolecularSelection,
        exportPreview
      })
    case 'sequence-genomics':
      return Object.freeze({ pluginId: manifest.id, observe: observeSequence, invokeAction: invokeSequenceAction, exportPreview })
    case 'biology-index-transport':
      return Object.freeze({ pluginId: manifest.id, observe: observeBiologyIndex })
    case 'omics-matrix':
      return Object.freeze({ pluginId: manifest.id, observe: observeOmics, invokeAction: invokeOmicsAction, exportPreview })
    case 'bioimaging':
      return Object.freeze({
        pluginId: manifest.id,
        observe: observeBioimaging,
        invokeAction: invokeBioimagingAction,
        prepareArtifact: prepareBioimagingArtifact,
        exportPreview
      })
    case 'proteomics-spectra':
      return Object.freeze({ pluginId: manifest.id, observe: observeSpectra, invokeAction: invokeSpectraAction, exportPreview })
    default:
      throw new Error(`Unsupported Life Science Preview provider manifest: ${manifest.id}.`)
  }
}

async function observeMolecular(
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz', '.xtc', '.dcd', '.trr', '.mrc', '.ccp4'].includes(extension)) {
    return unsupportedFormat(`Molecular worker text observation is not implemented for ${extension || 'this format'}.`)
  }
  const text = await readTextPrefix(input.file)
  const result = molecularService.preview(workerTextInput(input, text.text, formatWithoutDot(extension)))
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
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readTextPrefix(input.file)
  const result = sequenceService.preview(workerTextInput(input, text.text, 'auto'))
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
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readTextPrefix(input.file)
  const result = omicsService.preview(workerTextInput(input, text.text, 'auto'))
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
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  const bytes = await readBinaryPrefix(input.file)
  const result = bioimagingService.preview(workerBinaryInput(input, bytes.bytes))
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
  input: WorkspacePreviewProviderObservationInput
): Promise<WorkspacePreviewProviderObservationResult> {
  const text = await readTextPrefix(input.file)
  const result = spectraService.preview(workerTextInput(input, text.text, 'auto'))
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

async function invokeMolecularAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz'].includes(extension)) {
    return unsupportedFormat(`Molecular worker actions are not implemented for ${extension || 'this format'}.`)
  }
  const text = await readTextPrefix(input.file)
  const preview = molecularService.preview(workerTextInput(input, text.text, formatWithoutDot(extension)))
  if (input.action.actionId === 'molecular.workbench') {
    return actionOk(molecularService.workbench(withActionPreview(input.action, preview) as Parameters<typeof molecularService.workbench>[0]), text)
  }
  return unsupportedAction(input)
}

async function invokeSequenceAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readTextPrefix(input.file)
  const preview = sequenceService.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'sequence.selectRegion') {
    return actionOk(sequenceService.selectRegion(withActionPreview(input.action, preview) as Parameters<typeof sequenceService.selectRegion>[0]), text)
  }
  if (input.action.actionId === 'sequence.search') {
    return actionOk(sequenceService.search(withActionPreview(input.action, preview) as Parameters<typeof sequenceService.search>[0]), text)
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

async function invokeOmicsAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readTextPrefix(input.file)
  const preview = omicsService.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'omics.preview') {
    return actionOk({ ok: true, format: preview.format, matrices: preview.matrices, dataset: preview.dataset, placeholder: preview.placeholder, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'omics.inspectMetadata') {
    return actionOk({ ok: true, format: preview.format, metadata: preview.metadata, dataset: preview.dataset, matrices: preview.matrices, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'omics.selectDataset') {
    return actionOk(omicsService.selectDataset(withActionPreview(input.action, preview) as Parameters<typeof omicsService.selectDataset>[0]), text)
  }
  if (input.action.actionId === 'omics.declareCapabilities') {
    return actionOk({ ok: true, format: preview.format, capabilities: preview.capabilities, placeholder: preview.placeholder }, text)
  }
  return unsupportedAction(input)
}

async function invokeBioimagingAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
  const bytes = await readBinaryPrefix(input.file)
  const preview = bioimagingService.preview(workerBinaryInput(input, bytes.bytes))
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
    return actionOk(bioimagingService.selectRegion(withActionPreview(input.action, preview) as Parameters<typeof bioimagingService.selectRegion>[0]), bytes)
  }
  if (input.action.actionId === 'bioimaging.selectChannels') {
    return actionOk(bioimagingService.selectChannels(withActionPreview(input.action, preview) as Parameters<typeof bioimagingService.selectChannels>[0]), bytes)
  }
  if (input.action.actionId === 'bioimaging.annotateRegion') {
    return actionOk(bioimagingService.annotateRegion(withActionPreview(input.action, preview) as Parameters<typeof bioimagingService.annotateRegion>[0]), bytes)
  }
  if (input.action.actionId === 'bioimaging.exportRoiSet') {
    return actionOk(bioimagingService.exportRoiSet(withActionPreview(input.action, preview) as Parameters<typeof bioimagingService.exportRoiSet>[0]), bytes)
  }
  return unsupportedAction(input)
}

async function invokeSpectraAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
  const text = await readTextPrefix(input.file)
  const preview = spectraService.preview(workerTextInput(input, text.text, 'auto'))
  if (input.action.actionId === 'spectra.preview') {
    return actionOk({ ok: true, format: preview.format, spectrumCount: preview.spectrumCount, peakCount: preview.peakCount, scanCount: preview.scanCount, mzRange: preview.mzRange, intensityRange: preview.intensityRange, spectra: preview.spectra, scanMarkers: preview.scanMarkers, sampledPeaks: preview.sampledPeaks, fcs: preview.fcs, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'spectra.inspectScans') {
    return actionOk({ ok: true, format: preview.format, scanCount: preview.scanCount, scanMarkers: preview.scanMarkers, mzRange: preview.mzRange, intensityRange: preview.intensityRange, visibleText: preview.observation?.visibleText }, text)
  }
  if (input.action.actionId === 'spectra.selectPeaksByRange') {
    return actionOk(spectraService.selectPeaksByRange({ ...input.action.input, peaks: preview.sampledPeaks } as Parameters<typeof spectraService.selectPeaksByRange>[0]), text)
  }
  if (input.action.actionId === 'spectra.annotateRange') {
    return actionOk(spectraService.annotateRange(withActionPreview(input.action, preview) as Parameters<typeof spectraService.annotateRange>[0]), text)
  }
  if (input.action.actionId === 'spectra.exportPeakList') {
    return actionOk(spectraService.exportPeakList(withActionPreview(input.action, preview) as Parameters<typeof spectraService.exportPeakList>[0]), text)
  }
  return unsupportedAction(input)
}

async function prepareBioimagingArtifact(input: WorkspacePreviewProviderArtifactInput): Promise<WorkspacePreviewProviderArtifactResult> {
  if (input.request.kind !== 'tile' && input.request.kind !== 'thumbnail') return unsupportedArtifact(input)
  const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
  if (!['.tif', '.tiff', '.ome.tif', '.ome.tiff'].includes(extension)) {
    return unsupportedFormat(`Bioimaging tile artifacts are only implemented for TIFF and OME-TIFF files; received ${extension || 'unknown format'}.`)
  }
  const bytes = await readBinaryIfWithinLimit(input.file)
  if (!bytes.ok) return bytes
  if (input.request.kind === 'thumbnail') {
    const decoded = bioimagingService.decodeThumbnail({
      ...workerBinaryInput(input, bytes.bytes),
      width: input.request.width,
      height: input.request.height,
      ...(input.request.channelIndex !== undefined ? { channelIndex: input.request.channelIndex } : {}),
      ...(input.request.z !== undefined ? { z: input.request.z } : {}),
      ...(input.request.t !== undefined ? { t: input.request.t } : {})
    })
    return { ok: true, kind: 'thumbnail', mimeType: decoded.mimeType, bytes: decoded.bytes, thumbnail: decoded.thumbnail, bytesRead: bytes.bytesRead, truncated: false, pixelDecoding: decoded.pixelDecoding, thumbnailRendererImplemented: decoded.thumbnailRendererImplemented }
  }
  const decoded = bioimagingService.decodeTile({
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

async function exportSourceCopy(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult> {
  const sourceFormat = extensionFromPreviewPath(input.file.path).replace(/^\./, '').trim().toLowerCase() || 'unknown'
  const requestedFormat = input.target.format.replace(/^\./, '').trim().toLowerCase()
  if (sourceFormat !== requestedFormat) {
    return { ok: false, message: `Life Science Preview source export can only copy the source ${sourceFormat} file; ${input.target.format} export requires a plugin implementation.` }
  }
  const writeTarget = input.target.path?.trim()
    ? await resolveSafeWorkspaceWriteTarget(input.target.path, input.file.workspaceRoot, { createParentDirectories: true, targetKind: 'file' })
    : await resolveDefaultExportWriteTarget(input.file, requestedFormat)
  await copyFile(input.file.path, writeTarget.path, constants.COPYFILE_EXCL)
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

async function resolveDefaultExportWriteTarget(file: WorkspacePreviewFileState, format: string) {
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
    const writeTarget = await resolveSafeWorkspaceWriteTarget(candidate, file.workspaceRoot, { createParentDirectories: true, targetKind: 'file' })
    if (!(await fileExists(writeTarget.path))) return writeTarget
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

function workerBinaryInput(input: WorkspacePreviewProviderObservationInput, bytes: Uint8Array<ArrayBuffer>) {
  return { bytes, format: 'auto' as const, ...workerFileFields(input) }
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

async function readTextPrefix(file: WorkspacePreviewFileState) {
  const binary = await readBinaryPrefix(file, LIFE_SCIENCE_PREVIEW_TEXT_READ_LIMIT_BYTES)
  return { text: Buffer.from(binary.bytes).toString('utf8'), bytesRead: binary.bytesRead, truncated: binary.truncated }
}

async function readBinaryIfWithinLimit(file: WorkspacePreviewFileState): Promise<
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; bytesRead: number }
  | Extract<WorkspacePreviewProviderArtifactResult, { ok: false }>
> {
  const fileInfo = await stat(file.path)
  if (fileInfo.size > LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES) {
    return { ok: false, reason: 'too-large', message: `File is ${fileInfo.size} bytes; lightweight worker observation limit is ${LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES} bytes.` }
  }
  const binary = await readBinaryPrefix(file, LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES)
  return { ok: true, bytes: binary.bytes, bytesRead: binary.bytesRead }
}

async function readBinaryPrefix(
  file: WorkspacePreviewFileState,
  maxBytes = LIFE_SCIENCE_PREVIEW_BINARY_READ_LIMIT_BYTES
) {
  const fileInfo = await stat(file.path)
  const length = Math.min(fileInfo.size, maxBytes)
  const buffer = Buffer.alloc(length)
  const handle = await open(file.path, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    const bytes = new Uint8Array(new ArrayBuffer(bytesRead))
    bytes.set(buffer.subarray(0, bytesRead))
    return { bytes, bytesRead, truncated: fileInfo.size > bytesRead }
  } finally {
    await handle.close()
  }
}

function actionOk(result: unknown, read: { bytesRead: number; truncated: boolean }): Extract<WorkspacePreviewProviderActionResult, { ok: true }> {
  return {
    ok: true,
    result: encodeLifeScienceSelectionsInValue(result),
    bytesRead: read.bytesRead,
    truncated: read.truncated
  }
}

function withActionPreview<TPreview>(action: WorkspacePreviewPluginActionInput, preview: TPreview): Record<string, unknown> & { preview: TPreview } {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
