import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createWorkspaceTabularService } from '../../../../packages/workers/workspace-tabular/src/service'
import type { WorkspaceTabularPreviewResult } from '../../../../packages/workers/workspace-tabular/src/contract'
import { createWorkspaceDeckService } from '../../../../packages/workers/workspace-deck/src/service'
import { createWorkspaceMolecularService } from '../../../../packages/workers/workspace-molecular/src/service'
import { createWorkspaceSequenceService } from '../../../../packages/workers/workspace-sequence/src/service'
import { createWorkspaceOmicsService } from '../../../../packages/workers/workspace-omics/src/service'
import { createWorkspaceBioimagingService } from '../../../../packages/workers/workspace-bioimaging/src/service'
import { createWorkspaceSpectraService } from '../../../../packages/workers/workspace-spectra/src/service'
import type { WorkspaceDeckPreviewResult } from '../../../../packages/workers/workspace-deck/src/contract'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS,
  extensionFromPreviewPath,
  fileNameFromPreviewPath,
  workspaceObservationSchema,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginActionInput,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession
} from '../../../shared/workspace-preview'

export const WORKSPACE_PREVIEW_WORKER_TEXT_BYTES = 2_000_000
export const WORKSPACE_PREVIEW_WORKER_BINARY_BYTES = 4 * 1024 * 1024

export type WorkspacePreviewWorkerObservationInput = {
  session: WorkspacePreviewSession
  manifest: WorkspacePreviewPluginManifest
  file: WorkspacePreviewFileState
}

export type WorkspacePreviewWorkerObservationResult =
  | {
      ok: true
      observation: WorkspaceObservation
      bytesRead: number
      truncated: boolean
    }
  | {
      ok: false
      message: string
      reason: 'unsupported-plugin' | 'unsupported-format' | 'too-large' | 'worker-error'
    }

export type WorkspacePreviewWorkerActionInput = WorkspacePreviewWorkerObservationInput & {
  action: WorkspacePreviewPluginActionInput
}

export type WorkspacePreviewWorkerActionResult =
  | {
      ok: true
      result: unknown
      bytesRead: number
      truncated: boolean
    }
  | {
      ok: false
      message: string
      reason: 'unsupported-plugin' | 'unsupported-action' | 'unsupported-format' | 'too-large' | 'worker-error'
    }

export type WorkspacePreviewWorkerClientOptions = {
  maxTextBytes?: number
  maxBinaryBytes?: number
}

type ObservationBuildInput = WorkspacePreviewWorkerObservationInput & {
  visibleText?: string
  selection?: WorkspaceObservation['selection']
  outline?: WorkspaceObservation['outline']
  tables?: WorkspaceObservation['tables']
  tabular?: WorkspaceObservation['tabular']
  slides?: WorkspaceObservation['slides']
  molecular?: WorkspaceObservation['molecular']
  sequence?: WorkspaceObservation['sequence']
  omics?: WorkspaceObservation['omics']
  bioimaging?: WorkspaceObservation['bioimaging']
  spectra?: WorkspaceObservation['spectra']
  annotations?: WorkspaceObservation['annotations']
  deck?: WorkspaceObservation['deck']
  actions?: string[]
  readOnly?: boolean
}

type WorkerObservationLike = Partial<WorkspaceObservation> | undefined

export class WorkspacePreviewWorkerClient {
  private readonly maxTextBytes: number
  private readonly maxBinaryBytes: number

  constructor(options: WorkspacePreviewWorkerClientOptions = {}) {
    this.maxTextBytes = options.maxTextBytes ?? WORKSPACE_PREVIEW_WORKER_TEXT_BYTES
    this.maxBinaryBytes = options.maxBinaryBytes ?? WORKSPACE_PREVIEW_WORKER_BINARY_BYTES
  }

