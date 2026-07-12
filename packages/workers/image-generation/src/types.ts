export const IMAGE_GENERATION_MODES = [
  'text_to_image',
  'image_to_image',
  'variation'
] as const

export type ImageGenerationMode = typeof IMAGE_GENERATION_MODES[number]

export const IMAGE_EDIT_MODES = [
  'inpaint',
  'replace',
  'erase',
  'outpaint',
  'upscale',
  'style_transfer'
] as const

export type ImageEditMode = typeof IMAGE_EDIT_MODES[number]

export const IMAGE_OUTPUT_FORMATS = ['png', 'webp'] as const
export type ImageOutputFormat = typeof IMAGE_OUTPUT_FORMATS[number]

export type ImageSize = {
  width: number
  height: number
}

export const IMAGE_DRAWING_INTENTS = [
  'general_image',
  'flowchart',
  'framework_diagram'
] as const

export type ImageDrawingIntent = typeof IMAGE_DRAWING_INTENTS[number]

export type DrawingConfirmation = {
  status: 'required' | 'confirmed'
}

export type FlowchartDirection = 'left-to-right' | 'top-to-bottom'

export type DrawingBrief = {
  version: 1
  drawingType: 'flowchart'
  direction: FlowchartDirection
  steps: string[]
  arrows: string[]
  styleRules: string[]
  negativeRules: string[]
}

export type FrameworkDiagramType =
  | 'method_pipeline'
  | 'model_architecture'
  | 'training_inference'
  | 'multi_panel_method'
  | 'data_to_output_system'

export type DiagramLayerBounds = {
  x: number
  y: number
  w: number
  h: number
}

export type FrameworkDiagramSpec = {
  version: 1
  frameworkType: FrameworkDiagramType
  canvas: {
    aspect: 'wide' | 'very_wide' | 'square' | 'tall'
    flow: 'left-to-right' | 'top-to-bottom' | 'two-row' | 'multi-panel'
    density: 'light' | 'moderate' | 'dense'
    size: ImageSize
  }
  panels: Array<{
    id: string
    title: string
    role: string
    placement: string
    contents: string[]
  }>
  nodes: Array<{
    id: string
    label: string
    kind: 'input' | 'process' | 'model' | 'loss' | 'output' | 'data' | 'module'
    panelId?: string
    required: boolean
  }>
  edges: Array<{
    from: string
    to: string
    label?: string
    style: 'solid' | 'dashed' | 'feedback'
  }>
  callouts: Array<{
    title: string
    target?: string
    details: string[]
  }>
  styleRules: string[]
  negativeRules: string[]
  checklist: string[]
}

export type FrameworkRegionKind =
  | 'background'
  | 'panel'
  | 'module'
  | 'code_example'
  | 'real_example'
  | 'legend'
  | 'callout'
  | 'text'

export type FrameworkRegion = {
  id: string
  title: string
  kind: FrameworkRegionKind
  panelId?: string
  purpose: string
  bbox: DiagramLayerBounds
  placeholderId: string
  assetPolicy: 'none' | 'generate' | 'crop'
  prompt: string
  editable: boolean
  sourceSpecRef?: string
}

export type FrameworkRegionAssetPolicy = 'none' | 'generate' | 'crop'

export type FrameworkRegionAsset = {
  regionId: string
  placeholderId: string
  assetPath: string
  prompt: string
  bbox: DiagramLayerBounds
  provider: ImageGenerationRuntimeProvider | 'local'
}

export type FrameworkComponentType =
  | 'panel'
  | 'module'
  | 'text'
  | 'arrow'
  | 'legend'
  | 'thumbnail'
  | 'token_stack'
  | 'table'
  | 'code'
  | 'chart'
  | 'group'
  | 'text_label'
  | 'color_block'
  | 'material_image'
  | 'connector_arrow'
  | 'formula_symbol'
  | 'shape_component'
  | 'visual_component'

export type FrameworkComponentRole = 'primary' | 'secondary' | 'debug'

export type FrameworkComponentBlockType =
  | 'panel'
  | 'module'
  | 'legend'
  | 'material_group'
  | 'workflow_group'
  | 'component_group'

