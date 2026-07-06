import type { FigureStyleSimilarityScore } from '../../scientific-plotting/src/types'

export const SCIFORGE_CANVAS_ARTIFACT_KINDS = [
  'image',
  'generated_image',
  'edited_image',
  'scientific_plot',
  'ppt_slide',
  'ppt_export'
] as const

export type SciforgeCanvasArtifactKind = typeof SCIFORGE_CANVAS_ARTIFACT_KINDS[number]

export type SciforgeCanvasPlacement = 'right' | 'left' | 'below'

export type SciforgeCanvasEngine = 'drawio' | 'tldraw'

export type SciforgeCanvasDrawioSnapshot = {
  engine: 'drawio'
  diagramXml: string
  diagramPath?: string
  legacySnapshotPath?: string
  updatedAt?: string
}

export type SciforgeCanvasBounds = {
  x: number
  y: number
  w: number
  h: number
}

export type SciforgeCanvasAssetSummary = {
  id: string
  type?: string
  name?: string
  src?: string
  w?: number
  h?: number
  mimeType?: string
  fileSize?: number
}

export type SciforgeCanvasSelectedShape = {
  id: string
  type?: string
  parentId?: string
  x?: number
  y?: number
  rotation?: number
  meta?: Record<string, unknown>
  props?: Record<string, unknown>
  asset?: SciforgeCanvasAssetSummary | null
  bounds?: SciforgeCanvasBounds | null
  isAiImageHolder?: boolean
}

export type SciforgeCanvasSelectionState = {
  selectedShapes: SciforgeCanvasSelectedShape[]
  updatedAt?: string | null
}

export type SciforgeCanvasArtifactMetadata = {
  artifactKind: SciforgeCanvasArtifactKind
  workspaceRoot?: string
  outputPath?: string
  sourcePath?: string
  previewPath?: string
  renderedPagePath?: string
  renderedFromPptxPath?: string
  renderedSlideIndex?: number
  manifestPath?: string
  styleSpecPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  reviewScore?: FigureStyleSimilarityScore
  referencePath?: string
  projectPath?: string
  svgPath?: string
  pptxPath?: string
  slideIndex?: number
  title?: string
  caption?: string
  sourceTool?: string
  reviewPacketPath?: string
}

export type SciforgeCanvasOpenRequest = {
  workspaceRoot: string
  canvasId?: string
}

export type SciforgeCanvasOpenResult =
  | {
      ok: true
      status: 'created' | 'opened'
      workspaceRoot: string
      canvasId: string
      canvasDir: string
      canvasPath: string
      engine?: SciforgeCanvasEngine
      drawioPath?: string
      assetsDir: string
      selectionPath: string
      snapshot: unknown
      selection: SciforgeCanvasSelectionState
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_snapshot' | 'invalid_request'
      message: string
      warnings?: string[]
    }

export type SciforgeCanvasSaveRequest = {
  workspaceRoot: string
  canvasId?: string
  snapshot: unknown
}

export type SciforgeCanvasSaveResult =
  | {
      ok: true
      status: 'saved'
      canvasId: string
      canvasPath: string
      engine?: SciforgeCanvasEngine
      drawioPath?: string
      updatedAt: string
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_snapshot' | 'invalid_request'
      message: string
    }

export type SciforgeCanvasSelectionSaveRequest = {
  workspaceRoot: string
  canvasId?: string
  selection: SciforgeCanvasSelectionState
}

export type SciforgeCanvasInsertArtifactRequest = {
  workspaceRoot: string
  canvasId?: string
  artifactKind: SciforgeCanvasArtifactKind
  sourcePath?: string
  outputPath?: string
  previewPath?: string
  renderedPagePath?: string
  renderedFromPptxPath?: string
  renderedSlideIndex?: number
  manifestPath?: string
  styleSpecPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  referencePath?: string
  projectPath?: string
  svgPath?: string
  pptxPath?: string
  slideIndex?: number
  title?: string
  caption?: string
  sourceTool?: string
  reviewScore?: FigureStyleSimilarityScore
  reviewPacketPath?: string
  anchorShapeId?: string
  placement?: SciforgeCanvasPlacement
  margin?: number
  matchAnchor?: boolean
  displayWidth?: number
  displayHeight?: number
  altText?: string
  fileName?: string
  annotationScreenshot?: string
  shapeMeta?: Record<string, unknown>
  assetMeta?: Record<string, unknown>
  dryRun?: boolean
}

export type SciforgeCanvasInsertArtifactResult =
  | {
      ok: true
      status: 'planned' | 'inserted'
      canvasId: string
      canvasDir: string
      canvasPath: string
      assetFile?: string
      assetId?: string
      shapeId: string
      pageId: string
      parentId: string
      bounds: SciforgeCanvasBounds
      artifact: SciforgeCanvasArtifactMetadata
      warnings: string[]
      dryRun: boolean
    }
  | {
      ok: false
      status:
        | 'invalid_workspace'
        | 'invalid_request'
        | 'artifact_not_found'
        | 'unsupported_artifact'
        | 'canvas_write_failed'
      message: string
      warnings?: string[]
    }