  async observe(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    try {
      switch (input.manifest.id) {
        case 'tabular':
          return await this.observeTabular(input)
        case 'deck':
          return await this.observeDeck(input)
        case 'molecular':
          return await this.observeMolecular(input)
        case 'sequence-genomics':
          return await this.observeSequence(input)
        case 'omics-matrix':
          return await this.observeOmics(input)
        case 'bioimaging':
          return await this.observeBioimaging(input)
        case 'proteomics-spectra':
          return await this.observeSpectra(input)
        default:
          return {
            ok: false,
            reason: 'unsupported-plugin',
            message: `Workspace preview plugin ${input.manifest.id} does not have a first-party worker observer.`
          }
      }
    } catch (error) {
      return {
        ok: false,
        reason: 'worker-error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async invokeAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    try {
      switch (input.manifest.id) {
        case 'tabular':
          return await this.invokeTabularAction(input)
        case 'deck':
          return await this.invokeDeckAction(input)
        case 'molecular':
          return await this.invokeMolecularAction(input)
        case 'sequence-genomics':
          return await this.invokeSequenceAction(input)
        case 'omics-matrix':
          return await this.invokeOmicsAction(input)
        case 'bioimaging':
          return await this.invokeBioimagingAction(input)
        case 'proteomics-spectra':
          return await this.invokeSpectraAction(input)
        default:
          return {
            ok: false,
            reason: 'unsupported-plugin',
            message: `Workspace preview plugin ${input.manifest.id} does not expose first-party worker actions.`
          }
      }
    } catch (error) {
      return {
        ok: false,
        reason: 'worker-error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async observeTabular(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const service = createWorkspaceTabularService()

    if (isXlsxTabularFile(input)) {
      const bytes = await this.readBinaryIfWithinLimit(input.file)
      if (!bytes.ok) return bytes

      const result = await service.previewXlsx({
        bytes: bytes.bytes,
        path: input.file.relativePath ?? input.file.path,
        workspaceRoot: input.file.workspaceRoot,
        mimeType: input.file.mimeType,
        size: input.file.size,
        mtimeMs: input.file.mtimeMs
      })
      const workerObservation = result.observation
      const readOnly = true
      return {
        ok: true,
        bytesRead: bytes.bytesRead,
        truncated: false,
        observation: buildObservation({
          ...input,
          visibleText: workerObservation?.visibleText,
          selection: workerObservation?.selection,
          tables: workerObservation?.tables,
          tabular: {
            header: result.header,
            rows: result.previewRows,
            truncatedRows: result.truncatedRows,
            truncatedColumns: result.truncatedColumns
          },
          annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
          actions: tabularObservationActions(workerObservation?.actions, readOnly),
          readOnly
        })
      }
    }

    const text = await this.readTextPrefix(input.file)
    const result = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    const readOnly = isReadOnlyTabularPreviewFormat(result.format)
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
        tables: workerObservation?.tables,
        tabular: {
          header: result.header,
          rows: result.previewRows,
          truncatedRows: result.truncatedRows,
          truncatedColumns: result.truncatedColumns
        },
        annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
        actions: tabularObservationActions(workerObservation?.actions, readOnly),
        readOnly
      })
    }
  }

  private async observeDeck(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (extension !== '.pptx') {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: 'Only PPTX deck worker observation is implemented in the lightweight worker.'
      }
    }
    const bytes = await this.readBinaryIfWithinLimit(input.file)
    if (!bytes.ok) return bytes

