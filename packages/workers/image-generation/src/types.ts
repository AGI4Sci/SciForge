export const IMAGE_GENERATION_MODES = [
  'text_to_image',
  'image_to_image',
  'variation'
] as const

export type ImageGenerationMode = typeof IMAGE_GENERATION_MODES[number]

export type ImageGenerationVisualRouting = {
  useImageGenerationWhen: readonly string[]
  useScientificPlottingWhen: readonly string[]
  modelSelectionHint: string
}

export const IMAGE_GENERATION_VISUAL_ROUTING = {
  useImageGenerationWhen: [
    'semantic visuals from long prose or paper excerpts',
    'creative or illustrative flowcharts, infographics, cover images, posters, diagrams, and concept art',
    'visual storytelling where the model should choose layout, icons, typography, and composition'
  ],
  useScientificPlottingWhen: [
    'structured numeric data charts',
    'publication plots with explicit table/matrix/series data',
    'compact controlled flowcharts only when nodes and edges are already explicit'
  ],
  modelSelectionHint: 'Use image_generation for prose-to-visual flowcharts/diagrams/infographics; use scientific_plotting only for structured data or explicit compact node-edge diagrams.'
} as const satisfies ImageGenerationVisualRouting

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
  placeholderId?: string
  assetPath?: string | null
  editable: boolean
  origin: 'generated_from_spec' | 'draft_background' | 'framework_component_asset'
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

export type ImageGenerationRecipe = {
  mode: ImageGenerationMode
  prompt: string
  model?: string
  negativePrompt?: string
  size: ImageSize
  stylePreset?: string
  referencePath?: string
  outputFormat?: ImageOutputFormat
  intent?: ImageDrawingIntent
  drawingBrief?: DrawingBrief
  diagramSpec?: FrameworkDiagramSpec
  frameworkDesignPlan?: FrameworkDesignPlan
  confirmation?: DrawingConfirmation
  promptProfile?: 'default' | 'flowchart-light-v1' | 'framework-spec-v1' | 'framework-layered-draft-v1'
}

export type ImageGenerationUsagePolicy = {
  role: 'visual_composition_base'
  deterministicOverlayRequired: boolean
  overlayToolchain: 'script_or_scientific_plotting'
  warning: string
}

export type ImageEditIntent = {
  mode: ImageEditMode
  sourcePath: string
  instruction: string
  maskPath?: string
  annotationShapeId?: string
  targetShapeId?: string
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
  visualRouting: ImageGenerationVisualRouting
  warnings: string[]
}

export type ImageGenerationPlanRequest = {
  workspaceRoot: string
  task: string
  drawingIntent?: ImageDrawingIntent
  modeHint?: ImageGenerationMode
  size?: Partial<ImageSize>
  stylePreset?: string
  referencePath?: string
  canvasId?: string
  threadId?: string
  insertToCanvas?: boolean
}

export type ImageGenerationPlanResult = {
  ok: true
  task: string
  recipe: ImageGenerationRecipe
  suggestedRenderTool: 'image_generation_render'
  suggestedReviewTool: 'image_generation_review'
  upstreamResearchWorkflow?: {
    recommended: boolean
    reason: string
    suggestedBriefTool: 'scientific_plotting_research_brief'
    suggestedSearchTool: 'research_search'
    promptRequirements: string[]
  }
  visualRouting: ImageGenerationVisualRouting
  artifactPolicy: string
  canvasWorkflow: string[]
  requiresConfirmation?: boolean
  confirmationSummary?: string
  warnings: string[]
}

export type ImageGenerationRenderRequest = {
  workspaceRoot: string
  recipe: ImageGenerationRecipe
  imageId?: string
  outputDir?: string
  reviewReferencePath?: string
  canvasId?: string
  threadId?: string
  insertToCanvas?: boolean
}

export type ImageGenerationRenderResult =
  | {
      ok: true
      status: 'rendered' | 'rendered_placeholder' | 'review_failed'
      workspaceRoot: string
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      diagramSpecPath?: string
      frameworkDesignPlanPath?: string
      diagramLayerManifestPath?: string
      provider: ImageGenerationProvider
      review?: ImageGenerationReviewResult
      usagePolicy?: ImageGenerationUsagePolicy
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'research_required' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      upstreamResearchWorkflow?: ImageGenerationPlanResult['upstreamResearchWorkflow']
      warnings?: string[]
    }

export type ImageGenerationReviewRequest = {
  workspaceRoot: string
  outputPath: string
  referencePath?: string
  minOverall?: number
}

export type ImageGenerationSimilarityScore = {
  overall: number
  dimensions: number
  nonEmpty: number
  background: number
  reference?: number
  warnings: string[]
}

export type ImageGenerationReviewResult =
  | {
      ok: true
      score: ImageGenerationSimilarityScore
      repairable: boolean
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'image_unreadable' | 'reference_unreadable'
      message: string
      warnings?: string[]
    }

export type ImageGenerationEditFromCanvasPacketRequest = {
  workspaceRoot: string
  reviewPacketPath?: string
  reviewPacket?: unknown
  outputDir?: string
  imageId?: string
  canvasId?: string
  threadId?: string
}

export type ImageGenerationEditFromCanvasPacketResult =
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

export type ImageGenerationReviewPacketRequest = {
  workspaceRoot: string
  manifestPaths: string[]
  packetId?: string
  outputDir?: string
  title?: string
}

export type ImageGenerationReviewPacketResult =
  | {
      ok: true
      packetPath: string
      markdownPath: string
      count: number
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationManifest = {
  version: 1
  renderer: 'sciforge-image-generation-mcp'
  rendererVersion: string
  tool: 'image_generation_render' | 'image_generation_edit_from_canvas_packet'
  createdAt: string
  requestHash: string
  workspaceRoot: string
  outputPath: string
  canvasId?: string
  threadId?: string
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
  intent?: ImageDrawingIntent
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  promptProfile?: ImageGenerationRecipe['promptProfile']
  provider: ImageGenerationProvider
  review?: ImageGenerationReviewResult
  usagePolicy?: ImageGenerationUsagePolicy
  warnings: string[]
}