export type FrameworkSemanticLayer =
  | 'text'
  | 'color'
  | 'arrow'
  | 'material'
  | 'formula'
  | 'shape'
  | 'mixed'

export type FrameworkComponentLayer = {
  componentId: string
  layerId: string
  type: FrameworkComponentType
  title: string
  bbox: DiagramLayerBounds
  pixelBbox: DiagramLayerBounds
  assetPath: string
  transparentAssetPath: string
  role: FrameworkComponentRole
  qualityScore: number
  semanticLayer?: FrameworkSemanticLayer
  parentComponentId?: string
  parentBlockId?: string
  children?: string[]
  anchors?: Array<{ id: string; x: number; y: number }>
  sourceRegionId?: string
  sourceSpecRef?: string
  placeholderId?: string
  sourcePrompt?: string
  reusableTemplateId?: string
  detectionMethod:
    | 'image2_model_layer_segmentation'
    | 'component_segmentation'
    | 'fastsam_boxlib_segmentation'
    | 'layer_first_segmentation'
    | 'local_connected_components'
    | 'local_visual_subcomponent'
    | 'semantic_layer_detection'
    | 'spec_region_fallback'
  confidence: number
}

export type FrameworkComponentBlock = {
  blockId: string
  title: string
  blockType: FrameworkComponentBlockType
  bbox: DiagramLayerBounds
  pixelBbox: DiagramLayerBounds
  role: FrameworkComponentRole
  sourceRegionId?: string
  sourceComponentId?: string
  sourceSpecRef?: string
  placeholderId?: string
  childComponentIds: string[]
  semanticLayers: Exclude<FrameworkSemanticLayer, 'mixed'>[]
  detectionMethods: FrameworkComponentLayer['detectionMethod'][]
  reusableTemplateId?: string
  confidence: number
}

export type FrameworkSemanticLayerImage = {
  semanticLayer: Exclude<FrameworkSemanticLayer, 'mixed'>
  assetPath: string
  previewPath: string
  pixelCount: number
  coverage: number
  detectionMethod: 'image2_model_component_mask' | 'fastsam_component_mask' | 'layer_first_component_mask' | 'layer_first_pixel_mask'
}

export type FrameworkFastSamSegmentationComponent = {
  componentId: string
  title: string
  semanticLayer: Exclude<FrameworkSemanticLayer, 'mixed'>
  type: FrameworkComponentType
  bbox: DiagramLayerBounds
  pixelBbox: DiagramLayerBounds
  role: FrameworkComponentRole
  confidence: number
  label?: string
  prompt?: string
}

export type FrameworkFastSamSegmentation = {
  version: 1
  kind: 'sciforge_framework_component_segmentation' | 'sciforge_framework_fastsam_segmentation'
  createdAt: string
  sourceImagePath: string
  outputDir: string
  boxlibPath?: string
  samedPath?: string
  canvasSize: ImageSize
  imageSize: ImageSize
  prompts: string[]
  components: FrameworkFastSamSegmentationComponent[]
  blocks?: Array<{
    blockId: string
    title: string
    blockType: FrameworkComponentBlockType
    bbox: DiagramLayerBounds
    pixelBbox: DiagramLayerBounds
    childSegmentIds: string[]
    semanticLayers: Exclude<FrameworkSemanticLayer, 'mixed'>[]
    sourceRegionId?: string
    sourceSpecRef?: string
    placeholderId?: string
    confidence: number
  }>
  warnings: string[]
}

export type FrameworkComponentManifest = {
  version: 1
  kind: 'sciforge_framework_components'
  createdAt: string
  sourceImagePath: string
  componentBasePath: string
  componentDir: string
  modelLayerSegmentationPath?: string
  componentSegmentationPath?: string
  fastSamSegmentationPath?: string
  fastSamBoxlibPath?: string
  componentSegmentationPreviewPath?: string
  fastSamPreviewPath?: string
  semanticLayerDir?: string
  semanticLayerImages?: FrameworkSemanticLayerImage[]
  canvasSize: ImageSize
  blocks?: FrameworkComponentBlock[]
  components: FrameworkComponentLayer[]
  warnings: string[]
}