    const result = await createWorkspaceDeckService().previewPptx({
      bytes: bytes.bytes,
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    return {
      ok: true,
      bytesRead: bytes.bytesRead,
      truncated: false,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation.visibleText,
        slides: workerObservation.slides,
        deck: buildDeckObservation(result),
        annotations: mergeAnnotations(workerObservation.annotations, result.warnings ?? []),
        actions: workerObservation.actions
      })
    }
  }

  private async observeMolecular(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz', '.xtc', '.dcd', '.trr', '.mrc', '.ccp4'].includes(extension)) {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: `Molecular worker text observation is not implemented for ${extension || 'this format'}.`
      }
    }
    const text = await this.readTextPrefix(input.file)
    const result = createWorkspaceMolecularService().preview({
      text: text.text,
      format: formatWithoutDot(extension),
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
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
  }

  private async observeSequence(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const text = await this.readTextPrefix(input.file)
    const result = createWorkspaceSequenceService().preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
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
  }

  private async observeOmics(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const text = await this.readTextPrefix(input.file)
    const result = createWorkspaceOmicsService().preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const matrix = result.matrices[0]
    const matrixShape = matrix?.rowCount !== undefined && matrix.columnCount !== undefined
      ? [matrix.rowCount, matrix.columnCount] as [number, number]
      : undefined
    const workerObservation = result.observation as WorkerObservationLike
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
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
  }

  private async observeBioimaging(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const bytes = await this.readBinaryPrefix(input.file)
    const result = createWorkspaceBioimagingService().preview({
      bytes: bytes.bytes,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    return {
      ok: true,
      bytesRead: bytes.bytesRead,
      truncated: bytes.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
        bioimaging: {
          format: result.format,
          detectedBy: result.detectedBy,
          byteLength: result.byteLength,
          channels: result.channels,
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
                  status: result.tilePlan.status,
                  source: result.tilePlan.source,
                  levelCount: result.tilePlan.levels.length,
                  tileSize: result.tilePlan.recommendedTileSize,
                  pixelDecoding: result.tilePlan.pixelDecoding,
                  tileRendererImplemented: result.tilePlan.tileRendererImplemented
                }
              }
            : {})
        },
        annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
        actions: workerObservation?.actions
      })
    }
  }

  private async observeSpectra(input: WorkspacePreviewWorkerObservationInput): Promise<WorkspacePreviewWorkerObservationResult> {
    const text = await this.readTextPrefix(input.file)
    const result = createWorkspaceSpectraService().preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation as WorkerObservationLike
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
        spectra: {
          format: result.format,
          spectrumCount: result.spectrumCount,
          peakCount: result.peakCount,
          scanCount: result.scanCount,
          xAxis: result.format === 'fcs' ? 'event' : 'm/z',
          ...(result.mzRange ? { mzRange: result.mzRange } : {}),
          ...(result.intensityRange ? { intensityRange: result.intensityRange } : {}),
          ...(result.sampledPeaks.length
            ? { sampledPeaks: result.sampledPeaks.slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) }
            : {}),
          ...(result.scanMarkers.length
            ? { scanMarkers: result.scanMarkers.slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) }
            : {})
        },
        annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
        actions: workerObservation?.actions
      })
    }
  }

  private async invokeMolecularAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (!['.pdb', '.cif', '.mmcif', '.sdf', '.mol', '.mol2', '.xyz'].includes(extension)) {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: `Molecular worker actions are not implemented for ${extension || 'this format'}.`
      }
    }

    const text = await this.readTextPrefix(input.file)
    const service = createWorkspaceMolecularService()
    const preview = service.preview({
      text: text.text,
      format: formatWithoutDot(extension),
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'molecular.select') {
      return actionOk(service.select(withActionPreview(input.action, preview) as Parameters<typeof service.select>[0]), text)
    }
    if (input.action.actionId === 'molecular.measureDistance') {
      return actionOk(service.measureDistance(withActionPreview(input.action, preview) as Parameters<typeof service.measureDistance>[0]), text)
    }
    return unsupportedAction(input)
  }

  private async invokeTabularAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const service = createWorkspaceTabularService()
    const previewRead = await this.readTabularPreviewForAction(input, service)
    if (!previewRead.ok) return previewRead

    const { preview, read, readOnly } = previewRead
    if (readOnly && isTabularWriteAction(input.action.actionId)) {
      return {
        ok: false,
        reason: 'unsupported-action',
        message: `${tabularFormatDisplayName(preview.format)} tabular preview is read-only; action ${input.action.actionId} is not available.`
      }
    }

    const rows = preview.previewRows
    const rowValues = rows.map((row) => row.values)

    if (input.action.actionId === 'tabular.preview' || input.action.actionId === 'tabular.inspectColumns') {
      return actionOk({
        ok: true,
        format: preview.format,
        rowCount: preview.rowCount,
        columnCount: preview.columnCount,
        header: preview.header,
        previewRows: preview.previewRows,
        truncatedRows: preview.truncatedRows,
        truncatedColumns: preview.truncatedColumns,
        columns: preview.columns,
        visibleText: preview.observation?.visibleText
      }, read)
    }
    if (input.action.actionId === 'tabular.filterRows' || input.action.actionId === 'tabular.sortRows') {
      return actionOk(service.queryPreviewRows({
        ...input.action.input,
        rows,
        header: preview.header
      } as Parameters<typeof service.queryPreviewRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.selectCells') {
      return actionOk(service.summarizeSelection({
        rows,
        header: preview.header,
        selection: tabularSelectionFromActionInput(input.action.input)
      } as Parameters<typeof service.summarizeSelection>[0]), read)
    }
    if (input.action.actionId === 'tabular.updateCell') {
      return actionOk(service.updateCell({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.updateCell>[0]), read)
    }
    if (input.action.actionId === 'tabular.insertRows') {
      return actionOk(service.insertRows({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.insertRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.insertColumns') {
      return actionOk(service.insertColumns({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.insertColumns>[0]), read)
    }
    if (input.action.actionId === 'tabular.deleteRows') {
      return actionOk(service.deleteRows({
        rows: rowValues,
        rowIndices: numberArrayFromActionInput(input.action.input, 'rowIndices', 'rows')
      } as Parameters<typeof service.deleteRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.deleteColumns') {
      return actionOk(service.deleteColumns({
        rows: rowValues,
        columnIndices: numberArrayFromActionInput(input.action.input, 'columnIndices', 'columns')
      } as Parameters<typeof service.deleteColumns>[0]), read)
    }
    return unsupportedAction(input)
  }

  private async readTabularPreviewForAction(
    input: WorkspacePreviewWorkerActionInput,
    service: ReturnType<typeof createWorkspaceTabularService>
  ): Promise<{
    ok: true
    preview: WorkspaceTabularPreviewResult
    read: { bytesRead: number; truncated: boolean }
    readOnly: boolean
  } | Extract<WorkspacePreviewWorkerActionResult, { ok: false }>> {
    if (isXlsxTabularFile(input)) {
      const bytes = await this.readBinaryIfWithinLimit(input.file)
      if (!bytes.ok) return bytes
      return {
        ok: true,
        preview: await service.previewXlsx({
          bytes: bytes.bytes,
          path: input.file.relativePath ?? input.file.path,
          workspaceRoot: input.file.workspaceRoot,
          mimeType: input.file.mimeType,
          size: input.file.size,
          mtimeMs: input.file.mtimeMs
        }),
        read: {
          bytesRead: bytes.bytesRead,
          truncated: false
        },
        readOnly: true
      }
    }

    const text = await this.readTextPrefix(input.file)
    const preview = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    return {
      ok: true,
      preview,
      read: text,
      readOnly: isReadOnlyTabularPreviewFormat(preview.format)
    }
  }

  private async invokeDeckAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (extension !== '.pptx') {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: 'Only PPTX deck worker actions are implemented in the lightweight worker.'
      }
    }
    const bytes = await this.readBinaryIfWithinLimit(input.file)
    if (!bytes.ok) return bytes

    const service = createWorkspaceDeckService()
    const preview = await service.previewPptx({
      bytes: bytes.bytes,
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'deck.selectSlide') {
      return actionOk(service.selectSlide(withActionPreview(input.action, preview) as Parameters<typeof service.selectSlide>[0]), {
        bytesRead: bytes.bytesRead,
        truncated: false
      })
    }
    if (input.action.actionId === 'deck.selectText') {
      return actionOk(service.selectText(withActionPreview(input.action, preview) as Parameters<typeof service.selectText>[0]), {
        bytesRead: bytes.bytesRead,
        truncated: false
      })
    }
    return unsupportedAction(input)
  }

  private async invokeSequenceAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const text = await this.readTextPrefix(input.file)
    const service = createWorkspaceSequenceService()
    const preview = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'sequence.selectRegion') {
      return actionOk(service.selectRegion(withActionPreview(input.action, preview) as Parameters<typeof service.selectRegion>[0]), text)
    }
    if (input.action.actionId === 'sequence.search') {
      return actionOk(service.search(withActionPreview(input.action, preview) as Parameters<typeof service.search>[0]), text)
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

  private async invokeOmicsAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const text = await this.readTextPrefix(input.file)
    const service = createWorkspaceOmicsService()
    const preview = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'omics.preview') {
      return actionOk({
        ok: true,
        format: preview.format,
        matrices: preview.matrices,
        dataset: preview.dataset,
        placeholder: preview.placeholder,
        visibleText: preview.observation?.visibleText
      }, text)
    }
    if (input.action.actionId === 'omics.inspectMetadata') {
      return actionOk({
        ok: true,
        format: preview.format,
        metadata: preview.metadata,
        dataset: preview.dataset,
        matrices: preview.matrices,
        visibleText: preview.observation?.visibleText
      }, text)
    }
    if (input.action.actionId === 'omics.selectDataset') {
      return actionOk(service.selectDataset(withActionPreview(input.action, preview) as Parameters<typeof service.selectDataset>[0]), text)
    }
    if (input.action.actionId === 'omics.declareCapabilities') {
      return actionOk({
        ok: true,
        format: preview.format,
        capabilities: preview.capabilities,
        placeholder: preview.placeholder
      }, text)
    }
    return unsupportedAction(input)
  }

  private async invokeBioimagingAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const bytes = await this.readBinaryPrefix(input.file)
    const service = createWorkspaceBioimagingService()
    const preview = service.preview({
      bytes: bytes.bytes,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'bioimaging.observeMetadata') {
      return actionOk({
        ok: true,
        format: preview.format,
        detectedBy: preview.detectedBy,
        byteLength: preview.byteLength,
        dimensions: preview.dimensions,
        channels: preview.channels,
        placeholder: preview.placeholder,
        warnings: preview.warnings,
        visibleText: preview.observation?.visibleText
      }, bytes)
    }
    if (input.action.actionId === 'bioimaging.inspectHeader') {
      return actionOk({
        ok: true,
        format: preview.format,
        detectedBy: preview.detectedBy,
        tiff: preview.tiff,
        ome: preview.ome,
        placeholder: preview.placeholder,
        warnings: preview.warnings
      }, bytes)
    }
    if (input.action.actionId === 'bioimaging.describeTilePlan') {
      return actionOk({
        ok: true,
        format: preview.format,
        tilePlan: preview.tilePlan,
        dimensions: preview.dimensions,
        channels: preview.channels,
        placeholder: preview.placeholder,
        warnings: preview.warnings
      }, bytes)
    }
    if (input.action.actionId === 'bioimaging.selectRegion') {
      return actionOk(service.selectRegion(withActionPreview(input.action, preview) as Parameters<typeof service.selectRegion>[0]), bytes)
    }
    if (input.action.actionId === 'bioimaging.selectChannels') {
      return actionOk(service.selectChannels(withActionPreview(input.action, preview) as Parameters<typeof service.selectChannels>[0]), bytes)
    }
    if (input.action.actionId === 'bioimaging.annotateRegion') {
      return actionOk(service.annotateRegion(withActionPreview(input.action, preview) as Parameters<typeof service.annotateRegion>[0]), bytes)
    }
    if (input.action.actionId === 'bioimaging.exportRoiSet') {
      return actionOk(service.exportRoiSet(withActionPreview(input.action, preview) as Parameters<typeof service.exportRoiSet>[0]), bytes)
    }
    return unsupportedAction(input)
  }

  private async invokeSpectraAction(input: WorkspacePreviewWorkerActionInput): Promise<WorkspacePreviewWorkerActionResult> {
    const text = await this.readTextPrefix(input.file)
    const service = createWorkspaceSpectraService()
    const preview = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'spectra.preview') {
      return actionOk({
        ok: true,
        format: preview.format,
        spectrumCount: preview.spectrumCount,
        peakCount: preview.peakCount,
        scanCount: preview.scanCount,
        mzRange: preview.mzRange,
        intensityRange: preview.intensityRange,
        spectra: preview.spectra,
        scanMarkers: preview.scanMarkers,
        sampledPeaks: preview.sampledPeaks,
        fcs: preview.fcs,
        visibleText: preview.observation?.visibleText
      }, text)
    }
    if (input.action.actionId === 'spectra.inspectScans') {
      return actionOk({
        ok: true,
        format: preview.format,
        scanCount: preview.scanCount,
        scanMarkers: preview.scanMarkers,
        mzRange: preview.mzRange,
        intensityRange: preview.intensityRange,
        visibleText: preview.observation?.visibleText
      }, text)
    }
    if (input.action.actionId === 'spectra.selectPeaksByRange') {
      return actionOk(service.selectPeaksByRange({
        ...input.action.input,
        peaks: preview.sampledPeaks
      } as Parameters<typeof service.selectPeaksByRange>[0]), text)
    }
    if (input.action.actionId === 'spectra.annotateRange') {
      return actionOk(service.annotateRange(withActionPreview(input.action, preview) as Parameters<typeof service.annotateRange>[0]), text)
    }
    if (input.action.actionId === 'spectra.exportPeakList') {
      return actionOk(service.exportPeakList(withActionPreview(input.action, preview) as Parameters<typeof service.exportPeakList>[0]), text)
    }
    return unsupportedAction(input)
  }

  private async readTextPrefix(file: WorkspacePreviewFileState): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
    const binary = await this.readBinaryPrefix(file, this.maxTextBytes)
    return {
      text: Buffer.from(binary.bytes).toString('utf8'),
      bytesRead: binary.bytesRead,
      truncated: binary.truncated
    }
  }

  private async readBinaryIfWithinLimit(
    file: WorkspacePreviewFileState
  ): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer>; bytesRead: number } | Extract<WorkspacePreviewWorkerObservationResult, { ok: false }>> {
    const fileInfo = await stat(file.path)
    if (fileInfo.size > this.maxBinaryBytes) {
      return {
        ok: false,
        reason: 'too-large',
        message: `File is ${fileInfo.size} bytes; lightweight worker observation limit is ${this.maxBinaryBytes} bytes.`
      }
    }
    const binary = await this.readBinaryPrefix(file, this.maxBinaryBytes)
    return {
      ok: true,
      bytes: binary.bytes,
      bytesRead: binary.bytesRead
    }
  }

  private async readBinaryPrefix(
    file: WorkspacePreviewFileState,
    maxBytes = this.maxBinaryBytes
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; bytesRead: number; truncated: boolean }> {
    const fileInfo = await stat(file.path)
    const length = Math.min(fileInfo.size, maxBytes)
    const buffer = Buffer.alloc(length)
    const handle = await open(file.path, 'r')
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      const bytes = new Uint8Array(new ArrayBuffer(bytesRead))
      bytes.set(buffer.subarray(0, bytesRead))
      return {
        bytes,
        bytesRead,
        truncated: fileInfo.size > bytesRead
      }
    } finally {
      await handle.close()
    }
  }
}

