import { createCanvas, loadImage } from '@napi-rs/canvas'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  DiagramLayer,
  DiagramLayerBounds,
  DiagramLayerManifest,
  DrawingBrief,
  FrameworkComponentBlock,
  FrameworkComponentBlockType,
  FrameworkComponentLayer,
  FrameworkComponentManifest,
  FrameworkComponentRole,
  FrameworkComponentType,
  FrameworkDesignPlan,
  FrameworkDiagramSpec,
  FrameworkFastSamSegmentation,
  FrameworkFastSamSegmentationComponent,
  FrameworkLocalizedEditRequest,
  FrameworkLocalizedEditResult,
  FrameworkLocalizedEditTarget,
  FrameworkRegion,
  FrameworkSemanticLayer,
  ImageEditIntent,
  ImageEditRegion,
  ImageDrawingIntent,
  ImageGenerationEditFromVisualReviewPacketRequest,
  ImageGenerationEditFromVisualReviewPacketResult,
  ImageGenerationManifest,
  ImageGenerationPlanRequest,
  ImageGenerationPlanResult,
  ImageGenerationProvider,
  ImageGenerationRecipe,
  ImageGenerationRenderRequest,
  ImageGenerationRenderResult,
  ImageGenerationSegmentComponentsRequest,
  ImageGenerationSegmentComponentsResult,
  VisualArtifactReviewRequest,
  VisualArtifactReviewResult,
  ImageGenerationStatus,
  ImageSize
} from './types'

const RENDERER_VERSION = '0.1.0'
const DEFAULT_MODEL_ROUTER_ALIAS = 'sciforge-router'
const COMPONENT_SEGMENTATION_RUNNER_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_RUNNER'
const COMPONENT_SEGMENTATION_MODEL_ENV = 'SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH'
const FASTSAM_RUNNER_ENV = 'SCIFORGE_FASTSAM_RUNNER'
const FASTSAM_MODEL_ENV = 'SCIFORGE_FASTSAM_MODEL_PATH'
const COMPONENT_SEGMENTATION_PROTOCOL_ARG = '--sciforge-component-json'
const FASTSAM_SEGMENTATION_PROTOCOL_ARG = '--sciforge-fastsam-json'
const COMPONENT_SEGMENTATION_RUNNER_TIMEOUT_MS = 60_000
const DEFAULT_SIZE: ImageSize = { width: 1024, height: 1024 }
const MAX_IMAGE_SIZE = 4096
const MIN_IMAGE_SIZE = 128
const IMAGE_SIZE_GRANULARITY = 16
const EDIT_MASK_CONTEXT_FRACTION = 0.04
const EDIT_MASK_MIN_CONTEXT_PIXELS = 16
const EDIT_MASK_MAX_CONTEXT_PIXELS = 128
const PROTECTED_PIXEL_MAX_CHANNEL_DELTA = 24
const PROTECTED_PIXEL_MEAN_CHANNEL_DELTA = 10
const MAX_PROTECTED_REGION_DRIFT_FRACTION = 0.02
const ARTIFACT_DIR = '.sciforge/artifacts'
const IMAGE_DIR = '.sciforge/images'
const LOCAL_MODEL_ROUTER_BASE_URL_ERROR =
  'SCIFORGE_MODEL_ROUTER_BASE_URL must point to the local SciForge Model Router (http://127.0.0.1:<port>/v1, http://localhost:<port>/v1, or http://[::1]:<port>/v1).'
type ProviderRenderInput = {
  workspaceRoot: string
  outputPath: string
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
}

type JsonRecord = Record<string, unknown>

type ProviderRenderResult = {
  provider: ImageGenerationProvider
  placeholder: boolean
  warnings: string[]
}

export async function getImageGenerationStatus(workspaceRoot?: string): Promise<ImageGenerationStatus> {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  const warnings: string[] = []
  const provider = providerKindForReadOnly(warnings)
  const segmentation = componentSegmentationRunnerConfig()
  return {
    ok: true,
    provider,
    configured: provider === 'image-endpoint',
    defaultModel: modelRouterAlias(),
    supportedModes: ['text_to_image', 'image_to_image', 'variation'],
    supportedEditModes: ['inpaint', 'replace', 'erase', 'outpaint', 'upscale', 'style_transfer'],
    outputDir: root ? join(root, IMAGE_DIR) : IMAGE_DIR,
    artifactDir: root ? join(root, ARTIFACT_DIR) : ARTIFACT_DIR,
    componentSegmentation: {
      provider: segmentation.runner && segmentation.model ? 'external-runner' : 'local-fallback',
      runnerConfigured: Boolean(segmentation.runner),
      modelConfigured: Boolean(segmentation.model),
      runnerEnv: COMPONENT_SEGMENTATION_RUNNER_ENV,
      modelEnv: COMPONENT_SEGMENTATION_MODEL_ENV,
      legacyRunnerEnv: FASTSAM_RUNNER_ENV,
      legacyModelEnv: FASTSAM_MODEL_ENV
    },
    warnings: [
      ...(provider === 'placeholder'
        ? ['No image model is configured. Other SciForge features are unaffected, but text-to-image and visual-review image edits require configuring an image model first.']
        : []),
      ...warnings
    ]
  }
}

export async function planImageGeneration(request: ImageGenerationPlanRequest): Promise<ImageGenerationPlanResult> {
  const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
  const warnings: string[] = []
  if (providerKindForReadOnly(warnings) === 'placeholder' && !allowPlaceholderProvider()) {
    warnings.push('Image model is not configured; rendering will return provider_not_configured until an image model is configured in Settings.')
  }
  if (!request.visualPlan) {
    return {
      ok: false,
      status: 'visual_plan_required',
      message: 'Image preparation requires the terminal handoff returned by visual_generate.',
      suggestedPlanTool: 'visual_generate',
      warnings
    }
  }
  const visualPlanError = validateImageVisualPlan(request.visualPlan)
  if (visualPlanError) {
    return {
      ok: false,
      status: 'invalid_visual_plan',
      message: visualPlanError,
      suggestedPlanTool: 'visual_generate',
      warnings
    }
  }
  const size = normalizeSize(request.size, warnings)
  const task = request.task.trim()
  const intent = request.drawingIntent ?? classifyDrawingIntent(task, request.stylePreset)
  const drawingBrief = intent === 'flowchart' ? buildFlowchartBrief(task) : undefined
  const diagramSpec = intent === 'framework_diagram' ? buildFrameworkDiagramSpec(task, size) : undefined
  const frameworkDesignPlan = diagramSpec ? buildFrameworkDesignPlan(task, diagramSpec) : undefined
  const rawPrompt = diagramSpec
    ? compileFrameworkDiagramPrompt(task, diagramSpec)
    : drawingBrief
      ? compileFlowchartPrompt(task, drawingBrief)
      : task
  const prompt = enhanceImageGenerationPrompt(rawPrompt, request.stylePreset)
  const recipe: ImageGenerationRecipe = {
    mode: request.modeHint ?? (request.referencePath ? 'image_to_image' : 'text_to_image'),
    prompt,
    size,
    ...(request.stylePreset?.trim() ? { stylePreset: request.stylePreset.trim() } : {}),
    ...(request.referencePath?.trim() ? { referencePath: request.referencePath.trim() } : {}),
    outputFormat: 'png',
    intent,
    ...(drawingBrief ? { drawingBrief, promptProfile: 'flowchart-light-v1' as const } : {}),
    ...(diagramSpec
      ? {
          diagramSpec,
          frameworkDesignPlan,
          confirmation: { status: 'required' as const },
          promptProfile: 'framework-layered-draft-v1' as const
        }
      : {}),
    visualPlan: request.visualPlan
  }
  if (request.visualPlan.releaseCeiling === 'draft_ready') {
    warnings.push('Context acquisition stopped before all required questions were resolved; this artifact can only become draft_ready after review.')
  }
  if (request.visualPlan.route === 'hybrid') {
    warnings.push('Hybrid ownership is locked: the image model may render only modelOwnedElements; deterministic composition owns lockedElements.')
  }
  void workspaceRoot
  return {
    ok: true,
    task,
    recipe,
    suggestedRenderTool: 'image_generation_render',
    suggestedReviewTool: 'visual_artifact_review',
    visualPlan: request.visualPlan,
    artifactPolicy: request.visualPlan.releaseCeiling === 'draft_ready'
        ? 'Render writes a draft-only PNG plus .sciforge/artifacts/*.generated-image.artifact.json for mandatory VisualDocument review.'
        : 'Render writes PNG output plus .sciforge/artifacts/*.generated-image.artifact.json for VisualDocument review.',
    visualReviewWorkflow: [
      'Run image_generation_render with the planned recipe.',
      'Stage the generated artifact in its VisualDocument.',
      'Use visual-review annotations for non-destructive edits.',
      'Run image_generation_edit_from_visual_review_packet to create a new before/after candidate.',
      ...(request.visualPlan.route === 'hybrid' ? ['Composite lockedElements over the model-owned visual layer with the deterministic composition stage.'] : [])
    ],
    requiresConfirmation: Boolean(frameworkDesignPlan),
    ...(frameworkDesignPlan ? { confirmationSummary: frameworkDesignPlan.confirmationSummary } : {}),
    warnings
  }
}

export async function renderImageGeneration(request: ImageGenerationRenderRequest): Promise<ImageGenerationRenderResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const visualPlanError = validateImageVisualPlan(request.recipe?.visualPlan)
    if (visualPlanError) {
      return {
        ok: false,
        status: 'invalid_request',
        message: visualPlanError,
        warnings: ['Call visual_generate and pass its terminal model or hybrid handoff unchanged.']
      }
    }
    const recipe = normalizeRecipe(request.recipe, warnings)
    if (recipe.visualPlan.releaseCeiling === 'draft_ready') {
      warnings.push('Rendering a context-limited draft; unified visual review cannot promote it beyond draft_ready.')
    }
    if (recipe.intent === 'framework_diagram' && recipe.confirmation?.status !== 'confirmed') {
      return {
        ok: false,
        status: 'invalid_request',
        message: "Framework diagram rendering requires confirmation.status === 'confirmed'.",
        warnings
      }
    }
    const imageId = slugForId(request.imageId ?? 'generated-image-' + new Date().toISOString())
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const outputPath = join(outputDir, imageId + '.' + (recipe.outputFormat ?? 'png'))
    const providerResult = await renderWithProvider({ workspaceRoot, outputPath, recipe })
    warnings.push(...providerResult.warnings)
    const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
    const manifestPath = join(outputDir, imageId + '.manifest.json')
    const diagramSpecPath = recipe.intent === 'framework_diagram' && recipe.diagramSpec
      ? join(outputDir, imageId + '.diagram-spec.json')
      : undefined
    const frameworkDesignPlanPath = recipe.intent === 'framework_diagram' && recipe.frameworkDesignPlan
      ? join(outputDir, imageId + '.framework-design-plan.json')
      : undefined
    if (diagramSpecPath && recipe.diagramSpec) {
      await writeJson(diagramSpecPath, {
        version: 1,
        kind: 'sciforge_framework_diagram_spec',
        createdAt: new Date().toISOString(),
        promptProfile: recipe.promptProfile ?? 'framework-spec-v1',
        workspaceRoot,
        outputPath,
        spec: recipe.diagramSpec
      })
    }
    if (frameworkDesignPlanPath && recipe.frameworkDesignPlan) {
      await writeJson(frameworkDesignPlanPath, {
        ...recipe.frameworkDesignPlan,
        createdAt: new Date().toISOString(),
        workspaceRoot,
        outputPath
      })
    }
    const componentArtifacts = await writeFrameworkComponentArtifactsIfNeeded({
      workspaceRoot,
      outputDir,
      imageId,
      outputPath,
      recipe,
      frameworkDesignPlanPath,
      warnings
    })
    const diagramLayerManifestPath = await writeDiagramLayerManifestIfNeeded({
      workspaceRoot,
      outputDir,
      imageId,
      outputPath,
      recipe,
      diagramSpecPath,
      frameworkDesignPlanPath,
      componentManifest: componentArtifacts?.componentManifest
    })
    const manifest: ImageGenerationManifest = {
      version: 1,
      renderer: 'sciforge-image-generation-mcp',
      rendererVersion: RENDERER_VERSION,
      tool: 'image_generation_render',
      createdAt: new Date().toISOString(),
      requestHash: hashValue({ recipe }),
      workspaceRoot,
      outputPath,
      outputHash,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.stageForVisualReview !== undefined ? { stageForVisualReview: request.stageForVisualReview } : {}),
      recipe,
      ...(recipe.intent ? { intent: recipe.intent } : {}),
      ...(diagramSpecPath ? { diagramSpecPath } : {}),
      ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
      ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
      ...(componentArtifacts?.componentSegmentationPath ? { componentSegmentationPath: componentArtifacts.componentSegmentationPath } : {}),
      ...(componentArtifacts?.fastSamSegmentationPath ? { fastSamSegmentationPath: componentArtifacts.fastSamSegmentationPath } : {}),
      ...(componentArtifacts?.fastSamBoxlibPath ? { fastSamBoxlibPath: componentArtifacts.fastSamBoxlibPath } : {}),
      ...(componentArtifacts?.componentSegmentationPreviewPath ? { componentSegmentationPreviewPath: componentArtifacts.componentSegmentationPreviewPath } : {}),
      ...(componentArtifacts?.fastSamPreviewPath ? { fastSamPreviewPath: componentArtifacts.fastSamPreviewPath } : {}),
      ...(componentArtifacts?.frameworkComponentManifestPath ? { frameworkComponentManifestPath: componentArtifacts.frameworkComponentManifestPath } : {}),
      ...(componentArtifacts?.componentBasePath ? { componentBasePath: componentArtifacts.componentBasePath } : {}),
      ...(componentArtifacts?.componentAssetPaths?.length ? { componentAssetPaths: componentArtifacts.componentAssetPaths } : {}),
      ...(recipe.promptProfile ? { promptProfile: recipe.promptProfile } : {}),
      visualPlan: recipe.visualPlan,
      provider: providerResult.provider,
      warnings
    }
    await writeJson(manifestPath, manifest)
    const artifactManifestPath = await writeImageArtifactManifest({
      workspaceRoot,
      artifactId: imageId,
      artifactKind: 'generated_image',
      sourceTool: 'image_generation',
      outputPath,
      outputHash,
      manifestPath,
      title: recipe.prompt.slice(0, 90) || imageId,
      referencePath: recipe.referencePath,
      intent: recipe.intent,
      diagramSpecPath,
      frameworkDesignPlanPath,
      diagramLayerManifestPath,
      componentSegmentationPath: componentArtifacts?.componentSegmentationPath,
      fastSamSegmentationPath: componentArtifacts?.fastSamSegmentationPath,
      fastSamBoxlibPath: componentArtifacts?.fastSamBoxlibPath,
      componentSegmentationPreviewPath: componentArtifacts?.componentSegmentationPreviewPath,
      fastSamPreviewPath: componentArtifacts?.fastSamPreviewPath,
      frameworkComponentManifestPath: componentArtifacts?.frameworkComponentManifestPath,
      componentBasePath: componentArtifacts?.componentBasePath,
      componentAssetPaths: componentArtifacts?.componentAssetPaths,
      promptProfile: recipe.promptProfile,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.stageForVisualReview !== undefined ? { stageForVisualReview: request.stageForVisualReview } : {}),
      visualPlan: recipe.visualPlan
    })
    return {
      ok: true,
      status: providerResult.placeholder ? 'rendered_placeholder' : 'awaiting_review',
      workspaceRoot,
      outputPath,
      outputHash,
      manifestPath,
      artifactManifestPath,
      ...(diagramSpecPath ? { diagramSpecPath } : {}),
      ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
      ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
      ...(componentArtifacts?.componentSegmentationPath ? { componentSegmentationPath: componentArtifacts.componentSegmentationPath } : {}),
      ...(componentArtifacts?.fastSamSegmentationPath ? { fastSamSegmentationPath: componentArtifacts.fastSamSegmentationPath } : {}),
      ...(componentArtifacts?.fastSamBoxlibPath ? { fastSamBoxlibPath: componentArtifacts.fastSamBoxlibPath } : {}),
      ...(componentArtifacts?.componentSegmentationPreviewPath ? { componentSegmentationPreviewPath: componentArtifacts.componentSegmentationPreviewPath } : {}),
      ...(componentArtifacts?.fastSamPreviewPath ? { fastSamPreviewPath: componentArtifacts.fastSamPreviewPath } : {}),
      ...(componentArtifacts?.frameworkComponentManifestPath ? { frameworkComponentManifestPath: componentArtifacts.frameworkComponentManifestPath } : {}),
      ...(componentArtifacts?.componentBasePath ? { componentBasePath: componentArtifacts.componentBasePath } : {}),
      ...(componentArtifacts?.componentAssetPaths?.length ? { componentAssetPaths: componentArtifacts.componentAssetPaths } : {}),
      provider: providerResult.provider,
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: renderErrorStatus(error),
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

function validateTerminalVisualPlan(plan: ImageGenerationRecipe['visualPlan'] | undefined): string | undefined {
  if (!plan) return 'A terminal visualPlan handoff from visual_generate is required.'
  if (!plan.planId?.trim()) return 'visualPlan.planId is required.'
  if (plan.routeLocked !== true || plan.fallbackPolicy !== 'fail_closed') {
    return 'visualPlan must be route-locked with fallbackPolicy=fail_closed.'
  }
  if (plan.route !== 'code' && plan.route !== 'model' && plan.route !== 'hybrid') {
    return `visualPlan.route is invalid: ${String(plan.route)}.`
  }
  if (plan.contextStatus === 'ready' && plan.releaseCeiling !== 'publication_ready') {
    return 'A ready visualPlan must have releaseCeiling=publication_ready.'
  }
  if (plan.contextStatus === 'budget_exhausted' && plan.releaseCeiling !== 'draft_ready') {
    return 'A budget-exhausted visualPlan must have releaseCeiling=draft_ready.'
  }
  if (plan.contextStatus !== 'ready' && plan.contextStatus !== 'budget_exhausted') {
    return 'visualPlan.contextStatus must be terminal: ready or budget_exhausted.'
  }
  if (!Array.isArray(plan.sourceArtifacts) || !Array.isArray(plan.reproducibleInputs)
    || !Array.isArray(plan.lockedElements) || !Array.isArray(plan.modelOwnedElements)
    || !Array.isArray(plan.contextEvidenceIds) || !Array.isArray(plan.unresolvedContext)) {
    return 'visualPlan ownership, source, and context fields must be arrays.'
  }
  return undefined
}

function validateImageVisualPlan(plan: ImageGenerationRecipe['visualPlan'] | undefined): string | undefined {
  const terminalError = validateTerminalVisualPlan(plan)
  if (terminalError) return terminalError
  if (plan!.route !== 'model' && plan!.route !== 'hybrid') {
    return `Image generation accepts only route=model or route=hybrid; received route=${plan!.route}.`
  }
  return undefined
}

function shouldEnhanceSemanticVisualPrompt(prompt: string): boolean {
  if (/SciForge semantic visual brief|full-canvas composition|最终视觉图|视觉增强要求/i.test(prompt)) return false
  return /flow\s*chart|flowchart|workflow|pipeline|diagram|architecture|mechanism|schematic|infographic|figure|model structure|流程图|流程|工作流|管线|示意图|机制图|模型结构|架构图|信息图|论文图|图形摘要/i.test(prompt)
}

function enhanceImageGenerationPrompt(prompt: string, stylePreset?: string): string {
  const base = prompt.trim()
  if (!shouldEnhanceSemanticVisualPrompt(base)) return base
  const style = stylePreset?.trim()
  return [
    base,
    '',
    'SciForge semantic visual brief:',
    '- Treat any upstream scientific_plotting or diagram draft as structure only; create the polished final visual, not a tiny box draft.',
    '- Use a full-canvas composition with clear hierarchy, large readable labels, grouped modules, directional arrows, and visual emphasis on the key scientific/technical relationships.',
    '- Prefer a publication-grade schematic style: clean typography, balanced spacing, subtle color coding, light background, and concise annotations.',
    '- Fill the canvas with meaningful content while preserving the requested scientific semantics; avoid sparse center-only layouts, overlapping labels, illegible microtext, and generic placeholder blocks.',
    '- For model architecture or workflow figures, show inputs, core stages, outputs, side effects/context, and feedback/control loops when relevant.',
    ...(style ? [`- Style preset: ${style}.`] : []),
    '- Output: one self-contained high-resolution PNG-style figure suitable for VisualDocument review.'
  ].join('\n')
}

function classifyDrawingIntent(task: string, stylePreset?: string): ImageDrawingIntent {
  const text = `${task}\n${stylePreset ?? ''}`.toLowerCase()
  if (/framework|architecture|model structure|method overview|encoder|decoder|transformer|resnet|diffusion|gnn|llm|架构|框架|模型结构|方法概览|机制图/.test(text)) {
    return 'framework_diagram'
  }
  if (/flow\s*chart|flowchart|workflow|pipeline|process|流程图|工作流|管线|步骤/.test(text)) {
    return 'flowchart'
  }
  return 'general_image'
}

function buildFlowchartBrief(task: string): DrawingBrief {
  const steps = extractCandidateSteps(task, 10)
  return {
    version: 1,
    drawingType: 'flowchart',
    direction: /top|vertical|纵向|自上而下/.test(task) ? 'top-to-bottom' : 'left-to-right',
    steps,
    arrows: steps.slice(0, -1).map((step, index) => `${step} -> ${steps[index + 1]}`),
    styleRules: [
      'Use a polished full-canvas flowchart layout instead of a sparse tiny box draft.',
      'Use readable labels, clear arrows, grouped stages, and balanced spacing.',
      'Use publication-style colors with a light background and concise annotations.'
    ],
    negativeRules: [
      'Do not make overlapping labels.',
      'Do not produce a center-only miniature diagram.',
      'Do not invent numerical data.'
    ]
  }
}

function compileFlowchartPrompt(task: string, brief: DrawingBrief): string {
  return [
    task,
    '',
    'SciForge DrawingBrief v1:',
    JSON.stringify(brief, null, 2),
    '',
    'Generate the final visual from this brief. The brief is a semantic scaffold, not a request for a tiny draft.'
  ].join('\n')
}

function buildFrameworkDiagramSpec(task: string, size: ImageSize): FrameworkDiagramSpec {
  const frameworkType = classifyFrameworkType(task)
  const panels = extractFrameworkPanels(task, frameworkType)
  const nodes = panels.flatMap((panel) =>
    panel.contents.map((label, index) => ({
      id: slugForId(`${panel.id}-${index + 1}`),
      label,
      kind: inferFrameworkNodeKind(label),
      panelId: panel.id,
      required: true
    }))
  )
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1].id,
    style: 'solid' as const
  }))
  return {
    version: 1,
    frameworkType,
    canvas: {
      aspect: size.width >= size.height * 1.45 ? 'very_wide' : size.width >= size.height ? 'wide' : 'tall',
      flow: panels.length > 2 ? 'multi-panel' : 'left-to-right',
      density: nodes.length > 14 ? 'dense' : nodes.length > 7 ? 'moderate' : 'light',
      size
    },
    panels,
    nodes,
    edges,
    callouts: [
      {
        title: 'Key mechanism',
        details: ['Highlight the main information path and the component that explains the requested analysis angle.']
      }
    ],
    styleRules: [
      'Paper-style framework figure with clear module grouping.',
      'Readable typography, concise labels, and directional arrows.',
      'Use color to separate conceptual regions, not decorative gradients.'
    ],
    negativeRules: [
      'Do not use illegible microtext.',
      'Do not collapse all modules into generic boxes.',
      'Do not alter scientific facts or data.'
    ],
    checklist: [
      'All required modules are visible.',
      'Inputs, core mechanism, and outputs are distinguishable.',
      'The figure can be refined through VisualDocument review using the structured layer metadata.'
    ]
  }
}

