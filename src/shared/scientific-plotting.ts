import type { FigureStyleReviewResult, FigureStyleSimilarityScore, FigureStyleSpec } from './figure-style'

export const SCIENTIFIC_PLOTTING_TEMPLATES = [
  'line',
  'scatter',
  'bar',
  'errorbar-bar',
  'heatmap',
  'attention-map',
  'box-violin',
  'histogram-density',
  'multi-panel',
  'schematic-grid'
] as const

export type ScientificPlottingTemplate = typeof SCIENTIFIC_PLOTTING_TEMPLATES[number]

export type ScientificPlottingReferenceProfile = {
  kind: 'chart' | 'matrix' | 'schematic' | 'mixed' | 'unknown'
  recommendedTemplate: ScientificPlottingTemplate
  confidence: number
  detectedTraits?: {
    aspect: 'wide' | 'tall' | 'balanced'
    background: 'light' | 'dark' | 'mid'
    axes: 'measured' | 'minimal' | 'none' | 'unknown'
    grid: 'none' | 'light' | 'medium'
    markDensity: 'sparse' | 'balanced' | 'dense'
    colorMode: FigureStyleSpec['palette']['colorMode']
    panelGrid: string
    textSignals: ScientificPlottingTemplate[]
  }
  reasons: string[]
  risks: string[]
}

export type ScientificPlottingTemplateAdvice = {
  selectedTemplate: ScientificPlottingTemplate
  referenceRecommendedTemplate?: ScientificPlottingTemplate
  compatible: boolean
  severity: 'info' | 'warning'
  messages: string[]
  nextActions: string[]
}

export type ScientificPlottingLabels = {
  title?: string
  x?: string
  y?: string
  legend?: boolean
  panel?: string
}

export type ScientificPlottingAutoRepairOptions = {
  enabled?: boolean
  maxAttempts?: 0 | 1
  minOverall?: number
}

export type ScientificPlottingStyleProfile = {
  id: string
  name: string
  venue: string
  sourceLabel: string
  description: string
  recommendedTemplates: ScientificPlottingTemplate[]
  tags: string[]
  styleSpec: FigureStyleSpec
  referenceProfile: ScientificPlottingReferenceProfile
  cautions: string[]
}

export type ScientificPlottingStyleProfileSummary = Omit<ScientificPlottingStyleProfile, 'styleSpec'> & {
  styleSpec?: FigureStyleSpec
}

export type ScientificPlottingStyleProfileMatch = {
  profileId: string
  profile: ScientificPlottingStyleProfileSummary
  score: number
  reasons: string[]
  cautions: string[]
}

export type ScientificPlottingStyleProfilesRequest = {
  workspaceRoot?: string
  profileId?: string
  query?: string
  referencePath?: string
  styleSpecPath?: string
  styleSpec?: FigureStyleSpec
  includeStyleSpec?: boolean
  topK?: number
}

export type ScientificPlottingStyleProfilesResult =
  | {
      ok: true
      status: 'listed' | 'found' | 'matched'
      profiles: ScientificPlottingStyleProfileSummary[]
      total: number
      selectedProfile?: ScientificPlottingStyleProfileSummary
      profileMatches?: ScientificPlottingStyleProfileMatch[]
      referenceProfile?: ScientificPlottingReferenceProfile
      recommendedNextTools: Array<
        | 'scientific_plotting_plan'
        | 'scientific_plotting_map_data'
        | 'scientific_plotting_render'
        | 'scientific_plotting_review'
      >
      warnings: string[]
    }
  | {
      ok: false
      status: 'not_found' | 'invalid_request'
      message: string
      availableProfileIds: string[]
      warnings: string[]
    }

export type ScientificPlottingCropBox = {
  unit?: 'ratio' | 'pixel'
  x: number
  y: number
  width: number
  height: number
}

export type ScientificPlottingPrepareReferenceRequest = {
  workspaceRoot: string
  sourcePath: string
  sourceType?: 'image' | 'pdf'
  page?: number
  cropBox?: ScientificPlottingCropBox
  figureId?: string
  outputDir?: string
  dpi?: number
  extractStyle?: boolean
}