function actionOk(
  result: unknown,
  read: { bytesRead: number; truncated: boolean }
): Extract<WorkspacePreviewWorkerActionResult, { ok: true }> {
  return {
    ok: true,
    result,
    bytesRead: read.bytesRead,
    truncated: read.truncated
  }
}

function withActionPreview<TPreview>(
  action: WorkspacePreviewPluginActionInput,
  preview: TPreview
): Record<string, unknown> & { preview: TPreview } {
  return {
    ...action.input,
    preview
  }
}

function tabularSelectionFromActionInput(input: Record<string, unknown>): unknown {
  return isRecord(input.selection) ? input.selection : input
}

function numberArrayFromActionInput(
  input: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string
): unknown[] {
  const value = input[primaryKey] ?? input[fallbackKey]
  return Array.isArray(value) ? value : []
}

function tabularObservationActions(actions: string[] | undefined, readOnly: boolean): string[] | undefined {
  if (!readOnly) return actions
  return actions?.filter((actionId) => !isTabularWriteAction(actionId))
}

function isXlsxTabularFile(input: WorkspacePreviewWorkerObservationInput): boolean {
  const path = input.file.relativePath ?? input.file.path
  const extension = extensionFromPreviewPath(path, input.manifest.extensions)
  const mimeType = input.file.mimeType?.toLowerCase()
  return extension === '.xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function isReadOnlyTabularPreviewFormat(format: WorkspaceTabularPreviewResult['format']): boolean {
  return format === 'xlsx' || format === 'jsonl' || format === 'ndjson'
}