function buildFrameworkDesignPlan(task: string, spec: FrameworkDiagramSpec): FrameworkDesignPlan {
  const panelLayouts = layoutFrameworkPanels(spec)
  const regions: FrameworkRegion[] = panelLayouts.map(({ panel, bbox }, index) => ({
    id: `region-${panel.id}`,
    title: panel.title,
    kind: 'panel',
    panelId: panel.id,
    purpose: panel.role,
    bbox,
    placeholderId: `SF${String(index + 1).padStart(2, '0')}`,
    assetPolicy: 'none',
    prompt: panel.contents.join('; '),
    editable: true,
    sourceSpecRef: panel.id
  }))
  return {
    version: 1,
    kind: 'sciforge_framework_design_plan',
    canvas: spec.canvas,
    layoutSummary: `${spec.frameworkType} / ${spec.canvas.flow} / ${spec.canvas.density}`,
    panels: spec.panels,
    regions,
    arrowStrategy: 'Use directional arrows to show the main information flow and feedback where needed.',
    textStrategy: 'Keep labels short and large enough for a paper figure thumbnail.',
    styleStrategy: 'Use subdued scientific colors with one accent for the core mechanism.',
    confirmationSummary: [
      'Framework diagram plan:',
      `- Type: ${spec.frameworkType}`,
      `- Layout: ${spec.canvas.flow}`,
      `- Panels: ${spec.panels.map((panel) => panel.title).join(', ')}`,
      `- Required nodes: ${spec.nodes.map((node) => node.label).join(' -> ')}`,
      `- Source task: ${task.slice(0, 240)}`
    ].join('\n'),
    checklist: spec.checklist
  }
}

function compileFrameworkDiagramPrompt(task: string, spec: FrameworkDiagramSpec): string {
  return [
    task,
    '',
    'Draw a confirmed scientific framework diagram from FrameworkDiagramSpec v1.',
    'Use the spec as semantic ground truth. Produce one polished, full-canvas visual with editable sidecar layers.',
    '',
    'FrameworkDiagramSpec v1:',
    JSON.stringify(spec, null, 2)
  ].join('\n')
}

async function writeDiagramLayerManifestIfNeeded(input: {
  workspaceRoot: string
  outputDir: string
  imageId: string
  outputPath: string
  recipe: ImageGenerationRecipe
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  componentManifest?: FrameworkComponentManifest
}): Promise<string | undefined> {
  if (!input.recipe.intent || input.recipe.intent === 'general_image') return undefined
  const size = input.recipe.size
  const layers = input.recipe.diagramSpec
    ? compileFrameworkDiagramLayers(input.recipe.diagramSpec)
    : input.recipe.drawingBrief
      ? compileFlowchartLayers(input.recipe.drawingBrief, size)
      : []
  if (layers.length === 0) return undefined
  const manifest: DiagramLayerManifest = {
    version: 1,
    kind: 'sciforge_diagram_layers',
    createdAt: new Date().toISOString(),
    source: {
      intent: input.recipe.intent,
      ...(input.recipe.promptProfile ? { promptProfile: input.recipe.promptProfile } : {}),
      ...(input.diagramSpecPath ? { diagramSpecPath: input.diagramSpecPath } : {}),
      ...(input.frameworkDesignPlanPath ? { frameworkDesignPlanPath: input.frameworkDesignPlanPath } : {}),
      previewPath: input.outputPath,
      ...(input.componentManifest?.fastSamSegmentationPath ? { fastSamSegmentationPath: input.componentManifest.fastSamSegmentationPath } : {}),
      ...(input.componentManifest?.fastSamBoxlibPath ? { fastSamBoxlibPath: input.componentManifest.fastSamBoxlibPath } : {}),
      ...(input.componentManifest?.fastSamPreviewPath ? { fastSamPreviewPath: input.componentManifest.fastSamPreviewPath } : {}),
      ...(input.componentManifest ? { frameworkComponentManifestPath: join(input.outputDir, input.imageId + '.framework-components.json') } : {}),
      ...(input.componentManifest?.componentBasePath ? { componentBasePath: input.componentManifest.componentBasePath } : {}),
      ...(input.componentManifest?.components.length ? { componentAssetPaths: editableFrameworkComponents(input.componentManifest).map((component) => component.transparentAssetPath) } : {})
    },
    canvas: {
      width: size.width,
      height: size.height,
      background: '#ffffff',
      layout: input.recipe.diagramSpec?.canvas.flow ?? input.recipe.drawingBrief?.direction ?? 'freeform'
    },
    layers: [
      {
        id: 'preview-background',
        type: 'image',
        label: 'Full draft preview',
        bbox: { x: 0, y: 0, w: size.width, h: size.height },
        zIndex: 0,
        assetPath: input.outputPath,
        editable: false,
        origin: input.componentManifest ? 'framework_component_base' : 'draft_background',
        confidence: 1
      },
      ...componentLayersForDiagramManifest(input.componentManifest),
      ...layers
    ]
  }
  const manifestPath = join(input.outputDir, input.imageId + '.diagram-layers.json')
  await writeJson(manifestPath, manifest)
  return manifestPath
}

function compileFlowchartLayers(brief: DrawingBrief, size: ImageSize): DiagramLayer[] {
  const count = Math.max(1, brief.steps.length)
  const horizontal = brief.direction === 'left-to-right'
  const margin = 96
  const boxW = horizontal ? Math.min(220, (size.width - margin * 2) / count * 0.76) : Math.min(360, size.width - margin * 2)
  const boxH = 82
  const layers: DiagramLayer[] = []
  for (const [index, step] of brief.steps.entries()) {
    const x = horizontal
      ? margin + index * ((size.width - margin * 2) / count) + ((size.width - margin * 2) / count - boxW) / 2
      : (size.width - boxW) / 2
    const y = horizontal
      ? (size.height - boxH) / 2
      : margin + index * ((size.height - margin * 2) / count) + ((size.height - margin * 2) / count - boxH) / 2
    layers.push({
      id: `node-${index + 1}`,
      type: 'node',
      label: step,
      bbox: { x, y, w: boxW, h: boxH },
      zIndex: index + 1,
      editable: true,
      origin: 'generated_from_spec',
      confidence: 0.86
    })
    if (index > 0) {
      layers.push({
        id: `edge-${index}`,
        type: 'edge',
        from: `node-${index}`,
        to: `node-${index + 1}`,
        zIndex: 100 + index,
        editable: true,
        origin: 'generated_from_spec',
        confidence: 0.82
      })
    }
  }
  return layers
}

function compileFrameworkDiagramLayers(spec: FrameworkDiagramSpec): DiagramLayer[] {
  const layers: DiagramLayer[] = []
  for (const { panel, bbox } of layoutFrameworkPanels(spec)) {
    layers.push({
      id: `panel-${panel.id}`,
      type: 'panel',
      label: panel.title,
      bbox,
      zIndex: 1,
      sourceSpecRef: panel.id,
      editable: true,
      origin: 'generated_from_spec',
      confidence: 0.88
    })
    const panelNodes = spec.nodes.filter((node) => node.panelId === panel.id)
    panelNodes.forEach((node, index) => {
      const nodeW = Math.min(240, Math.max(120, bbox.w * 0.72))
      const nodeH = 58
      const x = bbox.x + (bbox.w - nodeW) / 2
      const y = bbox.y + 72 + index * Math.max(70, (bbox.h - 130) / Math.max(1, panelNodes.length))
      layers.push({
        id: node.id,
        type: 'node',
        label: node.label,
        bbox: { x, y, w: nodeW, h: nodeH },
        zIndex: 10 + index,
        sourceSpecRef: node.id,
        editable: true,
        origin: 'generated_from_spec',
        confidence: 0.84
      })
    })
  }
  spec.edges.forEach((edge, index) => {
    layers.push({
      id: `edge-${edge.from}-${edge.to}`,
      type: 'edge',
      label: edge.label,
      from: edge.from,
      to: edge.to,
      zIndex: 200 + index,
      editable: true,
      origin: 'generated_from_spec',
      confidence: 0.8
    })
  })
  spec.callouts.forEach((callout, index) => {
    layers.push({
      id: `callout-${index + 1}`,
      type: 'callout',
      label: `${callout.title}: ${callout.details.join('; ')}`,
      bbox: { x: 48, y: 48 + index * 82, w: Math.min(360, spec.canvas.size.width * 0.32), h: 64 },
      zIndex: 300 + index,
      editable: true,
      origin: 'generated_from_spec',
      confidence: 0.78
    })
  })
  return layers
}

function extractCandidateSteps(task: string, limit: number): string[] {
  const lines = task
    .split(/\n|[;；。]/)
    .map((line) => line.replace(/^\s*[-*•\d.)、]+/, '').trim())
    .filter((line) => line.length > 0)
  const arrowParts = task.split(/->|→|=>|⇒/).map((part) => part.trim()).filter(Boolean)
  const candidates = arrowParts.length >= 2 ? arrowParts : lines
  const cleaned = candidates
    .map((item) => item.replace(/\s+/g, ' ').slice(0, 90))
    .filter((item, index, array) => array.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)
  if (cleaned.length >= 2) return cleaned.slice(0, limit)
  return ['Input / context', 'Core method', 'Analysis / reasoning', 'Output / conclusion']
}

function classifyFrameworkType(task: string): FrameworkDiagramSpec['frameworkType'] {
  const text = task.toLowerCase()
  if (/train|inference|训练|推理/.test(text)) return 'training_inference'
  if (/architecture|encoder|decoder|transformer|resnet|model|模型|架构/.test(text)) return 'model_architecture'
  if (/multi[-\s]?panel|多\s*panel|多图|综合图/.test(text)) return 'multi_panel_method'
  if (/data|dataset|output|数据|输出/.test(text)) return 'data_to_output_system'
  return 'method_pipeline'
}

function extractFrameworkPanels(
  task: string,
  frameworkType: FrameworkDiagramSpec['frameworkType']
): FrameworkDiagramSpec['panels'] {
  const steps = extractCandidateSteps(task, 12)
  if (/encoder|decoder|transformer|attention|编码器|解码器|注意力/i.test(task)) {
    return [
      {
        id: 'encoder',
        title: 'Encoder / Input Path',
        role: 'Represent input embedding, positional encoding, attention blocks, and residual normalization.',
        placement: 'left',
        contents: ['Input embedding', 'Positional encoding', 'Self attention', 'Add & Norm', 'Feed forward']
      },
      {
        id: 'decoder',
        title: 'Decoder / Output Path',
        role: 'Represent shifted outputs, masked attention, cross attention, and probabilities.',
        placement: 'right',
        contents: ['Output embedding', 'Masked attention', 'Cross attention', 'Add & Norm', 'Linear', 'Softmax']
      }
    ]
  }
  if (frameworkType === 'training_inference') {
    return [
      { id: 'training', title: 'Training', role: 'Model optimization path.', placement: 'top', contents: steps.slice(0, Math.ceil(steps.length / 2)) },
      { id: 'inference', title: 'Inference', role: 'Deployment and prediction path.', placement: 'bottom', contents: steps.slice(Math.ceil(steps.length / 2)) }
    ]
  }
  const chunkSize = Math.max(2, Math.ceil(steps.length / 3))
  return [
    { id: 'input', title: 'Input', role: 'Input data, context, or problem setup.', placement: 'left', contents: steps.slice(0, chunkSize) },
    { id: 'method', title: 'Core Method', role: 'Central mechanism or model components.', placement: 'center', contents: steps.slice(chunkSize, chunkSize * 2) },
    { id: 'output', title: 'Output', role: 'Results, decision, or conclusion.', placement: 'right', contents: steps.slice(chunkSize * 2) }
  ].filter((panel) => panel.contents.length > 0)
}