export type FrameworkDesignPlan = {
  version: 1
  kind: 'sciforge_framework_design_plan'
  canvas: FrameworkDiagramSpec['canvas']
  layoutSummary: string
  panels: FrameworkDiagramSpec['panels']
  regions: FrameworkRegion[]
  arrowStrategy: string
  textStrategy: string
  styleStrategy: string
  confirmationSummary: string
  checklist: string[]
}

export type DiagramLayerType =
  | 'panel'
  | 'shape'
  | 'node'
  | 'text'
  | 'edge'
  | 'callout'
  | 'group'
  | 'image'

export type DiagramLayer = {
  id: string
  type: DiagramLayerType
  label?: string
  bbox?: DiagramLayerBounds
  zIndex: number
  style?: Record<string, string | number | boolean>
  sourceSpecRef?: string
  regionId?: string
  sourcePrompt?: string
  sourceCaption?: string
  componentId?: string
  componentType?: FrameworkComponentType
  componentRole?: FrameworkComponentRole
  componentQualityScore?: number
  semanticLayer?: FrameworkSemanticLayer
  parentComponentId?: string
  parentBlockId?: string
  reusableTemplateId?: string
  placeholderId?: string
  assetPath?: string | null
  cropPath?: string | null
  boxlibRef?: string
  editable: boolean
  origin:
    | 'generated_from_spec'
    | 'recovered_from_png'
    | 'draft_background'
    | 'generated_region_asset'
    | 'local_region_analysis'
    | 'full_draft_base'
    | 'full_draft_crop'
    | 'framework_component_base'
    | 'framework_component_asset'
  confidence?: number
  from?: string
  to?: string
}

export type DiagramLayerManifest = {
  version: 1
  kind: 'sciforge_diagram_layers'
  createdAt: string
  source: {
    intent: ImageDrawingIntent
    promptProfile?: ImageGenerationRecipe['promptProfile']
    diagramSpecPath?: string
    frameworkDesignPlanPath?: string
    previewPath: string
    componentSegmentationPath?: string | null
    fastSamSegmentationPath?: string | null
    fastSamBoxlibPath?: string | null
    componentSegmentationPreviewPath?: string | null
    fastSamPreviewPath?: string | null
    frameworkComponentManifestPath?: string | null
    componentBasePath?: string | null
    componentAssetPaths?: string[]
  }
  canvas: {
    width: number
    height: number
    background: string
    layout: string
  }
  layers: DiagramLayer[]
}

export type ImageGenerationProvider = 'image-endpoint' | 'placeholder' | 'controlled-edit'
export type ImageGenerationRuntimeProvider = 'image-endpoint' | 'placeholder'

export type ScientificImagePolishDeltaPlan = {
  mode: 'delta_only'
  targetPanels?: Array<{
    assetId: string
    reason?: string
    allowedOperations?: string[]
  }>
  allowedOperations: string[]
  lockedFacts: string[]
  handoffPrompt: string
}

export type ImageGenerationRecipe = {
  mode: ImageGenerationMode
  prompt: string
  negativePrompt?: string
  size: ImageSize
  stylePreset?: string
  referencePath?: string
  outputFormat?: ImageOutputFormat
  intent?: ImageDrawingIntent
  drawingBrief?: DrawingBrief
  diagramSpec?: FrameworkDiagramSpec
  frameworkDesignPlan?: FrameworkDesignPlan
  frameworkRegionAssetMode?: 'disabled' | 'generate'
  confirmation?: DrawingConfirmation
  promptProfile?: 'default' | 'flowchart-light-v1' | 'framework-spec-v1' | 'framework-layered-draft-v1'
  scientificPolishDeltaPlan?: ScientificImagePolishDeltaPlan
  controlledSubfigureManifests?: string[]
  scientificVisualPlan?: ScientificVisualPlanHandoff
  creativeDirect?: true
}