function tabularFormatDisplayName(format: WorkspaceTabularPreviewResult['format']): string {
  if (format === 'xlsx') return 'XLSX'
  if (format === 'ndjson') return 'NDJSON'
  return format.toUpperCase()
}

function isTabularWriteAction(actionId: string): boolean {
  return actionId === 'tabular.updateCell' ||
    actionId === 'tabular.insertRows' ||
    actionId === 'tabular.insertColumns' ||
    actionId === 'tabular.deleteRows' ||
    actionId === 'tabular.deleteColumns'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function unsupportedAction(
  input: WorkspacePreviewWorkerActionInput
): Extract<WorkspacePreviewWorkerActionResult, { ok: false }> {
  return {
    ok: false,
    reason: 'unsupported-action',
    message: `Workspace preview action ${input.action.actionId} is not implemented for plugin ${input.manifest.id}.`
  }
}

function buildObservation(input: ObservationBuildInput): WorkspaceObservation {
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
    ...(input.session.selection ?? input.selection ? { selection: input.session.selection ?? input.selection } : {}),
    ...(input.visibleText ? { visibleText: input.visibleText } : {}),
    ...(input.outline ? { outline: input.outline } : {}),
    ...(input.tables ? { tables: input.tables } : {}),
    ...(input.tabular ? { tabular: input.tabular } : {}),
    ...(input.slides ? { slides: input.slides } : {}),
    ...(input.deck ? { deck: input.deck } : {}),
    ...(input.molecular ? { molecular: input.molecular } : {}),
    ...(input.sequence ? { sequence: input.sequence } : {}),
    ...(input.omics ? { omics: input.omics } : {}),
    ...(input.bioimaging ? { bioimaging: sanitizeBioimagingObservation(input.bioimaging) } : {}),
    ...(input.spectra ? { spectra: input.spectra } : {}),
    ...(input.annotations?.length ? { annotations: input.annotations } : {}),
    actions: mergeActions(input.manifest, input.actions, input.readOnly)
  })
}