function inferFrameworkNodeKind(label: string): FrameworkDiagramSpec['nodes'][number]['kind'] {
  const text = label.toLowerCase()
  if (/input|prompt|data|dataset|输入|数据/.test(text)) return 'input'
  if (/output|probabilit|result|class|输出|结果/.test(text)) return 'output'
  if (/loss|objective|损失|目标/.test(text)) return 'loss'
  if (/model|network|attention|encoder|decoder|transformer|resnet|模型|网络|注意力|编码|解码/.test(text)) return 'model'
  if (/module|block|layer|模块|层/.test(text)) return 'module'
  return 'process'
}

function layoutFrameworkPanels(spec: FrameworkDiagramSpec): Array<{ panel: FrameworkDiagramSpec['panels'][number]; bbox: DiagramLayerBounds }> {
  const panels = spec.panels.length ? spec.panels : extractFrameworkPanels('', spec.frameworkType)
  const { width, height } = spec.canvas.size
  const margin = 72
  const gap = 36
  if (spec.canvas.flow === 'top-to-bottom' || spec.canvas.flow === 'two-row') {
    const panelH = (height - margin * 2 - gap * (panels.length - 1)) / Math.max(1, panels.length)
    return panels.map((panel, index) => ({
      panel,
      bbox: {
        x: margin,
        y: margin + index * (panelH + gap),
        w: width - margin * 2,
        h: panelH
      }
    }))
  }
  const panelW = (width - margin * 2 - gap * (panels.length - 1)) / Math.max(1, panels.length)
  return panels.map((panel, index) => ({
    panel,
    bbox: {
      x: margin + index * (panelW + gap),
      y: margin,
      w: panelW,
      h: height - margin * 2
    }
  }))
}


type FrameworkComponentArtifacts = {
  componentManifest: FrameworkComponentManifest
  componentSegmentationPath: string
  fastSamSegmentationPath: string
  fastSamBoxlibPath?: string
  componentSegmentationPreviewPath: string
  fastSamPreviewPath: string
  frameworkComponentManifestPath: string
  componentBasePath: string
  componentAssetPaths: string[]
}

type LocalComponentCandidate = {
  id: string
  title: string
  semanticLayer: Exclude<FrameworkSemanticLayer, 'mixed'>
  type: FrameworkComponentType
  role: FrameworkComponentRole
  pixelBbox: DiagramLayerBounds
  pixels: number[]
  confidence: number
  detectionMethod?: string
}

type FastSamExtractionResult = {
  candidates: LocalComponentCandidate[]
  warnings: string[]
}