export type ScientificPlottingReferenceManifest = {
  version: 1
  tool: 'scientific_plotting_prepare_reference'
  createdAt: string
  requestHash: string
  source: {
    path: string
    type: 'image' | 'pdf'
    page?: number
    width: number
    height: number
  }
  cropBox: ScientificPlottingCropBox & {
    unit: 'pixel'
  }
  croppedImagePath: string
  styleSpecPath?: string
  referenceProfile?: ScientificPlottingReferenceProfile
  styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
  recommendedStyleProfile?: ScientificPlottingStyleProfileSummary
  warnings: string[]
  nextWorkflow: {
    styleSpecPath?: string
    referencePath: string
    suggestedStyleProfileId?: string
    suggestedProfileTool: 'scientific_plotting_style_profiles'
    suggestedPlanTool: 'scientific_plotting_plan'
    suggestedRenderTool: 'scientific_plotting_render'
    suggestedReviewTool: 'scientific_plotting_review'
    guardrails: string[]
  }
}

export type ScientificPlottingPrepareReferenceResult =
  | {
      ok: true
      status: 'prepared'
      source: {
        path: string
        type: 'image' | 'pdf'
        page?: number
        width: number
        height: number
      }
      cropBox: ScientificPlottingCropBox & {
        unit: 'pixel'
      }
      croppedImagePath: string
      styleSpecPath?: string
      referenceManifestPath: string
      referenceManifest: ScientificPlottingReferenceManifest
      styleSpec?: FigureStyleSpec
      referenceProfile?: ScientificPlottingReferenceProfile
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      recommendedStyleProfile?: ScientificPlottingStyleProfileSummary
      warnings: string[]
    }
  | {
      ok: false
      status:
        | 'invalid_request'
        | 'invalid_workspace'
        | 'unsupported_source'
        | 'pdf_renderer_unavailable'
        | 'crop_failed'
      message: string
      stdoutTail?: string
      stderrTail?: string
      warnings?: string[]
    }

export type ScientificPlottingRenderRequest = {
  workspaceRoot: string
  template: ScientificPlottingTemplate
  data: unknown
  labels?: ScientificPlottingLabels
  figureId?: string
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
  reviewReferencePath?: string
  outputDir?: string
  autoRepair?: ScientificPlottingAutoRepairOptions
}

export type ScientificPlottingPlanRequest = {
  workspaceRoot?: string
  task: string
  templateHint?: ScientificPlottingTemplate
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
}

export type ScientificPlottingDataMappingRequest = {
  workspaceRoot: string
  task: string
  data: unknown
  labels?: ScientificPlottingLabels
  templateHint?: ScientificPlottingTemplate
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
  reviewReferencePath?: string
  figureId?: string
  outputDir?: string
  autoRepair?: ScientificPlottingAutoRepairOptions
}

export type ScientificPlottingDataMappingResult =
  | {
      ok: true
      status: 'mapped'
      selectedTemplate: ScientificPlottingTemplate
      confidence: number
      renderRequest: ScientificPlottingRenderRequest
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      dataSummary: {
        inputShape: 'template-ready' | 'tabular' | 'matrix' | 'vector' | 'multi-panel' | 'network' | 'unknown'
        rowCount?: number
        columnCount?: number
        numericColumns?: string[]
        categoricalColumns?: string[]
        seriesCount?: number
        groupCount?: number
        pointCount?: number
        matrixShape?: [number, number]
      }
      mappingBasis: {
        taskSignals: ScientificPlottingTemplate[]
        dataSignals: ScientificPlottingTemplate[]
        selectedBy: 'templateHint' | 'dataShape' | 'task' | 'referenceProfile'
        reasons: string[]
      }
      alternatives: Array<{
        template: ScientificPlottingTemplate
        confidence: number
        reason: string
      }>
      warnings: string[]
      guardrails: string[]
    }
  | {
      ok: false
      status: 'needs_clarification' | 'invalid_request' | 'invalid_workspace'
      message: string
      missingInputs: string[]
      warnings: string[]
    }