export type SciforgeCanvasStatusResult =
  | {
      ok: true
      serverName: 'sciforge_canvas'
      version: string
      workspaceRoot?: string
      defaultRelativeDir: '.sciforge/canvases'
      canvasEngine?: SciforgeCanvasEngine
      supportedArtifactKinds: SciforgeCanvasArtifactKind[]
      cowartCompatibility: {
        aiImageHolderMeta: 'cowartAiImageHolder'
        annotationArrowMeta: 'cowartAnnotationArrow'
        annotationEditMeta: 'cowartGeneratedFromAnnotationEdit'
        sourceShapeMeta: 'cowartAnnotationSourceShapeId'
        annotationScreenshotMeta: 'cowartAnnotationScreenshot'
      }
      guardrails: string[]
      pptRendering?: {
        svgSlidePreview: boolean
        pptxPreview: 'available' | 'unavailable'
        sofficePath?: string
        pdftoppmPath?: string
        qlmanagePath?: string
      }
    }
  | {
      ok: false
      message: string
    }

export type SciforgeCanvasReviewPacketRequest = {
  workspaceRoot: string
  canvasId?: string
  packetId?: string
  title?: string
}

export type SciforgeCanvasReviewPacketArtifact = SciforgeCanvasArtifactMetadata & {
  shapeId: string
  bounds?: SciforgeCanvasBounds | null
}

export type SciforgeCanvasReviewPacketAnnotation = {
  shapeId: string
  annotationKind?: 'arrow' | 'box'
  bounds?: SciforgeCanvasBounds | null
  text?: string
  color?: string
  sourceShapeId?: string
}

export type SciforgeCanvasReviewPacketModificationSuggestion = {
  annotationShapeId?: string
  targetShapeId?: string
  artifactKind?: SciforgeCanvasArtifactKind
  slideIndex?: number
  instruction: string
  nextControlledTool: string
  status: 'draft'
  safety: string
}

export type SciforgeCanvasReviewPacket = {
  version: 1
  tool: 'sciforge_canvas_export_review_packet'
  createdAt: string
  canvasId: string
  threadId?: string
  title: string
  artifacts: SciforgeCanvasReviewPacketArtifact[]
  annotations: SciforgeCanvasReviewPacketAnnotation[]
  selectedShapes: SciforgeCanvasSelectedShape[]
  modificationSuggestions: SciforgeCanvasReviewPacketModificationSuggestion[]
  adjustmentRequests: Array<{
    artifactKind: SciforgeCanvasArtifactKind
    shapeId: string
    nextControlledTool: string
    reason: string
  }>
  guardrails: string[]
}

export type SciforgeCanvasReviewPacketResult =
  | {
      ok: true
      status: 'created'
      canvasId: string
      packetPath: string
      packet: SciforgeCanvasReviewPacket
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'canvas_read_failed'
      message: string
      warnings?: string[]
    }

export type SciforgeCanvasRecentArtifact = {
  path: string
  relativePath: string
  artifactKind: SciforgeCanvasArtifactKind
  title: string
  size: number
  mtimeMs: number
  sourceTool?: string
  manifestPath?: string
  outputPath?: string
  sourcePath?: string
  previewPath?: string
  styleSpecPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  referencePath?: string
  projectPath?: string
  svgPath?: string
  pptxPath?: string
  slideIndex?: number
  caption?: string
  reviewScore?: FigureStyleSimilarityScore
  canvasId?: string
  threadId?: string
  alreadyOnCanvas?: boolean
}

export type SciforgeCanvasImportRecentArtifactsRequest = {
  workspaceRoot: string
  canvasId?: string
  scope?: 'current_canvas' | 'workspace_recent'
  maxAgeMs?: number
  limit?: number
  includeExisting?: boolean
  dryRun?: boolean
}

export type SciforgeCanvasImportedArtifact = {
  artifact: SciforgeCanvasRecentArtifact
  result: Extract<SciforgeCanvasInsertArtifactResult, { ok: true }>
}

export type SciforgeCanvasImportRecentArtifactsResult =
  | {
      ok: true
      status: 'imported' | 'planned' | 'empty'
      canvasId: string
      canvasPath: string
      scanned: number
      imported: number
      skipped: number
      artifacts: SciforgeCanvasRecentArtifact[]
      inserted: SciforgeCanvasImportedArtifact[]
      warnings: string[]
      dryRun: boolean
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'scan_failed' | 'canvas_write_failed' | 'invalid_request'
      message: string
      warnings?: string[]
    }

export type SciforgeArtifactManifest = {
  version: 1
  kind: 'sciforge_artifact'
  createdAt: string
  sourceTool: 'scientific_plotting' | 'image_generation' | 'ppt_master' | 'workspace_artifact_import' | string
  artifactKind: SciforgeCanvasArtifactKind
  path: string
  outputPath?: string
  sourcePath?: string
  previewPath?: string
  manifestPath?: string
  styleSpecPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  referencePath?: string
  projectPath?: string
  svgPath?: string
  pptxPath?: string
  slideIndex?: number
  title?: string
  caption?: string
  reviewScore?: FigureStyleSimilarityScore
  canvasId?: string
  threadId?: string
}