function buildDeckObservation(
  result: Pick<WorkspaceDeckPreviewResult, 'elementCount' | 'elements' | 'truncatedElements' | 'observation'>
): WorkspaceObservation['deck'] | undefined {
  const slidePreviews = result.observation.deck?.slidePreviews?.slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) ?? []
  if (result.elementCount === 0 && slidePreviews.length === 0) return undefined

  const textElements = result.elements
    .slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    .map((element) => ({
      slideId: element.slideId,
      elementId: element.id,
      kind: element.kind,
      text: element.text
    }))

  return {
    ...(result.elementCount > 0
      ? {
          textElementCount: result.elementCount,
          truncatedTextElements: result.truncatedElements || textElements.length < result.elementCount,
          textElements
        }
      : {}),
    ...(slidePreviews.length > 0 ? { slidePreviews } : {})
  }
}

function sanitizeBioimagingObservation(
  bioimaging: NonNullable<WorkspaceObservation['bioimaging']>
): NonNullable<WorkspaceObservation['bioimaging']> {
  const dimensions = bioimaging.dimensions
  return {
    ...(bioimaging.format ? { format: bioimaging.format } : {}),
    ...(bioimaging.detectedBy ? { detectedBy: bioimaging.detectedBy } : {}),
    ...(bioimaging.byteLength !== undefined ? { byteLength: bioimaging.byteLength } : {}),
    ...(bioimaging.channels ? { channels: bioimaging.channels } : {}),
    ...(dimensions?.width && dimensions.height
      ? {
          dimensions: {
            width: dimensions.width,
            height: dimensions.height,
            ...(dimensions.z ? { z: dimensions.z } : {}),
            ...(dimensions.t ? { t: dimensions.t } : {})
          }
        }
      : {}),
    ...(bioimaging.tilePlan ? { tilePlan: bioimaging.tilePlan } : {})
  }
}