export type ScientificPlottingPlanResult =
  | {
      ok: true
      recommendedTemplate: ScientificPlottingTemplate
      reason: string
      supportedTemplates: ScientificPlottingTemplate[]
      referenceProfile?: ScientificPlottingReferenceProfile
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      templateAlternatives: Array<{
        template: ScientificPlottingTemplate
        reason: string
      }>
      requiredInputs: string[]
      styleInputs: string[]
      controlledTool: string
      planningWarnings: string[]
      guardrails: string[]
      skillHints: {
        recommendedSkills: string[]
        recommendedLibraries: string[]
      }
    }
  | { ok: false; message: string }

export type ScientificPlottingStatusResult =
  | {
      ok: true
      serverName: 'scientific_plotting'
      version: string
      renderer: {
        kind: 'matplotlib'
        pythonCommand: string
        available: boolean
        version?: string
        message?: string
      }
      referencePreparation: {
        imageCrop: true
        pdfCrop: {
          available: boolean
          command: string
          message?: string
        }
        defaultRelativeDir: '.sciforge/figure-references'
      }
      reviewPackets: {
        defaultRelativeDir: '.sciforge/figure-reviews'
        readsRenderManifests: true
        writesMarkdownAndJson: true
      }
      styleProfiles: {
        builtIn: number
        acceptsStyleProfileId: true
        defaultProfileIds: string[]
      }
      supportedTemplates: ScientificPlottingTemplate[]
      outputPolicy: {
        defaultRelativeDir: string
        writesOnlyInsideWorkspace: true
        formats: ['png']
      }
      degraded: boolean
      guardrails: string[]
    }
  | { ok: false; message: string }

export type ScientificPlottingReviewRequest = {
  workspaceRoot: string
  referencePath: string
  outputPath: string
  template?: ScientificPlottingTemplate
  minOverall?: number
}

export type ScientificPlottingReviewResult =
  | (Extract<FigureStyleReviewResult, { ok: true }> & {
      template?: ScientificPlottingTemplate
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
    })
  | Extract<FigureStyleReviewResult, { ok: false }>

export type ScientificPlottingReviewPacketRequest = {
  workspaceRoot: string
  manifestPaths: string[]
  packetId?: string
  outputDir?: string
  title?: string
  maxItems?: number
}

export type ScientificPlottingReviewPacketItem = {
  manifestPath: string
  outputPath: string
  template: ScientificPlottingTemplate
  status: 'rendered' | 'repaired' | 'review_failed' | 'unknown'
  createdAt?: string
  score?: FigureStyleSimilarityScore
  reviewStatus?: 'pass' | 'repairable' | 'manual_review'
  repairAttempted: boolean
  attempts: number
  warnings: string[]
  layoutQuality?: NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>['layoutQuality']
  typography?: NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>['typography']
  notes: string[]
  recommendedActions: string[]
}

export type ScientificPlottingReviewPacket = {
  version: 1
  tool: 'scientific_plotting_review_packet'
  createdAt: string
  title: string
  itemCount: number
  items: ScientificPlottingReviewPacketItem[]
  summary: {
    rendered: number
    repaired: number
    reviewFailed: number
    needsAttention: number
    pass: number
    repairable: number
    manualReview: number
    bestOverall?: number
    worstOverall?: number
    averageOverall?: number
    warnings: string[]
  }
  guardrails: string[]
}

export type ScientificPlottingReviewPacketResult =
  | {
      ok: true
      status: 'created'
      packetPath: string
      packetJsonPath: string
      packet: ScientificPlottingReviewPacket
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_request' | 'invalid_workspace' | 'manifest_read_failed'
      message: string
      warnings?: string[]
    }

export type ScientificPlottingAttempt = {
  attempt: number
  outputPath: string
  repaired: boolean
  review?: ScientificPlottingReviewResult
  rcParamsPatch?: Record<string, string | number | boolean>
  rendererDiagnostics?: {
    legendPlacement?: 'inside' | 'outside-right' | 'none'
    categoryLabelRotation?: number
    savefigPadInches?: number
    multiPanelCount?: number
    typography?: {
      titleSize: number
      labelSize: number
      tickSize: number
      legendSize: number
      panelSize: number
      publicationClampApplied: boolean
    }
    layoutQuality?: {
      legendItemCount: number
      legendColumnCount: number
      legendOutsidePlot: boolean
      legendOverlapRisk: 'none' | 'low' | 'medium' | 'high'
      textOverflowRisk: 'none' | 'low' | 'medium' | 'high'
      panelLabelAdjusted: boolean
      warnings: string[]
    }
    layoutNotes: string[]
  }
  warnings: string[]
}