export async function segmentImageGenerationComponents(
  request: ImageGenerationSegmentComponentsRequest
): Promise<ImageGenerationSegmentComponentsResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const sourceImagePath = await resolveWorkspacePath(workspaceRoot, request.sourceImagePath)
    const imageId = slugForId(request.imageId ?? basename(sourceImagePath, extnameForPath(sourceImagePath)) + '-components')
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const designPlan = request.frameworkDesignPlanPath
      ? parseFrameworkDesignPlan(JSON.parse(await readFile(await resolveWorkspacePath(workspaceRoot, request.frameworkDesignPlanPath), 'utf8')) as unknown)
      : undefined
    const artifacts = await writeFrameworkComponentArtifacts({
      workspaceRoot,
      outputDir,
      imageId,
      sourceImagePath,
      designPlan,
      warnings
    })
    return {
      ok: true,
      status: 'segmented',
      workspaceRoot,
      sourceImagePath,
      componentSegmentationPath: artifacts.componentSegmentationPath,
      fastSamSegmentationPath: artifacts.fastSamSegmentationPath,
      componentSegmentationPreviewPath: artifacts.componentSegmentationPreviewPath,
      fastSamPreviewPath: artifacts.fastSamPreviewPath,
      frameworkComponentManifestPath: artifacts.frameworkComponentManifestPath,
      componentBasePath: artifacts.componentBasePath,
      componentAssetPaths: artifacts.componentAssetPaths,
      componentCount: artifacts.componentManifest.components.length,
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof WorkspaceError ? 'invalid_workspace' : 'write_failed',
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

export async function editFrameworkComponentsWithImage2(
  request: FrameworkLocalizedEditRequest
): Promise<FrameworkLocalizedEditResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const visualPlanError = validateImageVisualPlan(request.visualPlan)
    if (visualPlanError) {
      return { ok: false, status: 'invalid_request', message: visualPlanError, warnings }
    }
    const componentManifestPath = await resolveWorkspacePath(workspaceRoot, request.componentManifestPath)
    const manifest = parseFrameworkComponentManifest(JSON.parse(await readFile(componentManifestPath, 'utf8')) as unknown)
    const sourceImagePath = await resolveWorkspacePath(workspaceRoot, manifest.sourceImagePath)
    const selected = selectFrameworkComponents(manifest, request.componentIds, request.blockIds)
    if (selected.length === 0) throw new Error('No matching framework components were selected.')
    const source = await loadImage(sourceImagePath)
    const imageSize = { width: source.width, height: source.height }
    const target = frameworkEditTargetFromComponents(selected)
    const paddedTarget = padBounds(target.bbox, Math.max(0, request.padding ?? 18), imageSize)
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const imageId = slugForId(request.imageId ?? 'framework-component-edit-' + new Date().toISOString())
    const targetCropPath = join(outputDir, imageId + '.target-crop.png')
    const editInputPath = join(outputDir, imageId + '.edit-input.png')
    const editOutputPath = join(outputDir, imageId + '.edit-output.png')
    const editedRegionPath = join(outputDir, imageId + '.edited-region.png')
    const outputPath = join(outputDir, imageId + '.png')
    const contactSheetPath = join(outputDir, imageId + '.contact-sheet.png')

    await writeImageCrop(sourceImagePath, targetCropPath, paddedTarget)
    await writeImageCrop(sourceImagePath, editInputPath, paddedTarget)
    const editSize = normalizeSize({
      width: request.editCanvasSize ?? Math.max(256, Math.min(1024, Math.round(paddedTarget.w))),
      height: request.editCanvasSize ?? Math.max(256, Math.min(1024, Math.round(paddedTarget.h)))
    }, warnings)
    const editPrompt = [
      'Redraw the selected component(s) of a scientific framework figure as a clean replacement patch.',
      'Keep the same visual role, approximate layout, and scientific/technical meaning.',
      'Do not redraw unrelated surrounding modules.',
      '',
      'Selected components:',
      ...selected.map((component) => `- ${component.componentId}: ${component.title} [${component.semanticLayer ?? 'mixed'}]`),
      '',
      'User instruction:',
      request.instruction.trim()
    ].join('\n')
    const providerResult = await renderWithProvider({
      workspaceRoot,
      outputPath: editOutputPath,
      recipe: {
        mode: 'image_to_image',
        prompt: editPrompt,
        referencePath: editInputPath,
        size: editSize,
        outputFormat: 'png',
        intent: 'framework_diagram',
        promptProfile: 'framework-layered-draft-v1',
        visualPlan: request.visualPlan
      }
    })
    warnings.push(...providerResult.warnings)
    await recomposeEditedRegion({
      sourceImagePath,
      editOutputPath,
      outputPath,
      editedRegionPath,
      target: paddedTarget
    })
    await writeFrameworkEditContactSheet({
      sourceImagePath,
      targetCropPath,
      editOutputPath,
      outputPath,
      contactSheetPath
    })
    const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
    const manifestPath = join(outputDir, imageId + '.manifest.json')
    const manifestRecord: ImageGenerationManifest = {
      version: 1,
      renderer: 'sciforge-image-generation-mcp',
      rendererVersion: RENDERER_VERSION,
      tool: 'image_generation_edit_components',
      createdAt: new Date().toISOString(),
      requestHash: hashValue({ request, target }),
      workspaceRoot,
      outputPath,
      outputHash,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.stageForVisualReview !== undefined ? { stageForVisualReview: request.stageForVisualReview } : {}),
      editIntent: {
        mode: 'replace',
        sourcePath: sourceImagePath,
        instruction: request.instruction,
        preserve: ['layout', 'composition']
      },
      frameworkComponentManifestPath: componentManifestPath,
      componentBasePath: manifest.componentBasePath,
      componentAssetPaths: selected.map((component) => component.transparentAssetPath),
      visualPlan: request.visualPlan,
      provider: providerResult.provider,
      warnings
    }
    await writeJson(manifestPath, manifestRecord)
    const artifactManifestPath = await writeImageArtifactManifest({
      workspaceRoot,
      artifactId: imageId,
      artifactKind: 'edited_image',
      sourceTool: 'image_generation',
      outputPath,
      outputHash,
      manifestPath,
      sourcePath: sourceImagePath,
      frameworkComponentManifestPath: componentManifestPath,
      componentBasePath: manifest.componentBasePath,
      componentAssetPaths: selected.map((component) => component.transparentAssetPath),
      title: request.instruction.slice(0, 90) || imageId,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.stageForVisualReview !== undefined ? { stageForVisualReview: request.stageForVisualReview } : {}),
      visualPlan: request.visualPlan
    })
    return {
      ok: true,
      status: providerResult.placeholder ? 'edited_placeholder' : 'edited',
      workspaceRoot,
      outputPath,
      manifestPath,
      artifactManifestPath,
      componentManifestPath,
      sourceImagePath,
      target,
      paddedTarget,
      targetCropPath,
      editInputPath,
      editOutputPath,
      editedRegionPath,
      contactSheetPath,
      provider: providerResult.provider,
      routerModelAlias: modelRouterAlias(),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof WorkspaceError ? 'invalid_workspace' : error instanceof ProviderNotConfiguredError ? 'provider_not_configured' : error instanceof ProviderError ? 'provider_failed' : 'write_failed',
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

async function writeFrameworkComponentArtifactsIfNeeded(input: {
  workspaceRoot: string
  outputDir: string
  imageId: string
  outputPath: string
  recipe: ImageGenerationRecipe
  frameworkDesignPlanPath?: string
  warnings: string[]
}): Promise<FrameworkComponentArtifacts | undefined> {
  if (input.recipe.intent !== 'framework_diagram') return undefined
  return writeFrameworkComponentArtifacts({
    workspaceRoot: input.workspaceRoot,
    outputDir: input.outputDir,
    imageId: input.imageId,
    sourceImagePath: input.outputPath,
    designPlan: input.recipe.frameworkDesignPlan,
    warnings: input.warnings
  })
}

async function writeFrameworkComponentArtifacts(input: {
  workspaceRoot: string
  outputDir: string
  imageId: string
  sourceImagePath: string
  designPlan?: FrameworkDesignPlan
  warnings: string[]
}): Promise<FrameworkComponentArtifacts> {
  const source = await loadImage(input.sourceImagePath)
  const imageSize = { width: source.width, height: source.height }
  const basePath = join(input.outputDir, input.imageId)
  const componentDir = basePath + '.components'
  await mkdir(componentDir, { recursive: true })
  const componentSegmentationPath = basePath + '.component-segmentation.json'
  const componentSegmentationPreviewPath = basePath + '.component-segmentation-preview.png'
  const frameworkComponentManifestPath = basePath + '.framework-components.json'
  const componentBasePath = basePath + '.component-base.png'
  const semanticLayerDir = basePath + '.semantic-layers'
  const createdAt = new Date().toISOString()
  const segmentation = await extractComponentSegmentationComponents({
    sourceImagePath: input.sourceImagePath,
    imageSize,
    outputDir: componentDir
  })
  const usedExternalSegmentation = segmentation.candidates.length > 0
  const candidates = usedExternalSegmentation
    ? segmentation.candidates
    : await extractLocalSemanticComponents(input.sourceImagePath, imageSize, input.warnings)
  const components = await writeComponentAssets({
    sourceImagePath: input.sourceImagePath,
    componentDir,
    componentBasePath,
    imageSize,
    candidates
  })
  const blocks = buildFrameworkComponentBlocks({
    components,
    designPlan: input.designPlan,
    canvasSize: input.designPlan?.canvas.size ?? imageSize,
    imageSize
  })
  applyFrameworkComponentBlocks(components, blocks)
  const semanticLayerImages = await writeFrameworkSemanticLayerImages({
    sourceImagePath: input.sourceImagePath,
    semanticLayerDir,
    imageSize,
    components
  })
  const segmentationManifest: FrameworkFastSamSegmentation = {
    version: 1,
    kind: 'sciforge_framework_component_segmentation',
    createdAt,
    sourceImagePath: input.sourceImagePath,
    outputDir: componentDir,
    canvasSize: imageSize,
    imageSize,
    prompts: usedExternalSegmentation
      ? ['component-only', 'external-component-segmentation-runner']
      : ['component-only', 'semantic-layer-first', 'local-fallback'],
    components: components.map((component): FrameworkFastSamSegmentationComponent => ({
      componentId: component.componentId,
      title: component.title,
      semanticLayer: component.semanticLayer === 'mixed' || !component.semanticLayer ? 'shape' : component.semanticLayer,
      type: component.type,
      bbox: component.bbox,
      pixelBbox: component.pixelBbox,
      role: component.role,
      confidence: component.confidence
    })),
    ...(blocks.length
      ? {
          blocks: blocks.map((block) => ({
            blockId: block.blockId,
            title: block.title,
            blockType: block.blockType,
            bbox: block.bbox,
            pixelBbox: block.pixelBbox,
            childSegmentIds: block.childComponentIds,
            semanticLayers: block.semanticLayers,
            ...(block.sourceRegionId ? { sourceRegionId: block.sourceRegionId } : {}),
            ...(block.sourceSpecRef ? { sourceSpecRef: block.sourceSpecRef } : {}),
            ...(block.placeholderId ? { placeholderId: block.placeholderId } : {}),
            confidence: block.confidence
          }))
        }
      : {}),
    warnings: [
      ...segmentation.warnings,
      ...input.warnings
    ]
  }
  await writeJson(componentSegmentationPath, segmentationManifest)
  await writeFastSamPreview({
    sourceImagePath: input.sourceImagePath,
    outputPath: componentSegmentationPreviewPath,
    components
  })
  const manifest: FrameworkComponentManifest = {
    version: 1,
    kind: 'sciforge_framework_components',
    createdAt,
    sourceImagePath: input.sourceImagePath,
    componentBasePath,
    componentDir,
    componentSegmentationPath,
    fastSamSegmentationPath: componentSegmentationPath,
    componentSegmentationPreviewPath,
    fastSamPreviewPath: componentSegmentationPreviewPath,
    semanticLayerDir,
    semanticLayerImages,
    canvasSize: imageSize,
    ...(blocks.length ? { blocks } : {}),
    components,
    warnings: segmentationManifest.warnings
  }
  await writeJson(frameworkComponentManifestPath, manifest)
  return {
    componentManifest: manifest,
    componentSegmentationPath,
    fastSamSegmentationPath: componentSegmentationPath,
    componentSegmentationPreviewPath,
    fastSamPreviewPath: componentSegmentationPreviewPath,
    frameworkComponentManifestPath,
    componentBasePath,
    componentAssetPaths: editableFrameworkComponents(manifest).map((component) => component.transparentAssetPath)
  }
}

async function extractComponentSegmentationComponents(input: {
  sourceImagePath: string
  imageSize: ImageSize
  outputDir: string
}): Promise<FastSamExtractionResult> {
  const { runner, model, protocolArg } = componentSegmentationRunnerConfig()
  if (!runner || !model) {
    return {
      candidates: [],
      warnings: [`External component segmentation runner is not configured (${COMPONENT_SEGMENTATION_RUNNER_ENV}/${COMPONENT_SEGMENTATION_MODEL_ENV}); coarse local hitbox fallback was used.`]
    }
  }

  const request = {
    version: 1,
    kind: 'sciforge_component_segmentation_request',
    imagePath: input.sourceImagePath,
    modelPath: model,
    outputDir: input.outputDir,
    maxComponents: 200,
    returnFormat: 'sciforge-framework-components-v1'
  }

  try {
    const response = await runComponentSegmentationRunner(runner, protocolArg, request)
    const candidates = parseComponentSegmentationRunnerCandidates(response, input.imageSize)
      .filter((candidate) => isUsefulLocalComponent(candidate, input.imageSize))
      .slice(0, 220)
    return {
      candidates,
      warnings: candidates.length > 0
        ? []
        : ['Component segmentation runner returned no usable components; coarse local hitbox fallback was used.']
    }
  } catch (error) {
    return {
      candidates: [],
      warnings: [`Component segmentation runner failed (${error instanceof Error ? error.message : String(error)}); coarse local hitbox fallback was used.`]
    }
  }
}

function componentSegmentationRunnerConfig(): { runner: string; model: string; protocolArg: string } {
  const genericRunner = process.env[COMPONENT_SEGMENTATION_RUNNER_ENV]?.trim() ?? ''
  const legacyRunner = process.env[FASTSAM_RUNNER_ENV]?.trim() ?? ''
  const genericModel = process.env[COMPONENT_SEGMENTATION_MODEL_ENV]?.trim() ?? ''
  const legacyModel = process.env[FASTSAM_MODEL_ENV]?.trim() ?? ''
  return {
    runner: genericRunner || legacyRunner,
    model: genericModel || legacyModel,
    protocolArg: genericRunner ? COMPONENT_SEGMENTATION_PROTOCOL_ARG : FASTSAM_SEGMENTATION_PROTOCOL_ARG
  }
}

function runComponentSegmentationRunner(runner: string, protocolArg: string, request: JsonRecord): Promise<JsonRecord> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(runner, [protocolArg], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timed out after ${COMPONENT_SEGMENTATION_RUNNER_TIMEOUT_MS}ms`))
    }, COMPONENT_SEGMENTATION_RUNNER_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`exit ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim().slice(-600)}` : ''}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('runner returned non-object JSON'))
          return
        }
        resolvePromise(parsed as JsonRecord)
      } catch (error) {
        reject(new Error(`runner returned invalid JSON${stderr.trim() ? `; stderr: ${stderr.trim().slice(-600)}` : ''}`))
      }
    })
    child.stdin.end(JSON.stringify(request))
  })
}

function parseComponentSegmentationRunnerCandidates(response: JsonRecord, imageSize: ImageSize): LocalComponentCandidate[] {
  const rawComponents = Array.isArray(response.components)
    ? response.components
    : Array.isArray(response.segments)
      ? response.segments
      : []
  const candidates: LocalComponentCandidate[] = []
  for (const [index, raw] of rawComponents.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const record = raw as JsonRecord
    const box = readFastSamBbox(record, imageSize)
    if (!box) continue
    const semanticLayer = normalizeFastSamSemanticLayer(record.semanticLayer ?? record.layer)
    const type = normalizeFastSamComponentType(record.type)
    candidates.push({
      id: typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : typeof record.componentId === 'string' && record.componentId.trim()
          ? record.componentId.trim()
          : `component-${String(index + 1).padStart(3, '0')}`,
      title: typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : `Component ${index + 1}`,
      semanticLayer,
      type,
      role: normalizeFastSamRole(record.role) ?? componentRoleForBounds(box, imageSize),
      pixelBbox: box,
      pixels: pixelsForBox(box, imageSize),
      confidence: normalizeConfidence(record.confidence),
      detectionMethod: 'component_segmentation_external_runner'
    })
  }
  return candidates
}

function readFastSamBbox(record: JsonRecord, imageSize: ImageSize): DiagramLayerBounds | null {
  const source = (record.pixelBbox ?? record.bbox) as unknown
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const bbox = source as JsonRecord
  const x = numericValue(bbox.x)
  const y = numericValue(bbox.y)
  const w = numericValue(bbox.w ?? bbox.width)
  const h = numericValue(bbox.h ?? bbox.height)
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null
  return clampBounds({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, imageSize)
}

function normalizeFastSamSemanticLayer(value: unknown): Exclude<FrameworkSemanticLayer, 'mixed'> {
  if (value === 'text' || value === 'color' || value === 'shape' || value === 'formula') return value
  if (value === 'connector' || value === 'arrow') return 'arrow'
  if (value === 'icon' || value === 'material') return 'material'
  return 'shape'
}

function normalizeFastSamComponentType(value: unknown): FrameworkComponentType {
  if (value === 'text_label' || value === 'module' || value === 'legend') return value
  if (value === 'flow_node') return 'shape_component'
  if (value === 'connector') return 'connector_arrow'
  if (value === 'callout') return 'visual_component'
  if (value === 'formula') return 'formula_symbol'
  if (value === 'icon') return 'material_image'
  if (value === 'background') return 'panel'
  return 'module'
}

function normalizeFastSamRole(value: unknown): FrameworkComponentRole | null {
  if (value === 'primary' || value === 'secondary' || value === 'debug') return value
  if (value === 'supporting' || value === 'annotation' || value === 'background') return 'secondary'
  return null
}

function normalizeConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : 0.86
}

function numericValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return Number.NaN
}

function pixelsForBox(box: DiagramLayerBounds, imageSize: ImageSize): number[] {
  const clamped = clampBounds(box, imageSize)
  const pixels: number[] = []
  for (let y = clamped.y; y < clamped.y + clamped.h; y += 1) {
    for (let x = clamped.x; x < clamped.x + clamped.w; x += 1) {
      pixels.push(y * imageSize.width + x)
    }
  }
  return pixels
}

async function extractLocalSemanticComponents(
  sourceImagePath: string,
  imageSize: ImageSize,
  warnings: string[]
): Promise<LocalComponentCandidate[]> {
  const source = await loadImage(sourceImagePath)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)
  const imageData = ctx.getImageData(0, 0, source.width, source.height)
  const codeMap = new Uint8Array(source.width * source.height)
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4
      codeMap[y * source.width + x] = classifyFrameworkPixel(
        imageData.data[offset],
        imageData.data[offset + 1],
        imageData.data[offset + 2],
        imageData.data[offset + 3]
      )
    }
  }
  const raw: LocalComponentCandidate[] = []
  for (const code of [1, 2, 3]) {
    raw.push(...connectedComponentsForCode(codeMap, source.width, source.height, code, imageSize))
  }
  const merged = mergeLocalTextCandidates(raw, imageSize)
    .filter((candidate) => isUsefulLocalComponent(candidate, imageSize))
    .sort((a, b) => {
      const areaA = a.pixelBbox.w * a.pixelBbox.h
      const areaB = b.pixelBbox.w * b.pixelBbox.h
      if (Math.abs(a.pixelBbox.y - b.pixelBbox.y) > 8) return a.pixelBbox.y - b.pixelBbox.y
      if (Math.abs(areaA - areaB) > imageSize.width * imageSize.height * 0.012) return areaB - areaA
      return a.pixelBbox.x - b.pixelBbox.x
    })
  if (merged.length === 0) warnings.push('Local component fallback found no useful components.')
  return merged.map((candidate, index) => ({
    ...candidate,
    id: `component-${String(index + 1).padStart(3, '0')}`,
    title: `${semanticLayerLabel(candidate.semanticLayer)} ${index + 1}`
  }))
}

function classifyFrameworkPixel(r: number, g: number, b: number, alpha: number): number {
  if (alpha < 24) return 0
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (luminance > 246 && delta < 18) return 0
  if (luminance > 238 && delta < 10) return 0
  if (luminance < 105) return 1
  if (delta > 30 && luminance < 245) return 2
  if (luminance < 180 && delta < 22) return 1
  if (delta > 18 && luminance < 235) return 2
  return 0
}

function connectedComponentsForCode(
  codeMap: Uint8Array,
  width: number,
  height: number,
  code: number,
  imageSize: ImageSize
): LocalComponentCandidate[] {
  const visited = new Uint8Array(width * height)
  const components: LocalComponentCandidate[] = []
  const stack: number[] = []
  for (let start = 0; start < codeMap.length; start += 1) {
    if (visited[start] || codeMap[start] !== code) continue
    visited[start] = 1
    stack.push(start)
    const pixels: number[] = []
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    while (stack.length) {
      const index = stack.pop() as number
      pixels.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ]
      for (const next of neighbors) {
        if (next < 0 || visited[next] || codeMap[next] !== code) continue
        visited[next] = 1
        stack.push(next)
      }
    }
    const pixelBbox = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    if (pixels.length < 8 || pixelBbox.w < 2 || pixelBbox.h < 2) continue
    const semanticLayer = semanticLayerForLocalComponent(code, pixelBbox, pixels.length, imageSize)
    const type = componentTypeForLocalComponent(semanticLayer, pixelBbox, pixels.length, imageSize)
    components.push({
      id: '',
      title: '',
      semanticLayer,
      type,
      role: componentRoleForBounds(pixelBbox, imageSize),
      pixelBbox,
      pixels,
      confidence: confidenceForLocalComponent(pixelBbox, pixels.length, imageSize)
    })
  }
  return components
}

function semanticLayerForLocalComponent(
  code: number,
  box: DiagramLayerBounds,
  pixelCount: number,
  imageSize: ImageSize
): Exclude<FrameworkSemanticLayer, 'mixed'> {
  const aspect = box.w / Math.max(1, box.h)
  const areaRatio = box.w * box.h / Math.max(1, imageSize.width * imageSize.height)
  if (code === 2) {
    if (areaRatio > 0.012 && pixelCount / Math.max(1, box.w * box.h) < 0.55) return 'material'
    return 'color'
  }
  if (aspect > 6 || aspect < 0.16) return 'arrow'
  if (areaRatio < 0.00018 && Math.max(box.w, box.h) < Math.min(imageSize.width, imageSize.height) * 0.04) return 'formula'
  return 'text'
}

function componentTypeForLocalComponent(
  semanticLayer: Exclude<FrameworkSemanticLayer, 'mixed'>,
  box: DiagramLayerBounds,
  pixelCount: number,
  imageSize: ImageSize
): FrameworkComponentType {
  const aspect = box.w / Math.max(1, box.h)
  const areaRatio = box.w * box.h / Math.max(1, imageSize.width * imageSize.height)
  if (semanticLayer === 'arrow') return 'connector_arrow'
  if (semanticLayer === 'text') return 'text_label'
  if (semanticLayer === 'formula') return 'formula_symbol'
  if (semanticLayer === 'material') return 'material_image'
  if (semanticLayer === 'color') {
    if (areaRatio > 0.035) return 'panel'
    if (aspect > 2.5 && box.h < imageSize.height * 0.1) return 'connector_arrow'
    return pixelCount / Math.max(1, box.w * box.h) > 0.72 ? 'color_block' : 'visual_component'
  }
  return 'shape_component'
}

function componentRoleForBounds(box: DiagramLayerBounds, imageSize: ImageSize): FrameworkComponentRole {
  const areaRatio = box.w * box.h / Math.max(1, imageSize.width * imageSize.height)
  if (areaRatio > 0.006) return 'primary'
  if (areaRatio > 0.0004) return 'secondary'
  return 'debug'
}

function confidenceForLocalComponent(box: DiagramLayerBounds, pixelCount: number, imageSize: ImageSize): number {
  const density = pixelCount / Math.max(1, box.w * box.h)
  const areaRatio = box.w * box.h / Math.max(1, imageSize.width * imageSize.height)
  return clamp01(0.42 + Math.min(0.28, density * 0.22) + Math.min(0.24, areaRatio * 3.5))
}

function mergeLocalTextCandidates(candidates: LocalComponentCandidate[], imageSize: ImageSize): LocalComponentCandidate[] {
  const textCandidates = candidates
    .filter((candidate) => candidate.semanticLayer === 'text' && candidate.pixelBbox.h < imageSize.height * 0.08)
    .sort((a, b) => a.pixelBbox.y - b.pixelBbox.y || a.pixelBbox.x - b.pixelBbox.x)
  const used = new Set<LocalComponentCandidate>()
  const merged: LocalComponentCandidate[] = []
  for (const candidate of textCandidates) {
    if (used.has(candidate)) continue
    used.add(candidate)
    const group = [candidate]
    let groupBox = { ...candidate.pixelBbox }
    let changed = true
    while (changed) {
      changed = false
      for (const other of textCandidates) {
        if (used.has(other)) continue
        const yClose = Math.abs(centerY(other.pixelBbox) - centerY(groupBox)) <= Math.max(8, Math.max(other.pixelBbox.h, groupBox.h) * 0.75)
        const gap = horizontalGap(groupBox, other.pixelBbox)
        if (yClose && gap <= Math.max(14, Math.max(other.pixelBbox.h, groupBox.h) * 2.8)) {
          used.add(other)
          group.push(other)
          groupBox = unionBounds([groupBox, other.pixelBbox])
          changed = true
        }
      }
    }
    if (group.length === 1) {
      merged.push(candidate)
    } else {
      merged.push({
        ...candidate,
        pixelBbox: groupBox,
        pixels: group.flatMap((item) => item.pixels),
        confidence: clamp01(Math.max(...group.map((item) => item.confidence)) + 0.08)
      })
    }
  }
  return [
    ...candidates.filter((candidate) => !(candidate.semanticLayer === 'text' && candidate.pixelBbox.h < imageSize.height * 0.08)),
    ...merged
  ]
}

function isUsefulLocalComponent(candidate: LocalComponentCandidate, imageSize: ImageSize): boolean {
  const box = candidate.pixelBbox
  const imageArea = imageSize.width * imageSize.height
  const areaRatio = box.w * box.h / Math.max(1, imageArea)
  if (box.w < 3 || box.h < 3) return false
  if (candidate.pixels.length < 10) return false
  if (areaRatio > 0.62) return false
  if (areaRatio < 0.000018 && candidate.semanticLayer !== 'formula') return false
  return true
}

async function writeComponentAssets(input: {
  sourceImagePath: string
  componentDir: string
  componentBasePath: string
  imageSize: ImageSize
  candidates: LocalComponentCandidate[]
}): Promise<FrameworkComponentLayer[]> {
  const source = await loadImage(input.sourceImagePath)
  const baseCanvas = createCanvas(source.width, source.height)
  const baseCtx = baseCanvas.getContext('2d')
  baseCtx.drawImage(source, 0, 0)
  const baseData = baseCtx.getImageData(0, 0, source.width, source.height)
  const components: FrameworkComponentLayer[] = []
  for (const [index, candidate] of input.candidates.entries()) {
    const id = candidate.id || `component-${String(index + 1).padStart(3, '0')}`
    const safeId = slugForId(id)
    const assetPath = join(input.componentDir, safeId + '.crop.png')
    const transparentAssetPath = join(input.componentDir, safeId + '.transparent.png')
    const box = clampBounds(candidate.pixelBbox, input.imageSize)
    await writeImageCrop(input.sourceImagePath, assetPath, box)
    await writeTransparentComponentAsset({
      sourceImagePath: input.sourceImagePath,
      outputPath: transparentAssetPath,
      bbox: box,
      pixels: candidate.pixels,
      imageSize: input.imageSize
    })
    for (const pixel of candidate.pixels) {
      const offset = pixel * 4
      baseData.data[offset] = 255
      baseData.data[offset + 1] = 255
      baseData.data[offset + 2] = 255
      baseData.data[offset + 3] = 255
    }
    components.push({
      componentId: safeId,
      layerId: `layer-${safeId}`,
      type: candidate.type,
      title: candidate.title || `${semanticLayerLabel(candidate.semanticLayer)} ${index + 1}`,
      bbox: { ...box },
      pixelBbox: { ...box },
      assetPath,
      transparentAssetPath,
      role: candidate.role,
      qualityScore: candidate.confidence,
      semanticLayer: candidate.semanticLayer,
      detectionMethod: candidate.detectionMethod === 'component_segmentation_external_runner' || candidate.detectionMethod === 'fastsam_external_runner'
        ? 'component_segmentation'
        : 'local_connected_components',
      confidence: candidate.confidence
    })
  }
  baseCtx.putImageData(baseData, 0, 0)
  await writeFile(input.componentBasePath, baseCanvas.toBuffer('image/png'))
  return components
}

async function writeTransparentComponentAsset(input: {
  sourceImagePath: string
  outputPath: string
  bbox: DiagramLayerBounds
  pixels: number[]
  imageSize: ImageSize
}): Promise<void> {
  const source = await loadImage(input.sourceImagePath)
  const canvas = createCanvas(input.bbox.w, input.bbox.h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, input.bbox.x, input.bbox.y, input.bbox.w, input.bbox.h, 0, 0, input.bbox.w, input.bbox.h)
  const data = ctx.getImageData(0, 0, input.bbox.w, input.bbox.h)
  const mask = new Uint8Array(input.bbox.w * input.bbox.h)
  for (const pixel of input.pixels) {
    const x = pixel % input.imageSize.width
    const y = Math.floor(pixel / input.imageSize.width)
    if (x < input.bbox.x || y < input.bbox.y || x >= input.bbox.x + input.bbox.w || y >= input.bbox.y + input.bbox.h) continue
    mask[(y - input.bbox.y) * input.bbox.w + (x - input.bbox.x)] = 1
  }
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) continue
    data.data[index * 4 + 3] = 0
  }
  ctx.putImageData(data, 0, 0)
  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
}

async function writeImageCrop(sourceImagePath: string, outputPath: string, bounds: DiagramLayerBounds): Promise<void> {
  const source = await loadImage(sourceImagePath)
  const box = clampBounds(bounds, { width: source.width, height: source.height })
  const canvas = createCanvas(box.w, box.h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, box.w, box.h)
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
  await writeFile(outputPath, canvas.toBuffer('image/png'))
}

async function writeFastSamPreview(input: {
  sourceImagePath: string
  outputPath: string
  components: FrameworkComponentLayer[]
}): Promise<void> {
  const source = await loadImage(input.sourceImagePath)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)
  const palette = ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#7c3aed', '#0891b2', '#db2777']
  for (const [index, component] of input.components.entries()) {
    const color = palette[index % palette.length] ?? '#2563eb'
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, Math.round(Math.min(source.width, source.height) * 0.0015))
    ctx.strokeRect(component.pixelBbox.x + 0.5, component.pixelBbox.y + 0.5, Math.max(1, component.pixelBbox.w - 1), Math.max(1, component.pixelBbox.h - 1))
    if (component.pixelBbox.w > 28 && component.pixelBbox.h > 12) {
      ctx.font = '11px sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.86)'
      ctx.fillRect(component.pixelBbox.x, component.pixelBbox.y, Math.min(component.pixelBbox.w, 92), 15)
      ctx.fillStyle = color
      ctx.fillText(component.componentId.replace('component-', 'c'), component.pixelBbox.x + 3, component.pixelBbox.y + 11)
    }
  }
  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
}

async function writeFrameworkSemanticLayerImages(input: {
  sourceImagePath: string
  semanticLayerDir: string
  imageSize: ImageSize
  components: FrameworkComponentLayer[]
}): Promise<NonNullable<FrameworkComponentManifest['semanticLayerImages']>> {
  await mkdir(input.semanticLayerDir, { recursive: true })
  const layers = ['text', 'color', 'arrow', 'material', 'formula', 'shape'] as const
  const results: NonNullable<FrameworkComponentManifest['semanticLayerImages']> = []
  for (const layer of layers) {
    const components = input.components.filter((component) => component.semanticLayer === layer && component.role !== 'debug')
    if (!components.length) continue
    const canvas = createCanvas(input.imageSize.width, input.imageSize.height)
    const ctx = canvas.getContext('2d')
    let pixelCount = 0
    for (const component of components) {
      const assetPath = component.transparentAssetPath || component.assetPath
      if (!assetPath) continue
      const asset = await loadImage(assetPath)
      ctx.drawImage(asset, component.pixelBbox.x, component.pixelBbox.y, component.pixelBbox.w, component.pixelBbox.h)
      pixelCount += component.pixelBbox.w * component.pixelBbox.h
    }
    const assetPath = join(input.semanticLayerDir, `${layer}.png`)
    await writeFile(assetPath, canvas.toBuffer('image/png'))

    const previewCanvas = createCanvas(input.imageSize.width, input.imageSize.height)
    const previewCtx = previewCanvas.getContext('2d')
    previewCtx.fillStyle = '#ffffff'
    previewCtx.fillRect(0, 0, input.imageSize.width, input.imageSize.height)
    previewCtx.drawImage(canvas, 0, 0)
    previewCtx.strokeStyle = '#2563eb'
    previewCtx.lineWidth = Math.max(1, Math.round(Math.min(input.imageSize.width, input.imageSize.height) * 0.0015))
    for (const component of components) {
      previewCtx.strokeRect(
        component.pixelBbox.x + 0.5,
        component.pixelBbox.y + 0.5,
        Math.max(1, component.pixelBbox.w - 1),
        Math.max(1, component.pixelBbox.h - 1)
      )
    }
    const previewPath = join(input.semanticLayerDir, `${layer}.preview.png`)
    await writeFile(previewPath, previewCanvas.toBuffer('image/png'))
    results.push({
      semanticLayer: layer,
      assetPath,
      previewPath,
      pixelCount,
      coverage: clamp01(pixelCount / Math.max(1, input.imageSize.width * input.imageSize.height)),
      detectionMethod: 'layer_first_component_mask'
    })
  }
  return results
}

function buildFrameworkComponentBlocks(input: {
  components: FrameworkComponentLayer[]
  designPlan?: FrameworkDesignPlan
  canvasSize: ImageSize
  imageSize: ImageSize
}): FrameworkComponentBlock[] {
  const blocks: FrameworkComponentBlock[] = []
  for (const region of input.designPlan?.regions ?? []) {
    if (!region.editable || !isFrameworkBlockRegionKind(region.kind)) continue
    const pixelBbox = clampBounds(canvasBoxToPixelBox(region.bbox, input.canvasSize, input.imageSize), input.imageSize)
    const childComponentIds = input.components
      .filter((component) => componentBelongsToBlock(component.pixelBbox, pixelBbox))
      .map((component) => component.componentId)
    if (!childComponentIds.length && region.kind !== 'panel') continue
    blocks.push({
      blockId: `block-region-${slugForId(region.id)}`,
      title: cleanFrameworkLabel(region.title, 90),
      blockType: blockTypeForFrameworkRegion(region.kind),
      bbox: canvasBoxToPixelBox(pixelBbox, input.imageSize, input.canvasSize),
      pixelBbox,
      role: region.kind === 'panel' || region.kind === 'module' ? 'primary' : 'secondary',
      sourceRegionId: region.id,
      ...(region.sourceSpecRef ? { sourceSpecRef: region.sourceSpecRef } : {}),
      ...(region.placeholderId ? { placeholderId: region.placeholderId } : {}),
      childComponentIds,
      semanticLayers: semanticLayersForComponentIds(input.components, childComponentIds),
      detectionMethods: detectionMethodsForComponentIds(input.components, childComponentIds),
      reusableTemplateId: reusableTemplateIdForComponent(componentTypeForFrameworkRegion(region.kind), region.title),
      confidence: 0.78
    })
  }

  const sourceComponents = input.components
    .filter((component) => isFrameworkBlockSourceComponent(component, input.imageSize))
    .sort((a, b) => b.pixelBbox.w * b.pixelBbox.h - a.pixelBbox.w * a.pixelBbox.h)
    .slice(0, 36)
  for (const component of sourceComponents) {
    const childComponentIds = input.components
      .filter((child) => componentBelongsToBlock(child.pixelBbox, component.pixelBbox))
      .map((child) => child.componentId)
    const distinctChildren = childComponentIds.filter((id) => id !== component.componentId)
    if (!distinctChildren.length && component.semanticLayer !== 'material') continue
    const block: FrameworkComponentBlock = {
      blockId: `block-component-${slugForId(component.componentId)}`,
      title: cleanFrameworkLabel(component.title, 90),
      blockType: blockTypeForFrameworkComponent(component),
      bbox: component.bbox,
      pixelBbox: component.pixelBbox,
      role: component.role,
      sourceComponentId: component.componentId,
      ...(component.sourceRegionId ? { sourceRegionId: component.sourceRegionId } : {}),
      ...(component.sourceSpecRef ? { sourceSpecRef: component.sourceSpecRef } : {}),
      ...(component.placeholderId ? { placeholderId: component.placeholderId } : {}),
      childComponentIds,
      semanticLayers: semanticLayersForComponentIds(input.components, childComponentIds),
      detectionMethods: detectionMethodsForComponentIds(input.components, childComponentIds),
      reusableTemplateId: component.reusableTemplateId,
      confidence: component.confidence
    }
    if (blocks.some((candidate) => frameworkBlocksOverlap(candidate, block))) continue
    blocks.push(block)
  }

  return blocks
    .filter((block) => block.childComponentIds.length > 0)
    .sort((a, b) => {
      const priority = frameworkComponentBlockTypePriority(b.blockType) - frameworkComponentBlockTypePriority(a.blockType)
      if (priority !== 0) return priority
      return a.pixelBbox.y - b.pixelBbox.y || a.pixelBbox.x - b.pixelBbox.x
    })
    .slice(0, 64)
}

function applyFrameworkComponentBlocks(components: FrameworkComponentLayer[], blocks: FrameworkComponentBlock[]): void {
  const componentById = new Map(components.map((component) => [component.componentId, component]))
  const sortedBlocks = [...blocks].sort((a, b) => a.pixelBbox.w * a.pixelBbox.h - b.pixelBbox.w * b.pixelBbox.h)
  for (const component of components) {
    const parentBlock = sortedBlocks.find((block) => block.childComponentIds.includes(component.componentId))
    if (parentBlock) component.parentBlockId = parentBlock.blockId
  }
  for (const block of blocks) {
    if (!block.sourceComponentId) continue
    const parentComponent = componentById.get(block.sourceComponentId)
    if (!parentComponent) continue
    const childIds = block.childComponentIds.filter((id) => id !== block.sourceComponentId)
    if (childIds.length) parentComponent.children = Array.from(new Set([...(parentComponent.children ?? []), ...childIds]))
  }
}

function canvasBoxToPixelBox(box: DiagramLayerBounds, canvasSize: ImageSize, imageSize: ImageSize): DiagramLayerBounds {
  return {
    x: Math.round(box.x * imageSize.width / Math.max(1, canvasSize.width)),
    y: Math.round(box.y * imageSize.height / Math.max(1, canvasSize.height)),
    w: Math.round(box.w * imageSize.width / Math.max(1, canvasSize.width)),
    h: Math.round(box.h * imageSize.height / Math.max(1, canvasSize.height))
  }
}

function isFrameworkBlockRegionKind(kind: FrameworkDesignPlan['regions'][number]['kind']): boolean {
  return kind === 'panel' || kind === 'module' || kind === 'legend' || kind === 'real_example' || kind === 'code_example' || kind === 'callout'
}

function blockTypeForFrameworkRegion(kind: FrameworkDesignPlan['regions'][number]['kind']): FrameworkComponentBlockType {
  if (kind === 'panel') return 'panel'
  if (kind === 'module') return 'module'
  if (kind === 'legend' || kind === 'callout') return 'legend'
  if (kind === 'real_example' || kind === 'code_example') return 'material_group'
  return 'component_group'
}

function componentTypeForFrameworkRegion(kind: FrameworkDesignPlan['regions'][number]['kind']): FrameworkComponentType {
  if (kind === 'panel') return 'panel'
  if (kind === 'module') return 'module'
  if (kind === 'legend') return 'legend'
  if (kind === 'real_example') return 'material_image'
  if (kind === 'code_example') return 'code'
  if (kind === 'callout') return 'text_label'
  return 'visual_component'
}

function blockTypeForFrameworkComponent(component: FrameworkComponentLayer): FrameworkComponentBlockType {
  if (component.type === 'panel') return 'panel'
  if (component.type === 'module' || component.type === 'shape_component') return 'module'
  if (component.type === 'legend') return 'legend'
  if (component.type === 'thumbnail' || component.type === 'material_image' || component.type === 'table' || component.type === 'code' || component.type === 'chart') return 'material_group'
  return 'component_group'
}

function isFrameworkBlockSourceComponent(component: FrameworkComponentLayer, imageSize: ImageSize): boolean {
  if (component.role === 'debug') return false
  const areaRatio = component.pixelBbox.w * component.pixelBbox.h / Math.max(1, imageSize.width * imageSize.height)
  if (areaRatio < 0.0018 || areaRatio > 0.36) return false
  if (component.type === 'panel' || component.type === 'module' || component.type === 'thumbnail' || component.type === 'table' || component.type === 'code' || component.type === 'chart') return true
  if (component.type === 'shape_component' && areaRatio >= 0.003) return true
  if (component.type === 'material_image' && areaRatio >= 0.0025) return true
  return false
}

function componentBelongsToBlock(componentBox: DiagramLayerBounds, blockBox: DiagramLayerBounds): boolean {
  if (containmentRatioForBounds(componentBox, blockBox) >= 0.55) return true
  const centerX = componentBox.x + componentBox.w / 2
  const centerY = componentBox.y + componentBox.h / 2
  return centerX >= blockBox.x &&
    centerX <= blockBox.x + blockBox.w &&
    centerY >= blockBox.y &&
    centerY <= blockBox.y + blockBox.h &&
    componentBox.w * componentBox.h <= blockBox.w * blockBox.h * 0.92
}

function containmentRatioForBounds(inner: DiagramLayerBounds, outer: DiagramLayerBounds): number {
  const x1 = Math.max(inner.x, outer.x)
  const y1 = Math.max(inner.y, outer.y)
  const x2 = Math.min(inner.x + inner.w, outer.x + outer.w)
  const y2 = Math.min(inner.y + inner.h, outer.y + outer.h)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return overlap / Math.max(1, inner.w * inner.h)
}

function componentBoxOverlap(a: DiagramLayerBounds, b: DiagramLayerBounds): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return overlap / Math.max(1, Math.min(a.w * a.h, b.w * b.h))
}

function frameworkBlocksOverlap(a: FrameworkComponentBlock, b: FrameworkComponentBlock): boolean {
  if (a.sourceRegionId && b.sourceRegionId && a.sourceRegionId === b.sourceRegionId) return true
  return componentBoxOverlap(a.pixelBbox, b.pixelBbox) > 0.82
}

function semanticLayersForComponentIds(components: FrameworkComponentLayer[], ids: string[]): Exclude<FrameworkSemanticLayer, 'mixed'>[] {
  const idSet = new Set(ids)
  const layers = components
    .filter((component) => idSet.has(component.componentId))
    .map((component) => component.semanticLayer)
    .filter((layer): layer is Exclude<FrameworkSemanticLayer, 'mixed'> => Boolean(layer && layer !== 'mixed'))
  return Array.from(new Set(layers)).sort()
}

function detectionMethodsForComponentIds(components: FrameworkComponentLayer[], ids: string[]): FrameworkComponentLayer['detectionMethod'][] {
  const idSet = new Set(ids)
  return Array.from(new Set(components
    .filter((component) => idSet.has(component.componentId))
    .map((component) => component.detectionMethod)))
}

function frameworkComponentBlockTypePriority(type: FrameworkComponentBlockType): number {
  if (type === 'panel') return 6
  if (type === 'module') return 5
  if (type === 'workflow_group') return 4
  if (type === 'material_group') return 3
  if (type === 'legend') return 2
  return 1
}

function reusableTemplateIdForComponent(type: FrameworkComponentType, title: string): string {
  return `${type}-${slugForId(title).slice(0, 48)}`
}

function cleanFrameworkLabel(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…` : normalized
}