function mergeActions(
  manifest: WorkspacePreviewPluginManifest,
  workerActions: string[] | undefined,
  readOnly = false
): string[] {
  return [...new Set([
    'observe',
    ...(manifest.capabilities.structuredSelection ? ['select'] : []),
    ...(manifest.capabilities.edit && !readOnly ? ['applyEdit', 'save'] : []),
    ...(manifest.capabilities.export?.length ? ['export'] : []),
    ...(workerActions ?? [])
  ])].slice(0, 256)
}

function mergeAnnotations(
  workerAnnotations: WorkspaceObservation['annotations'] | undefined,
  warnings: readonly string[] | undefined
): WorkspaceObservation['annotations'] {
  const annotations = [...(workerAnnotations ?? [])]
  const existing = new Set(annotations.map((annotation) => annotation.summary).filter(Boolean))
  for (const warning of warnings ?? []) {
    if (existing.has(warning)) continue
    annotations.push({
      id: `worker-warning-${annotations.length + 1}`,
      kind: 'warning',
      summary: warning
    })
  }
  return annotations.slice(0, 1000)
}

function formatWithoutDot(
  extension: string
): 'pdb' | 'cif' | 'mmcif' | 'sdf' | 'mol' | 'mol2' | 'xyz' | 'xtc' | 'dcd' | 'trr' | 'mrc' | 'ccp4' {
  const format = extension.replace(/^\./, '')
  if (format === 'pdb' || format === 'cif' || format === 'mmcif' || format === 'sdf' || format === 'mol' || format === 'mol2' || format === 'xyz' || format === 'xtc' || format === 'dcd' || format === 'trr' || format === 'mrc' || format === 'ccp4') {
    return format
  }
  return 'pdb'
}

export function createWorkspacePreviewWorkerClient(
  options: WorkspacePreviewWorkerClientOptions = {}
): WorkspacePreviewWorkerClient {
  return new WorkspacePreviewWorkerClient(options)
}