export type ImageGenerationUsagePolicy = {
  role: 'visual_composition_base'
  deterministicOverlayRequired: boolean
  overlayToolchain: 'script_or_scientific_plotting'
  warning: string
  lockedFacts?: string[]
  sourceControlledArtifacts?: string[]
}

export type ImageEditIntent = {
  mode: ImageEditMode
  sourcePath: string
  instruction: string
  maskPath?: string
  annotationIds?: string[]
  targetNodeIds?: string[]
  preserve?: Array<'composition' | 'identity' | 'text' | 'layout' | 'palette'>
  outputFormat?: ImageOutputFormat
}

export type ImageGenerationStatus = {
  ok: true
  provider: ImageGenerationRuntimeProvider
  configured: boolean
  defaultModel: string
  supportedModes: ImageGenerationMode[]
  supportedEditModes: ImageEditMode[]
  outputDir: string
  artifactDir: string
  componentSegmentation: {
    provider: 'external-runner' | 'local-fallback'
    runnerConfigured: boolean
    modelConfigured: boolean
    runnerEnv: string
    modelEnv: string
    legacyRunnerEnv?: string
    legacyModelEnv?: string
  }
  warnings: string[]
}

export type ScientificVisualPlanHandoff = {
  route: 'generative_visual' | 'hybrid_composite'
  routeLocked: true
  rationale: string
  reproducibleInputs: string[]
  truthLockedElements: string[]
  fallbackPolicy: 'fail_closed'
}

export type ImageGenerationPlanRequest = {
  workspaceRoot: string
  task: string
  drawingIntent?: ImageDrawingIntent
  modeHint?: ImageGenerationMode
  size?: Partial<ImageSize>
  stylePreset?: string
  referencePath?: string
  scientificVisualPlan?: ScientificVisualPlanHandoff
  creativeDirect?: true
}

export type ImageGenerationPlanResult =
  | {
      ok: true
      task: string
      recipe: ImageGenerationRecipe
      suggestedRenderTool: 'image_generation_render'
      suggestedReviewTool: 'visual_artifact_review'
      upstreamResearchWorkflow?: {
        recommended: boolean
        reason: string
        suggestedBriefTool: 'scientific_plotting_research_brief'
        suggestedSearchTool: 'research_search'
        promptRequirements: string[]
      }
      scientificVisualPlan?: ScientificVisualPlanHandoff
      artifactPolicy: string
      visualReviewWorkflow: string[]
      requiresConfirmation?: boolean
      confirmationSummary?: string
      warnings: string[]
    }
  | {
      ok: false
      status: 'scientific_visual_plan_required' | 'invalid_scientific_visual_plan'
      message: string
      suggestedPlanTool: 'scientific_visual_plan'
      warnings: string[]
    }

export type ImageGenerationRenderRequest = {
  workspaceRoot: string
  recipe: ImageGenerationRecipe
  imageId?: string
  outputDir?: string
  visualDocumentId?: string
  threadId?: string
  stageForVisualReview?: boolean
}

export type ImageGenerationRenderResult =
  | {
      ok: true
      status: 'awaiting_review' | 'rendered_placeholder'
      workspaceRoot: string
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      diagramSpecPath?: string
      frameworkDesignPlanPath?: string
      diagramLayerManifestPath?: string
      fastSamSegmentationPath?: string
      fastSamBoxlibPath?: string
      fastSamPreviewPath?: string
      frameworkComponentManifestPath?: string
      componentBasePath?: string
      componentAssetPaths?: string[]
      provider: ImageGenerationProvider
      usagePolicy?: ImageGenerationUsagePolicy
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'research_required' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      upstreamResearchWorkflow?: Extract<ImageGenerationPlanResult, { ok: true }>['upstreamResearchWorkflow']
      warnings?: string[]
    }

export type VisualArtifactReviewRequest = {
  workspaceRoot: string
  outputPath: string
  task: string
  truthLockedElements: string[]
  referencePath?: string
  minOverall?: number
}

export type VisualArtifactReviewScore = {
  overall: number
  dimensions: number
  nonEmpty: number
  background: number
  reference?: number
  semantic: number
  warnings: string[]
}

