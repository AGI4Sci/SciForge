import {
  workspaceBioimagingChannelSelectionInputSchema,
  workspaceBioimagingPreviewInputSchema,
  workspaceBioimagingRegionAnnotationInputSchema,
  workspaceBioimagingRegionSelectionInputSchema,
  workspaceBioimagingRoiSetExportInputSchema,
  workspaceBioimagingThumbnailDecodeInputSchema,
  workspaceBioimagingTileDecodeInputSchema,
  type WorkspaceBioimagingChannelSelectionInput,
  type WorkspaceBioimagingChannelSelectionResult,
  type WorkspaceBioimagingPreviewInput,
  type WorkspaceBioimagingPreviewResult,
  type WorkspaceBioimagingRegionAnnotationInput,
  type WorkspaceBioimagingRegionAnnotationResult,
  type WorkspaceBioimagingRegionSelectionInput,
  type WorkspaceBioimagingRegionSelectionResult,
  type WorkspaceBioimagingRoiSetExportInput,
  type WorkspaceBioimagingRoiSetExportResult,
  type WorkspaceBioimagingThumbnailDecodeInput,
  type WorkspaceBioimagingThumbnailDecodeResult,
  type WorkspaceBioimagingTileDecodeInput,
  type WorkspaceBioimagingTileDecodeResult
} from './contract.js'
import {
  annotateWorkspaceBioimagingRegion,
  createWorkspaceBioimagingPreview,
  decodeWorkspaceBioimagingThumbnail,
  decodeWorkspaceBioimagingTile,
  exportWorkspaceBioimagingRoiSet,
  selectWorkspaceBioimagingChannels,
  selectWorkspaceBioimagingRegion
} from './workspace-bioimaging-engine.js'

export class WorkspaceBioimagingService {
  preview(input: WorkspaceBioimagingPreviewInput): WorkspaceBioimagingPreviewResult {
    return createWorkspaceBioimagingPreview(workspaceBioimagingPreviewInputSchema.parse(input))
  }

  decodeTile(input: WorkspaceBioimagingTileDecodeInput): WorkspaceBioimagingTileDecodeResult {
    return decodeWorkspaceBioimagingTile(workspaceBioimagingTileDecodeInputSchema.parse(input))
  }

  decodeThumbnail(input: WorkspaceBioimagingThumbnailDecodeInput): WorkspaceBioimagingThumbnailDecodeResult {
    return decodeWorkspaceBioimagingThumbnail(workspaceBioimagingThumbnailDecodeInputSchema.parse(input))
  }

  selectRegion(input: WorkspaceBioimagingRegionSelectionInput): WorkspaceBioimagingRegionSelectionResult {
    return selectWorkspaceBioimagingRegion(workspaceBioimagingRegionSelectionInputSchema.parse(input))
  }

  selectChannels(input: WorkspaceBioimagingChannelSelectionInput): WorkspaceBioimagingChannelSelectionResult {
    return selectWorkspaceBioimagingChannels(workspaceBioimagingChannelSelectionInputSchema.parse(input))
  }

  annotateRegion(input: WorkspaceBioimagingRegionAnnotationInput): WorkspaceBioimagingRegionAnnotationResult {
    return annotateWorkspaceBioimagingRegion(workspaceBioimagingRegionAnnotationInputSchema.parse(input))
  }

  exportRoiSet(input: WorkspaceBioimagingRoiSetExportInput): WorkspaceBioimagingRoiSetExportResult {
    return exportWorkspaceBioimagingRoiSet(workspaceBioimagingRoiSetExportInputSchema.parse(input))
  }
}

export function createWorkspaceBioimagingService(): WorkspaceBioimagingService {
  return new WorkspaceBioimagingService()
}