function componentLayersForDiagramManifest(componentManifest: FrameworkComponentManifest | undefined): DiagramLayer[] {
  if (!componentManifest) return []
  return editableFrameworkComponents(componentManifest).map((component, index): DiagramLayer => ({
    id: component.layerId,
    type: 'image',
    label: component.title,
    bbox: component.pixelBbox,
    zIndex: 20 + index,
    componentId: component.componentId,
    componentType: component.type,
    componentRole: component.role,
    componentQualityScore: component.qualityScore,
    semanticLayer: component.semanticLayer,
    parentComponentId: component.parentComponentId,
    parentBlockId: component.parentBlockId,
    reusableTemplateId: component.reusableTemplateId,
    assetPath: component.transparentAssetPath,
    editable: true,
    origin: 'framework_component_asset',
    confidence: component.confidence
  }))
}

function editableFrameworkComponents(componentManifest: FrameworkComponentManifest | undefined): FrameworkComponentLayer[] {
  if (!componentManifest) return []
  return componentManifest.components.filter((component) => component.role !== 'debug' && component.transparentAssetPath)
}

function parseFrameworkComponentManifest(value: unknown): FrameworkComponentManifest {
  const record = asRecord(value)
  if (record.kind !== 'sciforge_framework_components' || record.version !== 1) throw new Error('Invalid framework component manifest.')
  if (typeof record.sourceImagePath !== 'string' || typeof record.componentBasePath !== 'string') throw new Error('Framework component manifest is missing paths.')
  if (!Array.isArray(record.components)) throw new Error('Framework component manifest is missing components.')
  const manifest = record as FrameworkComponentManifest
  if (Array.isArray(record.blocks)) {
    manifest.blocks = record.blocks.map((block) => {
      const blockRecord = asRecord(block)
      const childComponentIds = Array.isArray(blockRecord.childComponentIds)
        ? blockRecord.childComponentIds
        : Array.isArray(blockRecord.componentIds)
          ? blockRecord.componentIds
          : []
      return {
        ...(blockRecord as FrameworkComponentBlock),
        childComponentIds: childComponentIds.map((id) => String(id).trim()).filter(Boolean)
      }
    })
  }
  return manifest
}

function parseFrameworkDesignPlan(value: unknown): FrameworkDesignPlan | undefined {
  const record = asRecord(value)
  if (record.kind !== 'sciforge_framework_design_plan' || record.version !== 1) return undefined
  return record as FrameworkDesignPlan
}

function selectFrameworkComponents(
  manifest: FrameworkComponentManifest,
  componentIds: string[] | undefined,
  blockIds?: string[]
): FrameworkComponentLayer[] {
  const ids = new Set((componentIds ?? []).map((id) => id.trim()).filter(Boolean))
  const selectedBlockIds = new Set((blockIds ?? []).map((id) => id.trim()).filter(Boolean))
  for (const block of manifest.blocks ?? []) {
    if (!selectedBlockIds.has(block.blockId)) continue
    for (const id of block.childComponentIds) ids.add(id)
  }
  if (ids.size === 0 && selectedBlockIds.size === 0) return manifest.components.filter((component) => component.role !== 'debug')
  return manifest.components.filter((component) => ids.has(component.componentId) || ids.has(component.layerId))
}

function frameworkEditTargetFromComponents(components: FrameworkComponentLayer[]): FrameworkLocalizedEditTarget {
  const bbox = unionBounds(components.map((component) => component.pixelBbox))
  const blockIds = [...new Set(components.map((component) => component.parentBlockId).filter((id): id is string => Boolean(id)))]
  const singleBlock = blockIds.length === 1 && components.length > 1
  return {
    kind: singleBlock ? 'block' : components.length === 1 ? 'component' : 'selection',
    id: singleBlock ? blockIds[0] : components.map((component) => component.componentId).join('+'),
    title: components.map((component) => component.title).join(' + ').slice(0, 180),
    bbox,
    componentIds: components.map((component) => component.componentId),
    ...(blockIds.length ? { blockIds } : {}),
    semanticLayers: [...new Set(components.map((component) => component.semanticLayer ?? 'mixed'))]
  }
}

function unionBounds(bounds: DiagramLayerBounds[]): DiagramLayerBounds {
  const minX = Math.min(...bounds.map((box) => box.x))
  const minY = Math.min(...bounds.map((box) => box.y))
  const maxX = Math.max(...bounds.map((box) => box.x + box.w))
  const maxY = Math.max(...bounds.map((box) => box.y + box.h))
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    w: Math.ceil(maxX - minX),
    h: Math.ceil(maxY - minY)
  }
}

function padBounds(bounds: DiagramLayerBounds, padding: number, imageSize: ImageSize): DiagramLayerBounds {
  return clampBounds({
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2
  }, imageSize)
}

function clampBounds(bounds: DiagramLayerBounds, imageSize: ImageSize): DiagramLayerBounds {
  const x = clampInteger(bounds.x, 0, Math.max(0, imageSize.width - 1))
  const y = clampInteger(bounds.y, 0, Math.max(0, imageSize.height - 1))
  const maxW = Math.max(1, imageSize.width - x)
  const maxH = Math.max(1, imageSize.height - y)
  return {
    x,
    y,
    w: clampInteger(bounds.w, 1, maxW),
    h: clampInteger(bounds.h, 1, maxH)
  }
}

function centerY(bounds: DiagramLayerBounds): number {
  return bounds.y + bounds.h / 2
}

function horizontalGap(a: DiagramLayerBounds, b: DiagramLayerBounds): number {
  if (a.x <= b.x + b.w && b.x <= a.x + a.w) return 0
  return a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
}

function semanticLayerLabel(layer: FrameworkSemanticLayer): string {
  if (layer === 'text') return 'Text'
  if (layer === 'color') return 'Color block'
  if (layer === 'arrow') return 'Arrow'
  if (layer === 'material') return 'Material'
  if (layer === 'formula') return 'Formula'
  if (layer === 'shape') return 'Shape'
  return 'Component'
}