export type VisualArtifactReviewResult =
  | {
      ok: true
      reviewedArtifactPath: string
      reviewedArtifactHash: string
      reviewedAt: string
      score: VisualArtifactReviewScore
      semantic: {
        pass: boolean
        summary: string
        violations: string[]
        repairInstructions: string[]
      }
      repairable: boolean
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'image_unreadable' | 'reference_unreadable' | 'vision_review_unavailable' | 'vision_review_invalid'
      message: string
      warnings?: string[]
    }

export type ImageGenerationEditFromVisualReviewPacketRequest = {
  workspaceRoot: string
  reviewPacketPath?: string
  reviewPacket?: unknown
  outputDir?: string
  imageId?: string
  threadId?: string
}

export type ImageGenerationEditFromVisualReviewPacketResult =
  | {
      ok: true
      status: 'edited' | 'edited_placeholder'
      intents: ImageEditIntent[]
      outputs: Array<{
        workspaceRoot: string
        outputPath: string
        manifestPath: string
        artifactManifestPath: string
        provider: ImageGenerationProvider
      }>
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_packet' | 'no_edit_targets' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationSegmentComponentsRequest = {
  workspaceRoot: string
  sourceImagePath: string
  frameworkDesignPlanPath?: string
  outputDir?: string
  imageId?: string
}

export type ImageGenerationSegmentComponentsResult =
  | {
      ok: true
      status: 'segmented'
      workspaceRoot: string
      sourceImagePath: string
      componentSegmentationPath: string
      fastSamSegmentationPath: string
      componentSegmentationPreviewPath: string
      fastSamPreviewPath: string
      frameworkComponentManifestPath: string
      componentBasePath: string
      componentAssetPaths: string[]
      componentCount: number
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'image_unreadable' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type FrameworkLocalizedEditTargetKind = 'component' | 'block' | 'selection'

export type FrameworkLocalizedEditTarget = {
  kind: FrameworkLocalizedEditTargetKind
  id: string
  title: string
  bbox: DiagramLayerBounds
  componentIds: string[]
  blockIds?: string[]
  semanticLayers: FrameworkSemanticLayer[]
}

export type FrameworkLocalizedEditRequest = {
  workspaceRoot: string
  componentManifestPath: string
  instruction: string
  componentIds?: string[]
  blockIds?: string[]
  outputDir?: string
  imageId?: string
  visualDocumentId?: string
  threadId?: string
  padding?: number
  editCanvasSize?: number
  stageForVisualReview?: boolean
}

export type FrameworkLocalizedEditResult =
  | {
      ok: true
      status: 'edited' | 'edited_placeholder'
      workspaceRoot: string
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      componentManifestPath: string
      sourceImagePath: string
      target: FrameworkLocalizedEditTarget
      paddedTarget: DiagramLayerBounds
      targetCropPath: string
      editInputPath: string
      editOutputPath: string
      editedRegionPath: string
      contactSheetPath: string
      provider: ImageGenerationProvider
      routerModelAlias?: string
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationManifest = {
  version: 1
  renderer: 'sciforge-image-generation-mcp'
  rendererVersion: string
  tool: 'image_generation_render' | 'image_generation_edit_from_visual_review_packet' | 'image_generation_segment_components' | 'image_generation_edit_components'
  createdAt: string
  requestHash: string
  workspaceRoot: string
  outputPath: string
  visualDocumentId?: string
  threadId?: string
  stageForVisualReview?: boolean
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
  intent?: ImageDrawingIntent
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  fastSamSegmentationPath?: string
  fastSamBoxlibPath?: string
  fastSamPreviewPath?: string
  frameworkComponentManifestPath?: string
  componentBasePath?: string
  componentAssetPaths?: string[]
  promptProfile?: ImageGenerationRecipe['promptProfile']
  scientificPolishDeltaPlan?: ScientificImagePolishDeltaPlan
  controlledSubfigureManifests?: string[]
  lockedFacts?: string[]
  sourceControlledArtifacts?: string[]
  provider: ImageGenerationProvider
  usagePolicy?: ImageGenerationUsagePolicy
  warnings: string[]
}