export type ScientificPlottingManifest = {
  version: 1
  renderer: 'sciforge-scientific-plotting-mcp'
  rendererVersion: string
  tool: 'scientific_plotting_render'
  template: ScientificPlottingTemplate
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      createdAt: string
  requestHash: string
  outputPath: string
  styleSpecPath?: string
  referencePath?: string
  attempts: ScientificPlottingAttempt[]
  finalReview?: FigureStyleReviewResult
  warnings: string[]
}

export type ScientificPlottingRenderResult =
  | {
      ok: true
      status: 'rendered' | 'repaired' | 'review_failed'
      outputPath: string
      manifestPath: string
      attempts: ScientificPlottingAttempt[]
      review?: ScientificPlottingReviewResult
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      warnings: string[]
    }
  | {
      ok: false
      status:
        | 'invalid_request'
        | 'invalid_workspace'
        | 'renderer_unavailable'
        | 'render_failed'
        | 'review_failed'
      message: string
      stdoutTail?: string
      stderrTail?: string
      warnings?: string[]
    }

export type ScientificPlottingStyleTransferReferenceInput = {
  sourcePath?: string
  referencePath?: string
  sourceType?: 'image' | 'pdf'
  page?: number
  cropBox?: ScientificPlottingCropBox
  figureId?: string
  dpi?: number
}

export type ScientificPlottingStyleTransferRequest = {
  workspaceRoot: string
  task: string
  data: unknown
  labels?: ScientificPlottingLabels
  templateHint?: ScientificPlottingTemplate
  reference?: ScientificPlottingStyleTransferReferenceInput
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  figureId?: string
  outputDir?: string
  autoRepair?: ScientificPlottingAutoRepairOptions
  createReviewPacket?: boolean
}

export type ScientificPlottingStyleTransferManifest = {
  version: 2
  tool: 'scientific_plotting_style_transfer'
  createdAt: string
  requestHash: string
  task: string
  referenceImagePath?: string
  styleSpecPath?: string
  selectedTemplate?: ScientificPlottingTemplate
  selectedStyleProfileId?: string
  outputPath?: string
  renderManifestPath?: string
  reviewStatus?: 'pass' | 'repairable' | 'manual_review'
  reviewScore?: FigureStyleSimilarityScore
  reviewPacketPath?: string
  reviewPacketJsonPath?: string
  warnings: string[]
  guardrails: string[]
}

export type ScientificPlottingStyleTransferResult =
  | {
      ok: true
      status: 'completed' | 'rendered' | 'review_failed'
      referenceImagePath?: string
      preparedReference?: Extract<ScientificPlottingPrepareReferenceResult, { ok: true }>
      styleProfiles?: ScientificPlottingStyleProfilesResult
      plan: ScientificPlottingPlanResult
      mapping: ScientificPlottingDataMappingResult
      render: ScientificPlottingRenderResult
      reviewPacket?: ScientificPlottingReviewPacketResult
      outputPath?: string
      renderManifestPath?: string
      styleTransferManifestPath: string
      styleTransferManifest: ScientificPlottingStyleTransferManifest
      warnings: string[]
    }
  | {
      ok: false
      status:
        | 'invalid_request'
        | 'invalid_workspace'
        | 'reference_failed'
        | 'mapping_failed'
        | 'render_failed'
        | 'review_packet_failed'
      message: string
      preparedReference?: ScientificPlottingPrepareReferenceResult
      styleProfiles?: ScientificPlottingStyleProfilesResult
      plan?: ScientificPlottingPlanResult
      mapping?: ScientificPlottingDataMappingResult
      render?: ScientificPlottingRenderResult
      reviewPacket?: ScientificPlottingReviewPacketResult
      warnings?: string[]
    }