async function recomposeEditedRegion(input: {
  sourceImagePath: string
  editOutputPath: string
  outputPath: string
  editedRegionPath: string
  target: DiagramLayerBounds
}): Promise<void> {
  const source = await loadImage(input.sourceImagePath)
  const edited = await loadImage(input.editOutputPath)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(input.target.x, input.target.y, input.target.w, input.target.h)
  ctx.drawImage(edited, input.target.x, input.target.y, input.target.w, input.target.h)
  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
  await writeImageCrop(input.outputPath, input.editedRegionPath, input.target)
}

async function writeFrameworkEditContactSheet(input: {
  sourceImagePath: string
  targetCropPath: string
  editOutputPath: string
  outputPath: string
  contactSheetPath: string
}): Promise<void> {
  const images = await Promise.all([
    loadImage(input.sourceImagePath),
    loadImage(input.targetCropPath),
    loadImage(input.editOutputPath),
    loadImage(input.outputPath)
  ])
  const thumbW = 360
  const thumbH = 240
  const padding = 28
  const labelH = 28
  const canvas = createCanvas(padding * 5 + thumbW * 4, padding * 2 + labelH + thumbH)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const labels = ['Source', 'Selected crop', 'Image2 redraw', 'Recomposed']
  for (const [index, image] of images.entries()) {
    const x = padding + index * (thumbW + padding)
    const y = padding + labelH
    ctx.fillStyle = '#334155'
    ctx.font = '16px sans-serif'
    ctx.fillText(labels[index] ?? 'Image', x, padding + 18)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, y, thumbW, thumbH)
    const scale = Math.min(thumbW / image.width, thumbH / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, x + (thumbW - w) / 2, y + (thumbH - h) / 2, w, h)
    ctx.strokeStyle = '#cbd5e1'
    ctx.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1)
  }
  await writeFile(input.contactSheetPath, canvas.toBuffer('image/png'))
}

function extnameForPath(path: string): string {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index) : ''
}

export async function editImageFromVisualReviewPacket(
  request: ImageGenerationEditFromVisualReviewPacketRequest
): Promise<ImageGenerationEditFromVisualReviewPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const visualPlanError = validateImageVisualPlan(request.visualPlan)
    if (visualPlanError || request.visualPlan.sourceArtifacts.length === 0) {
      return {
        ok: false,
        status: 'invalid_request',
        message: visualPlanError ?? 'A visual-review revision handoff must declare its sourceArtifacts.',
        warnings
      }
    }
    const packet = await loadReviewPacket(request, workspaceRoot)
    const packetRecord = asRecord(packet)
    if (packetRecord.schemaVersion !== 1 || !packetRecord.sourceArtifact || !Array.isArray(packetRecord.annotations)) {
      throw new ReviewPacketError('Expected a VisualDocument review packet with schemaVersion, sourceArtifact, and annotations.')
    }
    const packetVisualDocumentId = stringValue(packetRecord.documentId)
    if (!packetVisualDocumentId) throw new ReviewPacketError('VisualDocument review packet documentId is required.')
    const visualDocumentId = packetVisualDocumentId
    const threadId = request.threadId
    const intents = extractEditIntents(packet, workspaceRoot, warnings, request.maskPath)
    if (intents.length === 0) {
      return {
        ok: false,
        status: 'no_edit_targets',
        message: 'No image edit targets were found in the visual-review packet.',
        warnings
      }
    }
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const outputs: Array<{
      workspaceRoot: string
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      provider: ImageGenerationProvider
    }> = []
    for (const [index, intent] of intents.entries()) {
      const imageId = slugForId(request.imageId ?? 'edited-image-' + new Date().toISOString() + '-' + (index + 1))
      const outputPath = join(outputDir, imageId + '.' + (intent.outputFormat ?? 'png'))
      const providerResult = await renderWithProvider({ workspaceRoot, outputPath, editIntent: intent })
      warnings.push(...providerResult.warnings)
      const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
      const manifestPath = join(outputDir, imageId + '.manifest.json')
      const manifest: ImageGenerationManifest = {
        version: 1,
        renderer: 'sciforge-image-generation-mcp',
        rendererVersion: RENDERER_VERSION,
        tool: 'image_generation_edit_from_visual_review_packet',
        createdAt: new Date().toISOString(),
        requestHash: hashValue({ intent }),
        workspaceRoot,
        outputPath,
        outputHash,
        ...(visualDocumentId ? { visualDocumentId } : {}),
        ...(threadId ? { threadId } : {}),
        editIntent: intent,
        visualPlan: request.visualPlan,
        provider: providerResult.provider,
        warnings
      }
      await writeJson(manifestPath, manifest)
      const artifactManifestPath = await writeImageArtifactManifest({
        workspaceRoot,
        artifactId: imageId,
        artifactKind: 'edited_image',
        sourceTool: 'image_generation',
        outputPath,
        outputHash,
        manifestPath,
        sourcePath: intent.sourcePath,
        title: intent.instruction.slice(0, 90) || imageId,
        ...(visualDocumentId ? { visualDocumentId } : {}),
        ...(threadId ? { threadId } : {}),
        visualPlan: request.visualPlan
      })
      outputs.push({ workspaceRoot, outputPath, manifestPath, artifactManifestPath, provider: providerResult.provider })
    }
    return {
      ok: true,
      status: outputs.some((output) => output.provider !== 'placeholder') ? 'edited' : 'edited_placeholder',
      intents,
      outputs,
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: editErrorStatus(error),
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

export async function reviewVisualArtifact(request: VisualArtifactReviewRequest): Promise<VisualArtifactReviewResult> {
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const outputPath = await resolveWorkspacePath(workspaceRoot, request.outputPath)
    const manifestPath = await resolveWorkspacePath(workspaceRoot, request.manifestPath)
    const { visualPlan, outputHash: manifestOutputHash } = await verifiedReviewManifest(workspaceRoot, outputPath, manifestPath)
    const image = await loadImage(outputPath)
    const warnings: string[] = []
    const sizeScore = image.width >= MIN_IMAGE_SIZE && image.height >= MIN_IMAGE_SIZE ? 1 : 0.35
    if (image.width < MIN_IMAGE_SIZE || image.height < MIN_IMAGE_SIZE) warnings.push('Image is smaller than the minimum recommended size.')
    const nonEmptyScore = await scoreNonEmpty(outputPath)
    if (nonEmptyScore < 0.75) warnings.push('Image appears mostly blank or extremely low contrast.')
    let referenceScore: number | undefined
    if (request.referencePath) {
      const referencePath = await resolveWorkspacePath(workspaceRoot, request.referencePath)
      const reference = await loadImage(referencePath)
      const outputRatio = image.width / Math.max(1, image.height)
      const referenceRatio = reference.width / Math.max(1, reference.height)
      referenceScore = Math.max(0, 1 - Math.min(1, Math.abs(outputRatio - referenceRatio) / Math.max(referenceRatio, 0.01)))
      if (referenceScore < 0.75) warnings.push('Output aspect ratio differs from the reference image.')
    }
    const visualReview = await requestModelRouterVisualReview({
      outputPath,
      task: request.task,
      visualPlan,
      ...(request.referencePath
        ? { referencePath: await resolveWorkspacePath(workspaceRoot, request.referencePath) }
        : {})
    })
    if (!visualReview.ok) return visualReview
    const basicOverall = clamp01((sizeScore + nonEmptyScore + (referenceScore ?? 1)) / (referenceScore === undefined ? 2 : 3))
    const overall = clamp01(basicOverall * 0.35 + visualReview.score * 0.65)
    warnings.push(...visualReview.violations)
    const reviewPassed = visualReview.pass && overall >= (request.minOverall ?? 0.72)
    const repairable = !reviewPassed && !visualReview.needsContext
    return {
      ok: true,
      status: visualReview.needsContext
        ? 'needs_context'
        : reviewPassed
          ? visualPlan.releaseCeiling
          : 'draft_ready',
      reviewedArtifactPath: outputPath,
      reviewedArtifactHash: manifestOutputHash,
      reviewedAt: new Date().toISOString(),
      score: {
        overall,
        dimensions: sizeScore,
        nonEmpty: nonEmptyScore,
        background: nonEmptyScore,
        ...(referenceScore !== undefined ? { reference: referenceScore } : {}),
        semantic: visualReview.score,
        warnings
      },
      semantic: {
        pass: visualReview.pass,
        needsContext: visualReview.needsContext,
        summary: visualReview.summary,
        violations: visualReview.violations,
        repairInstructions: visualReview.repairInstructions
      },
      repairable,
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof ReviewManifestError ? 'invalid_manifest' : 'image_unreadable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function verifiedReviewManifest(
  workspaceRoot: string,
  outputPath: string,
  manifestPath: string
): Promise<{ visualPlan: ImageGenerationRecipe['visualPlan']; outputHash: string }> {
  let manifest: JsonRecord
  try {
    manifest = asRecord(JSON.parse(await readFile(manifestPath, 'utf8')))
  } catch (error) {
    throw new ReviewManifestError('Visual review requires a readable JSON render manifest: ' + (error instanceof Error ? error.message : String(error)))
  }
  const recordedOutputPath = stringValue(manifest.outputPath)
  if (!recordedOutputPath) throw new ReviewManifestError('Render manifest outputPath is required.')
  const resolvedRecordedOutputPath = await resolveWorkspacePath(workspaceRoot, recordedOutputPath)
  if (resolvedRecordedOutputPath !== outputPath) {
    throw new ReviewManifestError('Render manifest outputPath does not match the reviewed artifact.')
  }
  const visualPlan = manifest.visualPlan as ImageGenerationRecipe['visualPlan'] | undefined
  const visualPlanError = validateTerminalVisualPlan(visualPlan)
  if (visualPlanError) throw new ReviewManifestError('Render manifest visualPlan is invalid: ' + visualPlanError)
  const outputHash = stringValue(manifest.outputHash)
  if (!outputHash || !/^[a-f0-9]{64}$/i.test(outputHash)) {
    throw new ReviewManifestError('Render manifest outputHash is required.')
  }
  const actualHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
  if (actualHash !== outputHash) throw new ReviewManifestError('Reviewed artifact hash does not match its render manifest.')
  return { visualPlan: visualPlan!, outputHash }
}

type ModelRouterVisualReview =
  | {
      ok: true
      pass: boolean
      needsContext: boolean
      score: number
      summary: string
      violations: string[]
      repairInstructions: string[]
    }
  | {
      ok: false
      status: 'vision_review_unavailable' | 'vision_review_invalid'
      message: string
      warnings?: string[]
    }

async function requestModelRouterVisualReview(input: {
  outputPath: string
  referencePath?: string
  task: string
  visualPlan: ImageGenerationRecipe['visualPlan']
}): Promise<ModelRouterVisualReview> {
  const endpoint = configuredModelRouterImageEndpoint()
  if (!endpoint) {
    return {
      ok: false,
      status: 'vision_review_unavailable',
      message: 'Semantic visual review requires the local SciForge Model Router.'
    }
  }
  try {
    const content: Array<Record<string, unknown>> = [
      {
        type: 'input_text',
        text: [
          'Review this visual artifact as a strict release reviewer.',
          `Task: ${input.task.trim().slice(0, 8000)}`,
          `Production route: ${input.visualPlan.route}.`,
          `Locked elements: ${JSON.stringify(input.visualPlan.lockedElements.slice(0, 64))}`,
          `Model-owned elements: ${JSON.stringify(input.visualPlan.modelOwnedElements.slice(0, 64))}`,
          `Unresolved context: ${JSON.stringify(input.visualPlan.unresolvedContext.slice(0, 64))}`,
          `Release ceiling: ${input.visualPlan.releaseCeiling}.`,
          'Inspect semantic correctness and visible quality, including overlap, clipping, illegible text, broken connectors, hierarchy, whitespace, alignment, contrast, and whether the artifact actually satisfies the task.',
          'Return JSON only with: {"pass":boolean,"needsContext":boolean,"score":number,"summary":string,"violations":string[],"repairInstructions":string[]}.',
          'Set needsContext=true only when correctness cannot be assessed or repaired without specific missing external information; visible layout or rendering defects alone are repairable draft issues, not missing context.',
          'A severe overlap, clipping, unreadable label, invented or missing locked fact, or visibly broken layout must set pass=false.'
        ].join('\n')
      },
      {
        type: 'input_image',
        image_url: await imageDataUrl(input.outputPath),
        mime_type: imageMimeType(input.outputPath)
      }
    ]
    if (input.referencePath) {
      content.push({
        type: 'input_text',
        text: 'Reference image for style/composition comparison:'
      }, {
        type: 'input_image',
        image_url: await imageDataUrl(input.referencePath),
        mime_type: imageMimeType(input.referencePath)
      })
    }
    const response = await fetch(endpoint.baseUrl + '/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + endpoint.apiKey
      },
      body: JSON.stringify({
        model: endpoint.model,
        input: [{ role: 'user', content }]
      })
    })
    const payload = await parseProviderJson(response, 'Model Router visual review')
    if (!response.ok) {
      return {
        ok: false,
        status: 'vision_review_unavailable',
        message: providerHttpError('Model Router visual review', response.status, payload)
      }
    }
    const text = responseOutputText(payload)
    const parsed = parseVisualReviewJson(text)
    if (!parsed) {
      return {
        ok: false,
        status: 'vision_review_invalid',
        message: 'Model Router visual review returned an invalid semantic review payload.'
      }
    }
    return parsed
  } catch (error) {
    return {
      ok: false,
      status: 'vision_review_unavailable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function imageDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path)
  return `data:${imageMimeType(path)};base64,${bytes.toString('base64')}`
}

function imageMimeType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

function responseOutputText(payload: Record<string, any>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const chunks: string[] = []
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      const value = typeof content?.text === 'string'
        ? content.text
        : typeof content?.output_text === 'string'
          ? content.output_text
          : ''
      if (value) chunks.push(value)
    }
  }
  return chunks.join('\n')
}

function parseVisualReviewJson(text: string): Extract<ModelRouterVisualReview, { ok: true }> | null {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      value = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  const record = asRecord(value)
  if (typeof record.pass !== 'boolean' || typeof record.score !== 'number' || !Number.isFinite(record.score)) return null
  const summary = stringValue(record.summary)
  if (!summary) return null
  const violations = stringArray(record.violations)
  const repairInstructions = stringArray(record.repairInstructions)
  return {
    ok: true,
    pass: record.pass,
    needsContext: record.needsContext === true,
    score: clamp01(record.score),
    summary,
    violations,
    repairInstructions
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function providerKind(): 'image-endpoint' | 'placeholder' {
  return Boolean(configuredModelRouterImageEndpoint())
    ? 'image-endpoint'
    : 'placeholder'
}

function providerKindForReadOnly(warnings: string[]): 'image-endpoint' | 'placeholder' {
  try {
    return providerKind()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error))
    return 'placeholder'
  }
}

async function renderWithProvider(input: ProviderRenderInput): Promise<ProviderRenderResult> {
  const controlledEditResult = await renderControlledImageEdit(input)
  if (controlledEditResult) return controlledEditResult

  if (providerKind() === 'image-endpoint') {
    try {
      await renderWithConfiguredImageEndpoint(input)
      return { provider: 'image-endpoint', placeholder: false, warnings: [] }
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : String(error))
    }
  }
  if (input.editIntent?.sourcePath) {
    throw new ProviderNotConfiguredError(
      'This visual-review instruction requires an image-edit capable model. Configure an image model in Settings; semantic image edits never fall back to copying or placeholder rendering.'
    )
  }
  if (!allowPlaceholderProvider()) {
    throw new ProviderNotConfiguredError(
      'Image model is not configured. Configure an image model in Settings before using text-to-image generation or visual-review image edits.'
    )
  }
  await renderPlaceholder(input)
  return {
    provider: 'placeholder',
    placeholder: true,
    warnings: ['Rendered with placeholder provider because SCIFORGE_IMAGE_ALLOW_PLACEHOLDER=1 is set and no Model Router image endpoint is configured.']
  }
}

async function renderControlledImageEdit(input: ProviderRenderInput): Promise<ProviderRenderResult | null> {
  const intent = input.editIntent
  if (!intent?.sourcePath) return null
  if (intent.mode !== 'style_transfer' || !isColorEditInstruction(intent.instruction)) return null

  const sourcePath = await resolveWorkspacePath(input.workspaceRoot, intent.sourcePath)
  const source = await loadImage(sourcePath)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyControlledColorEdit(imageData.data, intent.instruction)
  ctx.putImageData(imageData, 0, 0)

  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
  return {
    provider: 'controlled-edit',
    placeholder: false,
    warnings: ['Applied a source-preserving controlled color edit; layout, text, and composition were kept from the original image.']
  }
}

function isColorEditInstruction(instruction: string): boolean {
  return /color|colour|palette|tone|hue|tint|theme|recolor|配色|颜色|色彩|色调|换色|改色|换个颜色|换颜色|调色/i.test(instruction)
}

function applyControlledColorEdit(data: Uint8ClampedArray, instruction: string): void {
  const targetHue = preferredHueFromInstruction(instruction)
  const genericHueShift = 54 / 360

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 16) continue

    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const hsl = rgbToHsl(r, g, b)

    // Keep black/gray text, white backgrounds, and thin axis marks readable.
    if (hsl.l < 0.12 || hsl.l > 0.94 || hsl.s < 0.08) continue

    const nextHue = targetHue ?? ((hsl.h + genericHueShift) % 1)
    const nextSaturation = clamp01(Math.max(0.22, hsl.s * 1.12))
    const nextLightness = clamp01(0.08 + hsl.l * 0.9)
    const [nextR, nextG, nextB] = hslToRgb(nextHue, nextSaturation, nextLightness)

    data[i] = Math.round(nextR * 255)
    data[i + 1] = Math.round(nextG * 255)
    data[i + 2] = Math.round(nextB * 255)
  }
}

function preferredHueFromInstruction(instruction: string): number | undefined {
  const text = instruction.toLowerCase()
  if (/red|红/.test(text)) return 0 / 360
  if (/orange|橙/.test(text)) return 30 / 360
  if (/yellow|黄/.test(text)) return 52 / 360
  if (/green|绿/.test(text)) return 135 / 360
  if (/cyan|teal|青|湖蓝/.test(text)) return 180 / 360
  if (/blue|蓝/.test(text)) return 215 / 360
  if (/purple|violet|紫/.test(text)) return 275 / 360
  if (/pink|rose|粉/.test(text)) return 330 / 360
  return undefined
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h = 0
  if (max === r) h = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return { h: h / 6, s, l }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3)
  ]
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t
  if (value < 0) value += 1
  if (value > 1) value -= 1
  if (value < 1 / 6) return p + (q - p) * 6 * value
  if (value < 1 / 2) return q
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
  return p
}

function allowPlaceholderProvider(): boolean {
  return process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER === '1'
}

async function renderWithConfiguredImageEndpoint(input: ProviderRenderInput): Promise<void> {
  const endpoint = configuredModelRouterImageEndpoint()
  if (!endpoint) throw new ProviderError('Missing Model Router image endpoint configuration.')
  const prompt = input.recipe
    ? providerPromptForRecipe(input.recipe)
    : providerPromptForEditIntent(input.editIntent)
  const editSourcePath = input.editIntent?.sourcePath
    ? await resolveWorkspacePath(input.workspaceRoot, input.editIntent.sourcePath)
    : undefined
  const recipeReferencePath = input.recipe?.referencePath
    ? await resolveWorkspacePath(input.workspaceRoot, input.recipe.referencePath)
    : undefined
  const editSource = editSourcePath ? await loadImage(editSourcePath) : undefined
  const size = input.recipe?.size ?? (editSource
    ? { width: editSource.width, height: editSource.height }
    : DEFAULT_SIZE)
  const errors: string[] = []
  for (const candidateBaseUrl of imageEndpointBaseUrlCandidates(endpoint.baseUrl)) {
    try {
      const providerInput = {
        apiKey: endpoint.apiKey,
        // The local Model Router exposes one public model alias. Recipe model
        // metadata describes the internal generator, but must never bypass the
        // Router alias validation. Provider model selection stays inside Model Router.
        model: endpoint.model,
        prompt,
        size,
        outputPath: input.outputPath
      }
      if (input.editIntent?.sourcePath && editSourcePath) {
        const maskPath = input.editIntent.maskPath
          ? await resolveWorkspacePath(input.workspaceRoot, input.editIntent.maskPath)
          : undefined
        const generatedMask = maskPath || !input.editIntent.selectedRegions?.length
          ? undefined
          : createVisualReviewEditMask(editSource!.width, editSource!.height, input.editIntent.selectedRegions)
        await renderWithImageEditEndpoint(candidateBaseUrl, {
          ...providerInput,
          sourcePath: editSourcePath,
          maskPath,
          generatedMask
        })
        await compositeImageEditWithMask(editSourcePath, input.outputPath, { maskPath, generatedMask })
        await assertImageEditChangedPixels(editSourcePath, input.outputPath, { maskPath, generatedMask })
      } else if (input.recipe?.referencePath && recipeReferencePath) {
        await renderWithImageEditEndpoint(candidateBaseUrl, {
          ...providerInput,
          sourcePath: recipeReferencePath
        })
      } else {
        await renderWithImageEndpoint(candidateBaseUrl, providerInput)
      }
      return
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new ProviderError(errors.find(Boolean) ?? 'Image provider did not return an image.')
}

async function renderWithImageEditEndpoint(
  baseUrl: string,
  input: {
    apiKey: string
    model: string
    prompt: string
    size: ImageSize
    outputPath: string
    sourcePath: string
    maskPath?: string
    generatedMask?: File
  }
): Promise<void> {
  const form = new FormData()
  form.set('model', input.model)
  form.set('prompt', [
    input.prompt,
    '',
    'Edit the supplied source image in place. Apply only the requested changes and preserve all unmentioned content, labels, geometry, and visual identity.'
  ].join('\n'))
  form.set('size', input.size.width + 'x' + input.size.height)
  form.set('n', '1')
  form.set('input_fidelity', 'high')
  form.set('quality', 'high')
  form.set('image', await imageFileForForm(input.sourcePath))
  if (input.maskPath) form.set('mask', await imageFileForForm(input.maskPath))
  else if (input.generatedMask) form.set('mask', input.generatedMask)

  const response = await fetch(baseUrl + '/images/edits', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + input.apiKey },
    body: form
  })
  const payload = await parseProviderJson(response, 'Image edit endpoint')
  if (!response.ok) throw new ProviderError(providerHttpError('Image edit endpoint', response.status, payload))
  const first = payload.data?.[0]
  if (await writeProviderImage(first, input.outputPath)) return
  throw new ProviderError('Image edit endpoint response did not include b64_json or a data URL.')
}

async function imageFileForForm(path: string): Promise<File> {
  const bytes = await readFile(path)
  return new File([new Uint8Array(bytes)], basename(path), { type: imageMimeType(path) })
}

async function compositeImageEditWithMask(
  sourcePath: string,
  outputPath: string,
  mask?: { maskPath?: string; generatedMask?: File }
): Promise<void> {
  const maskImage = await loadImageEditMask(mask)
  if (!maskImage) return
  const [source, providerOutput] = await Promise.all([loadImage(sourcePath), loadImage(outputPath)])
  if (providerOutput.width !== source.width || providerOutput.height !== source.height) {
    await unlink(outputPath).catch(() => undefined)
    throw new ProviderError(
      `Image edit provider returned ${providerOutput.width}x${providerOutput.height}; expected the source size ${source.width}x${source.height}. No candidate was created.`
    )
  }
  if (maskImage.width !== source.width || maskImage.height !== source.height) {
    await unlink(outputPath).catch(() => undefined)
    throw new ProviderError(
      `Image edit mask is ${maskImage.width}x${maskImage.height}; expected the source size ${source.width}x${source.height}. No candidate was created.`
    )
  }
  const sourceCanvas = createCanvas(source.width, source.height)
  const providerCanvas = createCanvas(providerOutput.width, providerOutput.height)
  const maskCanvas = createCanvas(maskImage.width, maskImage.height)
  const sourceContext = sourceCanvas.getContext('2d')
  const providerContext = providerCanvas.getContext('2d')
  const maskContext = maskCanvas.getContext('2d')
  sourceContext.drawImage(source, 0, 0)
  providerContext.drawImage(providerOutput, 0, 0)
  maskContext.drawImage(maskImage, 0, 0)
  const sourceImageData = sourceContext.getImageData(0, 0, source.width, source.height)
  const providerPixels = providerContext.getImageData(0, 0, providerOutput.width, providerOutput.height).data
  const maskPixels = maskContext.getImageData(0, 0, maskImage.width, maskImage.height).data
  for (let index = 0; index < sourceImageData.data.length; index += 4) {
    const preservedWeight = maskPixels[index + 3] / 255
    const editedWeight = 1 - preservedWeight
    for (let channel = 0; channel < 4; channel += 1) {
      sourceImageData.data[index + channel] = Math.round(
        sourceImageData.data[index + channel] * preservedWeight + providerPixels[index + channel] * editedWeight
      )
    }
  }
  sourceContext.putImageData(sourceImageData, 0, 0)
  await writeFile(outputPath, sourceCanvas.toBuffer('image/png'))
}

async function loadImageEditMask(
  mask?: { maskPath?: string; generatedMask?: File }
): Promise<Awaited<ReturnType<typeof loadImage>> | undefined> {
  if (mask?.maskPath) return loadImage(mask.maskPath)
  if (mask?.generatedMask) return loadImage(Buffer.from(await mask.generatedMask.arrayBuffer()))
  return undefined
}

function createVisualReviewEditMask(width: number, height: number, regions: ImageEditRegion[]): File {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  const padding = Math.max(
    EDIT_MASK_MIN_CONTEXT_PIXELS,
    Math.min(EDIT_MASK_MAX_CONTEXT_PIXELS, Math.round(Math.min(width, height) * EDIT_MASK_CONTEXT_FRACTION))
  )
  for (const region of regions) {
    const bounds = editRegionPixelBounds(region, width, height)
    if (!bounds) continue
    const left = Math.max(0, Math.floor(bounds.left - padding))
    const top = Math.max(0, Math.floor(bounds.top - padding))
    const right = Math.min(width, Math.ceil(bounds.right + padding))
    const bottom = Math.min(height, Math.ceil(bounds.bottom + padding))
    if (right > left && bottom > top) context.clearRect(left, top, right - left, bottom - top)
  }
  const bytes = canvas.toBuffer('image/png')
  return new File([new Uint8Array(bytes)], 'visual-review-mask.png', { type: 'image/png' })
}

function editRegionPixelBounds(
  region: ImageEditRegion,
  width: number,
  height: number
): { left: number; top: number; right: number; bottom: number } | undefined {
  if (region.kind === 'box') {
    return {
      left: region.bounds.x * width,
      top: region.bounds.y * height,
      right: (region.bounds.x + region.bounds.width) * width,
      bottom: (region.bounds.y + region.bounds.height) * height
    }
  }
  const points = region.kind === 'pin'
    ? [region.point]
    : region.kind === 'arrow'
      ? [region.from, region.to]
      : region.points
  if (!points.length) return undefined
  const xs = points.map((point) => point.x * width)
  const ys = points.map((point) => point.y * height)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  }
}

async function assertImageEditChangedPixels(
  sourcePath: string,
  outputPath: string,
  mask?: { maskPath?: string; generatedMask?: File }
): Promise<void> {
  const [source, output] = await Promise.all([loadImage(sourcePath), loadImage(outputPath)])
  if (source.width !== output.width || source.height !== output.height) {
    await unlink(outputPath).catch(() => undefined)
    throw new ProviderError(
      `Image edit provider returned ${output.width}x${output.height}; expected the source size ${source.width}x${source.height}. No candidate was created.`
    )
  }
  const sourceCanvas = createCanvas(source.width, source.height)
  const outputCanvas = createCanvas(output.width, output.height)
  const sourceContext = sourceCanvas.getContext('2d')
  const outputContext = outputCanvas.getContext('2d')
  sourceContext.drawImage(source, 0, 0)
  outputContext.drawImage(output, 0, 0)
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height).data
  const outputPixels = outputContext.getImageData(0, 0, output.width, output.height).data
  if (Buffer.from(sourcePixels).equals(Buffer.from(outputPixels))) {
    await unlink(outputPath).catch(() => undefined)
    throw new ProviderError('Image edit provider returned a pixel-identical result; no candidate was created.')
  }
  const maskImage = await loadImageEditMask(mask)
  if (!maskImage) return
  if (maskImage.width !== source.width || maskImage.height !== source.height) {
    await unlink(outputPath).catch(() => undefined)
    throw new ProviderError(
      `Image edit mask is ${maskImage.width}x${maskImage.height}; expected the source size ${source.width}x${source.height}. No candidate was created.`
    )
  }
  const maskCanvas = createCanvas(maskImage.width, maskImage.height)
  const maskContext = maskCanvas.getContext('2d')
  maskContext.drawImage(maskImage, 0, 0)
  const maskPixels = maskContext.getImageData(0, 0, maskImage.width, maskImage.height).data
  let protectedPixels = 0
  let materiallyChangedProtectedPixels = 0
  for (let index = 0; index < maskPixels.length; index += 4) {
    if (maskPixels[index + 3] < 250) continue
    protectedPixels += 1
    const redDelta = Math.abs(sourcePixels[index] - outputPixels[index])
    const greenDelta = Math.abs(sourcePixels[index + 1] - outputPixels[index + 1])
    const blueDelta = Math.abs(sourcePixels[index + 2] - outputPixels[index + 2])
    const alphaDelta = Math.abs(sourcePixels[index + 3] - outputPixels[index + 3])
    const maxDelta = Math.max(redDelta, greenDelta, blueDelta, alphaDelta)
    const meanDelta = (redDelta + greenDelta + blueDelta + alphaDelta) / 4
    if (maxDelta >= PROTECTED_PIXEL_MAX_CHANNEL_DELTA && meanDelta >= PROTECTED_PIXEL_MEAN_CHANNEL_DELTA) {
      materiallyChangedProtectedPixels += 1
    }
  }
  const driftFraction = protectedPixels ? materiallyChangedProtectedPixels / protectedPixels : 0
  if (driftFraction <= MAX_PROTECTED_REGION_DRIFT_FRACTION) return
  await unlink(outputPath).catch(() => undefined)
  throw new ProviderError(
    `Image edit changed ${(driftFraction * 100).toFixed(1)}% of mask-protected pixels; the maximum allowed material drift is ${(MAX_PROTECTED_REGION_DRIFT_FRACTION * 100).toFixed(1)}%. No candidate was created.`
  )
}

function configuredModelRouterImageEndpoint(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY?.trim()
  const rawBaseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL?.trim()
  const baseUrl = rawBaseUrl ? normalizeLocalModelRouterV1BaseUrl(rawBaseUrl) : ''
  if (!apiKey || !baseUrl) return null
  return {
    apiKey,
    baseUrl,
    model: process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL?.trim() || 'sciforge-router'
  }
}

function imageEndpointBaseUrlCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) return []
  const candidates = normalized.endsWith('/v1')
    ? [normalized]
    : [normalized + '/v1', normalized]
  return [...new Set(candidates)]
}

function normalizeLocalModelRouterV1BaseUrl(rawBaseUrl: string): string {
  let url: URL
  try {
    url = new URL(rawBaseUrl)
  } catch {
    throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  if (url.username || url.password || url.search || url.hash) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  if (!isAllowedLocalModelRouterHost(url.hostname)) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  const path = url.pathname.replace(/\/+$/, '')
  if (path && path !== '/v1') throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  return url.origin + '/v1'
}

function isAllowedLocalModelRouterHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

function modelRouterAlias(): string {
  return process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL?.trim() || DEFAULT_MODEL_ROUTER_ALIAS
}

async function renderWithImageEndpoint(
  baseUrl: string,
  input: {
    apiKey: string
    model: string
    prompt: string
    size: ImageSize
    outputPath: string
  }
): Promise<void> {
  let response = await fetchOpenAiImagesEndpoint(baseUrl, input, 'prompt')
  let payload = await parseProviderJson(response, 'Image endpoint')

  if (!response.ok && shouldRetryImagesEndpointWithTextPayload(response.status, payload)) {
    response = await fetchOpenAiImagesEndpoint(baseUrl, input, 'text')
    payload = await parseProviderJson(response, 'Image endpoint')
  }

  if (!response.ok) throw new ProviderError(providerHttpError('Image endpoint', response.status, payload))
  const first = payload.data?.[0]
  if (await writeProviderImage(first, input.outputPath)) return
  throw new ProviderError('Image endpoint response did not include b64_json or a data URL.')
}

async function fetchOpenAiImagesEndpoint(
  baseUrl: string,
  input: {
    apiKey: string
    model: string
    prompt: string
    size: ImageSize
  },
  promptField: 'prompt' | 'text'
): Promise<Response> {
  return fetch(baseUrl + '/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + input.apiKey
    },
    body: JSON.stringify({
      model: input.model,
      [promptField]: input.prompt,
      size: input.size.width + 'x' + input.size.height,
      n: 1
    })
  })
}

function shouldRetryImagesEndpointWithTextPayload(status: number, payload: Record<string, any>): boolean {
  if (status !== 400) return false
  const message = (stringValue(asRecord(payload.error).message) ?? '').toLowerCase()
  return message.includes('text') && message.includes('image') && message.includes('provided')
}

async function parseProviderJson(
  response: Response,
  endpointName: string
): Promise<Record<string, any>> {
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown content-type'
    throw new ProviderError(
      endpointName + ' returned non-JSON ' + contentType + ': ' + text.replace(/\s+/g, ' ').slice(0, 180)
    )
  }
}

function providerHttpError(endpointName: string, status: number, payload: Record<string, any>): string {
  const error = asRecord(payload.error)
  const message = stringValue(error.message) ?? JSON.stringify(payload).slice(0, 500)
  return endpointName + ' returned HTTP ' + status + ': ' + message
}

async function writeProviderImage(value: unknown, outputPath: string): Promise<boolean> {
  const record = asRecord(value)
  const b64Json = stringValue(record.b64_json)
  if (b64Json) {
    await writeFile(outputPath, Buffer.from(b64Json, 'base64'))
    return true
  }
  const url = stringValue(record.url) ??
    stringValue(asRecord(record.image_url).url) ??
    stringValue(asRecord(record.image).url)
  if (url) return writeProviderImageUrl(url, outputPath)

  const dataUri = findImageDataUri(value)
  if (dataUri) {
    await writeFile(outputPath, Buffer.from(dataUri.base64, 'base64'))
    return true
  }

  const content = record.content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (await writeProviderImage(item, outputPath)) return true
    }
  }
  const images = record.images
  if (Array.isArray(images)) {
    for (const item of images) {
      if (await writeProviderImage(item, outputPath)) return true
    }
  }
  return false
}

async function writeProviderImageUrl(url: string, outputPath: string): Promise<boolean> {
  if (url.startsWith('data:')) {
    const dataUri = findImageDataUri(url)
    if (!dataUri) return false
    await writeFile(outputPath, Buffer.from(dataUri.base64, 'base64'))
    return true
  }
  throw new ProviderError('Model Router returned a non-normalized image URL. Image workers only accept b64_json or data URLs.')
}

function findImageDataUri(value: unknown): { base64: string } | null {
  if (typeof value === 'string') {
    const match = value.match(/data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)/i)
    return match ? { base64: match[1] } : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageDataUri(item)
      if (found) return found
    }
    return null
  }
  const record = asRecord(value)
  for (const item of Object.values(record)) {
    const found = findImageDataUri(item)
    if (found) return found
  }
  return null
}

async function renderPlaceholder(input: ProviderRenderInput): Promise<void> {
  const size = input.recipe?.size ?? DEFAULT_SIZE
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, size.width, size.height)
  gradient.addColorStop(0, '#f8fafc')
  gradient.addColorStop(0.48, '#dbeafe')
  gradient.addColorStop(1, '#eef2ff')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.fillStyle = '#1e293b'
  ctx.font = '700 ' + Math.max(24, Math.floor(size.width / 26)) + 'px sans-serif'
  ctx.fillText(input.editIntent ? 'SciForge Image Edit' : 'SciForge Image Generation', 48, 82)
  ctx.font = Math.max(16, Math.floor(size.width / 52)) + 'px sans-serif'
  ctx.fillStyle = '#334155'
  const text = input.recipe?.prompt ?? input.editIntent?.instruction ?? 'No prompt supplied.'
  drawWrappedText(ctx, text, 48, 140, size.width - 96, Math.max(24, Math.floor(size.width / 36)))
  if (input.editIntent?.sourcePath) {
    try {
      const sourcePath = await resolveWorkspacePath(input.workspaceRoot, input.editIntent.sourcePath)
      const source = await loadImage(sourcePath)
      const thumbW = Math.floor(size.width * 0.34)
      const thumbH = Math.floor(thumbW * source.height / Math.max(1, source.width))
      ctx.globalAlpha = 0.86
      ctx.drawImage(source, size.width - thumbW - 48, size.height - thumbH - 48, thumbW, thumbH)
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 3
      ctx.strokeRect(size.width - thumbW - 48, size.height - thumbH - 48, thumbW, thumbH)
    } catch {
      // Source thumbnails are best-effort only for placeholder renders.
    }
  }
  const buffer = canvas.toBuffer('image/png')
  await writeFile(input.outputPath, buffer)
}

function drawWrappedText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let cursorY = y
  for (const word of words) {
    const next = line ? line + ' ' + word : word
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY)
      line = word
      cursorY += lineHeight
    } else {
      line = next
    }
  }
  if (line) ctx.fillText(line, x, cursorY)
}

function normalizeRecipe(recipe: ImageGenerationRecipe, warnings: string[]): ImageGenerationRecipe {
  if (!recipe || typeof recipe !== 'object') throw new Error('recipe is required.')
  const prompt = enhanceImageGenerationPrompt(recipe.prompt?.trim() ?? '', recipe.stylePreset)
  if (!prompt) throw new Error('recipe.prompt is required.')
  return {
    mode: recipe.mode ?? 'text_to_image',
    prompt,
    ...(recipe.negativePrompt?.trim() ? { negativePrompt: recipe.negativePrompt.trim() } : {}),
    size: normalizeSize(recipe.size, warnings),
    ...(recipe.stylePreset?.trim() ? { stylePreset: recipe.stylePreset.trim() } : {}),
    ...(recipe.referencePath?.trim() ? { referencePath: recipe.referencePath.trim() } : {}),
    outputFormat: recipe.outputFormat ?? 'png',
    ...(recipe.intent ? { intent: recipe.intent } : {}),
    ...(recipe.drawingBrief ? { drawingBrief: recipe.drawingBrief } : {}),
    ...(recipe.diagramSpec ? { diagramSpec: recipe.diagramSpec } : {}),
    ...(recipe.frameworkDesignPlan ? { frameworkDesignPlan: recipe.frameworkDesignPlan } : {}),
    ...(recipe.frameworkRegionAssetMode ? { frameworkRegionAssetMode: recipe.frameworkRegionAssetMode } : {}),
    ...(recipe.confirmation ? { confirmation: recipe.confirmation } : {}),
    ...(recipe.promptProfile ? { promptProfile: recipe.promptProfile } : {}),
    visualPlan: recipe.visualPlan
  }
}

function providerPromptForRecipe(recipe: ImageGenerationRecipe): string {
  const prompt = recipe.prompt.trim()
  const contextLimitInstruction = recipe.visualPlan.releaseCeiling === 'draft_ready'
    ? [
        'Context-limited draft mode: do not invent answers for unresolved context.',
        `Unresolved context: ${recipe.visualPlan.unresolvedContext.join('; ') || 'unspecified required context'}.`,
        'Omit, leave a clear placeholder for, or explicitly mark any content that depends on those unresolved questions.'
      ].join(' ')
    : undefined
  const ownershipInstruction = recipe.visualPlan.route === 'hybrid'
    ? [
        'Hybrid visual-layer mode: render only the model-owned elements declared below.',
        `Model-owned elements: ${recipe.visualPlan.modelOwnedElements.join('; ') || 'none'}.`,
        `Locked elements: ${recipe.visualPlan.lockedElements.join('; ') || 'none'}.`,
        'Do not redraw, replace, label, or reinterpret locked elements; deterministic composition will add them from source artifacts.'
      ].join(' ')
    : undefined
  const controlledPrompt = ownershipInstruction
    ? prompt + '\n\n' + ownershipInstruction
    : prompt
  return contextLimitInstruction
    ? controlledPrompt + '\n\n' + contextLimitInstruction
    : controlledPrompt
}

function providerPromptForEditIntent(intent: ImageEditIntent | undefined): string {
  return intent?.instruction.trim() ?? ''
}

function normalizeSize(size: Partial<ImageSize> | undefined, warnings: string[]): ImageSize {
  const width = clampInteger(size?.width ?? DEFAULT_SIZE.width, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE)
  const height = clampInteger(size?.height ?? DEFAULT_SIZE.height, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE)
  if (size?.width !== undefined && width !== size.width) warnings.push('Requested width was clamped to supported range.')
  if (size?.height !== undefined && height !== size.height) warnings.push('Requested height was clamped to supported range.')
  const providerWidth = alignImageSize(width)
  const providerHeight = alignImageSize(height)
  if (providerWidth !== width || providerHeight !== height) {
    warnings.push(
      'Requested image size was adjusted to ' + providerWidth + 'x' + providerHeight + ' for image-provider compatibility.'
    )
  }
  return { width: providerWidth, height: providerHeight }
}

function alignImageSize(value: number): number {
  const aligned = Math.floor(value / IMAGE_SIZE_GRANULARITY) * IMAGE_SIZE_GRANULARITY
  return Math.max(MIN_IMAGE_SIZE, Math.min(MAX_IMAGE_SIZE, aligned || MIN_IMAGE_SIZE))
}

async function resolveOutputDir(workspaceRoot: string, outputDir?: string): Promise<string> {
  const dir = outputDir?.trim() || IMAGE_DIR
  const resolved = isAbsolute(dir) ? resolve(dir) : resolve(workspaceRoot, dir)
  ensureInsideWorkspace(workspaceRoot, resolved)
  return resolved
}

async function resolveWorkspacePath(workspaceRoot: string, rawPath: string): Promise<string> {
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath)
  ensureInsideWorkspace(workspaceRoot, resolved)
  return resolved
}

function assertWorkspaceRoot(workspaceRoot: string | undefined): string {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!root) throw new WorkspaceError('workspaceRoot is required.')
  return root
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string | undefined {
  const root = workspaceRoot?.trim()
  return root ? resolve(root) : undefined
}

function ensureInsideWorkspace(workspaceRoot: string, path: string): void {
  const relativePath = relative(workspaceRoot, path)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new WorkspaceError('Path escapes workspaceRoot: ' + path)
  }
}

async function writeImageArtifactManifest(input: {
  workspaceRoot: string
  artifactId: string
  artifactKind: 'generated_image' | 'edited_image'
  sourceTool: 'image_generation'
  outputPath: string
  outputHash?: string
  manifestPath: string
  sourcePath?: string
  referencePath?: string
  visualDocumentId?: string
  threadId?: string
  stageForVisualReview?: boolean
  title: string
  intent?: ImageDrawingIntent
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  componentSegmentationPath?: string
  fastSamSegmentationPath?: string
  fastSamBoxlibPath?: string
  componentSegmentationPreviewPath?: string
  fastSamPreviewPath?: string
  frameworkComponentManifestPath?: string
  componentBasePath?: string
  componentAssetPaths?: string[]
  promptProfile?: ImageGenerationRecipe['promptProfile']
  visualPlan?: ImageGenerationRecipe['visualPlan']
}): Promise<string> {
  const artifactsDir = join(input.workspaceRoot, ARTIFACT_DIR)
  await mkdir(artifactsDir, { recursive: true })
  const artifactManifestPath = join(artifactsDir, input.artifactId + '.' + input.artifactKind.replace('_', '-') + '.artifact.json')
  await writeJson(artifactManifestPath, {
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: input.sourceTool,
    artifactKind: input.artifactKind,
    workspaceRoot: input.workspaceRoot,
    path: input.outputPath,
    outputPath: input.outputPath,
    ...(input.outputHash ? { outputHash: input.outputHash } : {}),
    manifestPath: input.manifestPath,
    ...(input.visualDocumentId ? { visualDocumentId: input.visualDocumentId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.stageForVisualReview !== undefined ? { stageForVisualReview: input.stageForVisualReview } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    ...(input.referencePath ? { referencePath: input.referencePath } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.diagramSpecPath ? { diagramSpecPath: input.diagramSpecPath } : {}),
    ...(input.frameworkDesignPlanPath ? { frameworkDesignPlanPath: input.frameworkDesignPlanPath } : {}),
    ...(input.diagramLayerManifestPath ? { diagramLayerManifestPath: input.diagramLayerManifestPath } : {}),
    ...(input.componentSegmentationPath ? { componentSegmentationPath: input.componentSegmentationPath } : {}),
    ...(input.fastSamSegmentationPath ? { fastSamSegmentationPath: input.fastSamSegmentationPath } : {}),
    ...(input.fastSamBoxlibPath ? { fastSamBoxlibPath: input.fastSamBoxlibPath } : {}),
    ...(input.componentSegmentationPreviewPath ? { componentSegmentationPreviewPath: input.componentSegmentationPreviewPath } : {}),
    ...(input.fastSamPreviewPath ? { fastSamPreviewPath: input.fastSamPreviewPath } : {}),
    ...(input.frameworkComponentManifestPath ? { frameworkComponentManifestPath: input.frameworkComponentManifestPath } : {}),
    ...(input.componentBasePath ? { componentBasePath: input.componentBasePath } : {}),
    ...(input.componentAssetPaths?.length ? { componentAssetPaths: input.componentAssetPaths } : {}),
    ...(input.promptProfile ? { promptProfile: input.promptProfile } : {}),
    ...(input.visualPlan ? { visualPlan: input.visualPlan } : {}),
    title: input.title,
    ...(input.visualPlan ? { releaseCeiling: input.visualPlan.releaseCeiling } : {})
  })
  return artifactManifestPath
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function loadReviewPacket(request: ImageGenerationEditFromVisualReviewPacketRequest, workspaceRoot: string): Promise<unknown> {
  if (request.reviewPacket) return request.reviewPacket
  if (!request.reviewPacketPath?.trim()) throw new Error('reviewPacket or reviewPacketPath is required.')
  const packetPath = await resolveWorkspacePath(workspaceRoot, request.reviewPacketPath)
  return JSON.parse(await readFile(packetPath, 'utf8'))
}

function extractEditIntents(
  packet: unknown,
  workspaceRoot: string,
  warnings: string[],
  explicitMaskPath?: string
): ImageEditIntent[] {
  const record = asRecord(packet)
  if (record.schemaVersion !== 1) {
    warnings.push('Skipped unsupported VisualDocument review packet schema.')
    return []
  }
  const artifact = asRecord(record.sourceArtifact)
  if (!isImageArtifactKind(String(artifact.kind ?? ''))) {
    warnings.push('VisualDocument review packet does not target an image artifact.')
    return []
  }
  const sourcePath = stringValue(artifact.workingCopyPath) ?? stringValue(artifact.sourcePath)
  const annotations = Array.isArray(record.annotations)
    ? record.annotations.map(asRecord).filter((annotation) => annotation.status !== 'resolved')
    : []
  if (!sourcePath || annotations.length === 0) return []
  try {
    ensureInsideWorkspace(workspaceRoot, isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(workspaceRoot, sourcePath))
  } catch (error) {
    warnings.push('Skipped image edit target outside workspace: ' + (error instanceof Error ? error.message : String(error)))
    return []
  }
  const truthLocks = Array.isArray(record.truthLocks)
    ? record.truthLocks.map(asRecord).map((lock) => stringValue(lock.description)).filter((value): value is string => Boolean(value))
    : []
  const styleProfileRef = stringValue(record.styleProfileRef)
  const requestedInstructions = annotations.map((annotation) => (
    stringValue(annotation.instruction) ?? 'Apply this visual-review annotation.'
  ))
  const selectedRegions = annotations
    .map((annotation) => normalizedReviewRegion(annotation.geometry))
    .filter((region): region is ImageEditRegion => Boolean(region))
  const annotationInstructions = annotations.map((annotation, index) => {
    const instruction = requestedInstructions[index] ?? 'Apply this visual-review annotation.'
    return `${index + 1}. annotation=${stringValue(annotation.id) ?? `annotation-${index + 1}`} region=${JSON.stringify(annotation.geometry ?? null)} instruction=${instruction}`
  })
  const instruction = [
    'Create one non-destructive candidate that applies every human visual-review annotation to the source image.',
    ...annotationInstructions,
    ...(truthLocks.length ? [`Preserve these truth-locked elements exactly: ${truthLocks.join('; ')}`] : []),
    ...(styleProfileRef ? [`Use the VisualStyleProfile at ${styleProfileRef} as the style constraint.`] : [])
  ].join('\n')
  return [{
    mode: requestedInstructions.every(isColorEditInstruction) ? 'style_transfer' : 'replace',
    sourcePath,
    instruction,
    ...(explicitMaskPath?.trim() ? { maskPath: explicitMaskPath.trim() } : {}),
    ...(selectedRegions.length ? { selectedRegions } : {}),
    annotationIds: annotations.map((annotation, index) => stringValue(annotation.id) ?? `annotation-${index + 1}`),
    targetNodeIds: [...new Set(annotations.flatMap((annotation) => (
      Array.isArray(annotation.targetNodeIds) ? annotation.targetNodeIds.map(stringValue).filter((value): value is string => Boolean(value)) : []
    )))],
    preserve: ['composition', 'layout']
  }]
}

function normalizedReviewRegion(value: unknown): ImageEditRegion | undefined {
  const geometry = asRecord(value)
  if (geometry.kind === 'box') {
    const bounds = asRecord(geometry.bounds)
    const x = normalizedCoordinate(bounds.x)
    const y = normalizedCoordinate(bounds.y)
    const width = finiteNumber(bounds.width)
    const height = finiteNumber(bounds.height)
    if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) return undefined
    return {
      kind: 'box',
      bounds: { x, y, width: Math.min(1 - x, width), height: Math.min(1 - y, height) }
    }
  }
  if (geometry.kind === 'pin') {
    const point = normalizedPoint(geometry.point)
    return point ? { kind: 'pin', point } : undefined
  }
  if (geometry.kind === 'arrow') {
    const from = normalizedPoint(geometry.from)
    const to = normalizedPoint(geometry.to)
    return from && to ? { kind: 'arrow', from, to } : undefined
  }
  if (geometry.kind === 'freehand' && Array.isArray(geometry.points)) {
    const points = geometry.points.map(normalizedPoint).filter((point): point is { x: number; y: number } => Boolean(point))
    return points.length ? { kind: 'freehand', points } : undefined
  }
  return undefined
}

function normalizedPoint(value: unknown): { x: number; y: number } | undefined {
  const point = asRecord(value)
  const x = normalizedCoordinate(point.x)
  const y = normalizedCoordinate(point.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function normalizedCoordinate(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number === undefined ? undefined : clamp01(number)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isImageArtifactKind(kind: string): boolean {
  return kind === 'image' || kind === 'generated_image' || kind === 'edited_image'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function scoreNonEmpty(path: string): Promise<number> {
  const image = await loadImage(path)
  const canvas = createCanvas(64, 64)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, 64, 64)
  const data = ctx.getImageData(0, 0, 64, 64).data
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
    min = Math.min(min, luminance)
    max = Math.max(max, luminance)
  }
  return clamp01((max - min) / 64)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function slugForId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug || 'image-artifact'
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

class WorkspaceError extends Error {}
class ProviderError extends Error {}
class ProviderNotConfiguredError extends ProviderError {}
class ReviewPacketError extends Error {}
class ReviewManifestError extends Error {}

function renderErrorStatus(
  error: unknown
): Extract<ImageGenerationRenderResult, { ok: false }>['status'] {
  if (error instanceof WorkspaceError) return 'invalid_workspace'
  if (error instanceof ProviderNotConfiguredError) return 'provider_not_configured'
  if (error instanceof ProviderError) return 'provider_failed'
  return 'write_failed'
}

function editErrorStatus(
  error: unknown
): Extract<ImageGenerationEditFromVisualReviewPacketResult, { ok: false }>['status'] {
  if (error instanceof WorkspaceError) return 'invalid_workspace'
  if (error instanceof ReviewPacketError || error instanceof SyntaxError) return 'invalid_packet'
  if (error instanceof ProviderNotConfiguredError) return 'provider_not_configured'
  if (error instanceof ProviderError) return 'provider_failed'
  return 'write_failed'
}
