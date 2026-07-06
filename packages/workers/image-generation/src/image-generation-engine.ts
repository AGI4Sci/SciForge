import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { IMAGE_GENERATION_VISUAL_ROUTING } from './types'
import type {
  DiagramLayer,
  DiagramLayerBounds,
  DiagramLayerManifest,
  DrawingBrief,
  FrameworkDesignPlan,
  FrameworkDiagramSpec,
  FrameworkRegion,
  ImageEditIntent,
  ImageDrawingIntent,
  ImageGenerationEditFromCanvasPacketRequest,
  ImageGenerationEditFromCanvasPacketResult,
  ImageGenerationManifest,
  ImageGenerationPlanRequest,
  ImageGenerationPlanResult,
  ImageGenerationProvider,
  ImageGenerationRecipe,
  ImageGenerationRenderRequest,
  ImageGenerationRenderResult,
  ImageGenerationReviewPacketRequest,
  ImageGenerationReviewPacketResult,
  ImageGenerationReviewRequest,
  ImageGenerationReviewResult,
  ImageGenerationStatus,
  ImageGenerationUsagePolicy,
  ImageGenerationVisualRouting,
  ImageSize
} from './types'

const RENDERER_VERSION = '0.1.0'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const DEFAULT_SIZE: ImageSize = { width: 1024, height: 1024 }
const MAX_IMAGE_SIZE = 4096
const MIN_IMAGE_SIZE = 128
const IMAGE_SIZE_GRANULARITY = 16
const ARTIFACT_DIR = '.sciforge/artifacts'
const IMAGE_DIR = '.sciforge/images'
const LOCAL_MODEL_ROUTER_BASE_URL_ERROR =
  'SCIFORGE_MODEL_ROUTER_BASE_URL must point to the local SciForge Model Router (http://127.0.0.1:<port>/v1, http://localhost:<port>/v1, or http://[::1]:<port>/v1).'
const SCIENTIFIC_BASE_IMAGE_WARNING =
  'Scientific figure image generation is for visual composition/base layers only. Overlay labels, axes, numeric data, citations, molecular annotations, and other scientific claims with deterministic scripts such as scientific_plotting.'
const SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION =
  'For scientific-figure use, render an unlabeled visual composition or background only. Leave clear space for scripted overlays. Do not include readable labels, axes, numeric values, data traces, citations, equations, tables, legends, scale bars, gene/protein names, or molecular identity claims in the raster image.'
const SCIENTIFIC_BASE_IMAGE_USAGE_POLICY: ImageGenerationUsagePolicy = {
  role: 'visual_composition_base',
  deterministicOverlayRequired: true,
  overlayToolchain: 'script_or_scientific_plotting',
  warning: SCIENTIFIC_BASE_IMAGE_WARNING
}
const SCIENTIFIC_IMAGE_REQUEST_PATTERN =
  /\b(scientific|figure|diagram|schematic|plot|chart|data|axis|axes|legend|label|labels|pathway|mechanism|molecular|protein|rna|dna|chromatin|meiosis|kinase|cell|cells|gene|genes|p-?value|pmid|citation|scale\s*bar|equation|manuscript|publication)\b/i

type ProviderRenderInput = {
  workspaceRoot: string
  outputPath: string
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
}

type ProviderRenderResult = {
  provider: ImageGenerationProvider
  placeholder: boolean
  warnings: string[]
}

type ReviewPacketArtifact = {
  artifactKind?: string
  outputPath?: string
  sourcePath?: string
  path?: string
  shapeId?: string
  title?: string
}

type ReviewPacketSuggestion = {
  instruction?: string
  targetShapeId?: string
  annotationShapeId?: string
  artifactKind?: string
}

export async function getImageGenerationStatus(workspaceRoot?: string): Promise<ImageGenerationStatus> {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  const warnings: string[] = []
  const provider = providerKindForReadOnly(warnings)
  return {
    ok: true,
    provider,
    configured: provider === 'image-endpoint',
    defaultModel: imageModel(),
    supportedModes: ['text_to_image', 'image_to_image', 'variation'],
    supportedEditModes: ['inpaint', 'replace', 'erase', 'outpaint', 'upscale', 'style_transfer'],
    outputDir: root ? join(root, IMAGE_DIR) : IMAGE_DIR,
    artifactDir: root ? join(root, ARTIFACT_DIR) : ARTIFACT_DIR,
    visualRouting: imageGenerationVisualRouting(),
    warnings: [
      ...(provider === 'placeholder'
        ? ['No image model is configured. Other SciForge features are unaffected, but text-to-image and Canvas image edits require configuring an image model first.']
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
      : {})
  }
  const upstreamResearchWorkflow = buildUpstreamResearchWorkflow(task)
  if (upstreamResearchWorkflow?.recommended) {
    warnings.push(upstreamResearchWorkflow.reason)
  }
  const usagePolicy = scientificUsagePolicyForRecipe(recipe)
  pushUsagePolicyWarning(warnings, usagePolicy)
  void workspaceRoot
  return {
    ok: true,
    task,
    recipe,
    suggestedRenderTool: 'image_generation_render',
    suggestedReviewTool: 'image_generation_review',
    ...(upstreamResearchWorkflow ? { upstreamResearchWorkflow } : {}),
    visualRouting: imageGenerationVisualRouting(),
    artifactPolicy: usagePolicy
      ? 'Render writes a PNG visual base layer plus .sciforge/artifacts/*.generated-image.artifact.json for Canvas import; publication labels and data must be added by deterministic scripts.'
      : 'Render writes PNG output plus .sciforge/artifacts/*.generated-image.artifact.json for Canvas import.',
    canvasWorkflow: [
      'Run image_generation_render with the planned recipe.',
      'Import the generated artifact into SciForge Canvas.',
      'Use Canvas annotations for non-destructive edits.',
      'Run image_generation_edit_from_canvas_packet to create a new before/after artifact.',
      ...(usagePolicy ? ['For scientific figures, script all labels, axes, data traces, citations, scale bars, and molecular annotations after rendering the base image.'] : [])
    ],
    requiresConfirmation: Boolean(frameworkDesignPlan),
    ...(frameworkDesignPlan ? { confirmationSummary: frameworkDesignPlan.confirmationSummary } : {}),
    warnings
  }
}

function imageGenerationVisualRouting(): ImageGenerationVisualRouting {
  return {
    useImageGenerationWhen: [...IMAGE_GENERATION_VISUAL_ROUTING.useImageGenerationWhen],
    useScientificPlottingWhen: [...IMAGE_GENERATION_VISUAL_ROUTING.useScientificPlottingWhen],
    modelSelectionHint: IMAGE_GENERATION_VISUAL_ROUTING.modelSelectionHint
  }
}

export async function renderImageGeneration(request: ImageGenerationRenderRequest): Promise<ImageGenerationRenderResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const recipe = normalizeRecipe(request.recipe, warnings)
    const usagePolicy = scientificUsagePolicyForRecipe(recipe)
    pushUsagePolicyWarning(warnings, usagePolicy)
    const upstreamResearchWorkflow = buildUpstreamResearchWorkflow(recipe.prompt)
    if (upstreamResearchWorkflow?.recommended && !hasResearchEvidenceInPrompt(recipe.prompt, recipe.referencePath)) {
      return {
        ok: false,
        status: 'research_required',
        message: 'Scientific paper-style images must be grounded before final rendering. Build a scientific_plotting_research_brief, search/read related papers and figure evidence, then call image_generation_render with the resulting full prompt or referencePath.',
        upstreamResearchWorkflow,
        warnings: [
          ...warnings,
          'Rendering was blocked to avoid producing an ungrounded scientific figure.'
        ]
      }
    }
    const imageId = slugForId(request.imageId ?? 'generated-image-' + new Date().toISOString())
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const outputPath = join(outputDir, imageId + '.' + (recipe.outputFormat ?? 'png'))
    const providerResult = await renderWithProvider({ workspaceRoot, outputPath, recipe })
    warnings.push(...providerResult.warnings)
    const review = await reviewImageGenerationOutput({
      workspaceRoot,
      outputPath,
      ...(request.reviewReferencePath ? { referencePath: request.reviewReferencePath } : {})
    })
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
    const diagramLayerManifestPath = await writeDiagramLayerManifestIfNeeded({
      workspaceRoot,
      outputDir,
      imageId,
      outputPath,
      recipe,
      diagramSpecPath,
      frameworkDesignPlanPath
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
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      recipe,
      ...(recipe.intent ? { intent: recipe.intent } : {}),
      ...(diagramSpecPath ? { diagramSpecPath } : {}),
      ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
      ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
      ...(recipe.promptProfile ? { promptProfile: recipe.promptProfile } : {}),
      provider: providerResult.provider,
      review,
      ...(usagePolicy ? { usagePolicy } : {}),
      warnings
    }
    await writeJson(manifestPath, manifest)
    const artifactManifestPath = await writeImageArtifactManifest({
      workspaceRoot,
      artifactId: imageId,
      artifactKind: 'generated_image',
      sourceTool: 'image_generation',
      outputPath,
      manifestPath,
      title: recipe.prompt.slice(0, 90) || imageId,
      referencePath: recipe.referencePath,
      intent: recipe.intent,
      diagramSpecPath,
      frameworkDesignPlanPath,
      diagramLayerManifestPath,
      promptProfile: recipe.promptProfile,
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(usagePolicy ? { usagePolicy } : {}),
      review
    })
    return {
      ok: true,
      status: providerResult.placeholder ? 'rendered_placeholder' : review.ok ? 'rendered' : 'review_failed',
      workspaceRoot,
      outputPath,
      manifestPath,
      artifactManifestPath,
      ...(diagramSpecPath ? { diagramSpecPath } : {}),
      ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
      ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
      provider: providerResult.provider,
      review,
      ...(usagePolicy ? { usagePolicy } : {}),
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

function buildUpstreamResearchWorkflow(task: string): ImageGenerationPlanResult['upstreamResearchWorkflow'] | undefined {
  if (!requiresPaperGroundedPrompt(task)) return undefined
  return {
    recommended: true,
    reason: 'This looks like a scientific paper-style diagram/figure. First gather related paper figures, captions, style cues, and the user analysis angle before final image rendering.',
    suggestedBriefTool: 'scientific_plotting_research_brief',
    suggestedSearchTool: 'research_search',
    promptRequirements: [
      'reference papers with titles/venues/years and figure/caption hints',
      'figure conclusion and evidence logic',
      'user analysis angle',
      'visual archetype, layout, palette, typography, and annotation style',
      'final controlled image_generation recipe or prompt'
    ]
  }
}

function requiresPaperGroundedPrompt(task: string): boolean {
  const text = task.toLowerCase()
  const scientificSignal = /transformer|reinforcement|attention|neural|model architecture|protein|cell|gene|molecular|clinical|nature|science|cell|paper|scientific|research|论文|文献|科研|实验|模型|机制|顶刊|顶会/i.test(text)
  const figureSignal = /flow\s*chart|flowchart|workflow|pipeline|diagram|architecture|mechanism|schematic|infographic|figure|流程图|流程|工作流|管线|示意图|机制图|模型结构|架构图|信息图|论文图|图形摘要/i.test(text)
  return scientificSignal && figureSignal
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
    '- Output: one self-contained high-resolution PNG-style figure suitable for review on SciForge Canvas.'
  ].join('\n')
}

function hasResearchEvidenceInPrompt(prompt: string, referencePath?: string): boolean {
  if (referencePath?.trim()) return true
  return /reference papers?|candidate papers?|figure evidence|figure conclusion|evidence logic|literatureStrategy|scientific_plotting_research_brief|paper figures?|相关论文|参考论文|图注|证据链|分析角度/i.test(prompt)
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
      'The figure can be refined in Canvas using layer metadata.'
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
      previewPath: input.outputPath
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
        origin: 'draft_background',
        confidence: 1
      },
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

export async function editImageFromCanvasPacket(
  request: ImageGenerationEditFromCanvasPacketRequest
): Promise<ImageGenerationEditFromCanvasPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const packet = await loadReviewPacket(request, workspaceRoot)
    const packetRecord = asRecord(packet)
    const packetCanvasId = stringValue(packetRecord.canvasId)
    const packetThreadId = stringValue(packetRecord.threadId)
    const canvasId = request.canvasId ?? packetCanvasId
    const threadId = request.threadId ?? packetThreadId
    const intents = extractEditIntents(packet, workspaceRoot, warnings)
    if (intents.length === 0) {
      return {
        ok: false,
        status: 'no_edit_targets',
        message: 'No image edit targets were found in the Canvas review packet.',
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
      const usagePolicy = scientificUsagePolicyForEditIntent(intent)
      pushUsagePolicyWarning(warnings, usagePolicy)
      const providerResult = await renderWithProvider({ workspaceRoot, outputPath, editIntent: intent })
      warnings.push(...providerResult.warnings)
      const review = await reviewImageGenerationOutput({ workspaceRoot, outputPath, referencePath: intent.sourcePath })
      const manifestPath = join(outputDir, imageId + '.manifest.json')
      const manifest: ImageGenerationManifest = {
        version: 1,
        renderer: 'sciforge-image-generation-mcp',
        rendererVersion: RENDERER_VERSION,
        tool: 'image_generation_edit_from_canvas_packet',
        createdAt: new Date().toISOString(),
        requestHash: hashValue({ intent }),
        workspaceRoot,
        outputPath,
        ...(canvasId ? { canvasId } : {}),
        ...(threadId ? { threadId } : {}),
        editIntent: intent,
        provider: providerResult.provider,
        review,
        ...(usagePolicy ? { usagePolicy } : {}),
        warnings
      }
      await writeJson(manifestPath, manifest)
      const artifactManifestPath = await writeImageArtifactManifest({
        workspaceRoot,
        artifactId: imageId,
        artifactKind: 'edited_image',
        sourceTool: 'image_generation',
        outputPath,
        manifestPath,
        sourcePath: intent.sourcePath,
        title: intent.instruction.slice(0, 90) || imageId,
        ...(canvasId ? { canvasId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(usagePolicy ? { usagePolicy } : {}),
        review
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

export async function reviewImageGenerationOutput(request: ImageGenerationReviewRequest): Promise<ImageGenerationReviewResult> {
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const outputPath = await resolveWorkspacePath(workspaceRoot, request.outputPath)
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
    const overall = clamp01((sizeScore + nonEmptyScore + (referenceScore ?? 1)) / (referenceScore === undefined ? 2 : 3))
    return {
      ok: true,
      score: {
        overall,
        dimensions: sizeScore,
        nonEmpty: nonEmptyScore,
        background: nonEmptyScore,
        ...(referenceScore !== undefined ? { reference: referenceScore } : {}),
        warnings
      },
      repairable: overall < (request.minOverall ?? 0.72),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: 'image_unreadable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createImageGenerationReviewPacket(
  request: ImageGenerationReviewPacketRequest
): Promise<ImageGenerationReviewPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    if (request.manifestPaths.length === 0) {
      return { ok: false, status: 'invalid_request', message: 'manifestPaths must contain at least one manifest path.' }
    }
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir ?? join('.sciforge', 'image-review-packets'))
    await mkdir(outputDir, { recursive: true })
    const packetId = slugForId(request.packetId ?? 'image-review-' + new Date().toISOString())
    const items: unknown[] = []
    for (const manifestPath of request.manifestPaths) {
      try {
        const resolvedManifest = await resolveWorkspacePath(workspaceRoot, manifestPath)
        items.push(JSON.parse(await readFile(resolvedManifest, 'utf8')))
      } catch (error) {
        warnings.push('Could not read manifest ' + manifestPath + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    const packet = {
      version: 1,
      tool: 'image_generation_review_packet',
      createdAt: new Date().toISOString(),
      title: request.title ?? 'Image generation review packet',
      items,
      warnings
    }
    const packetPath = join(outputDir, packetId + '.json')
    const markdownPath = join(outputDir, packetId + '.md')
    await writeJson(packetPath, packet)
    await writeFile(markdownPath, renderReviewPacketMarkdown(packet.title, items, warnings), 'utf8')
    return { ok: true, packetPath, markdownPath, count: items.length, warnings }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof WorkspaceError ? 'invalid_workspace' : 'write_failed',
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
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
  if (!allowPlaceholderProvider()) {
    throw new ProviderNotConfiguredError(
      'Image model is not configured. Configure an image model in Settings before using text-to-image generation or Canvas image edits.'
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

  const sourcePath = await resolveWorkspacePath(input.workspaceRoot, intent.sourcePath)
  const source = await loadImage(sourcePath)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)

  const warnings: string[] = []
  if (isColorEditInstruction(intent.instruction)) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    applyControlledColorEdit(imageData.data, intent.instruction)
    ctx.putImageData(imageData, 0, 0)
    warnings.push('Applied a source-preserving controlled color edit; layout, text, and composition were kept from the original image.')
  } else {
    warnings.push('Canvas image edit kept the source image unchanged because this edit is not yet mapped to a safe source-preserving transform.')
  }

  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
  return {
    provider: 'controlled-edit',
    placeholder: false,
    warnings
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
  const size = input.recipe?.size ?? DEFAULT_SIZE
  const errors: string[] = []
  for (const candidateBaseUrl of imageEndpointBaseUrlCandidates(endpoint.baseUrl)) {
    try {
      await renderWithImageEndpoint(candidateBaseUrl, {
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        prompt,
        size,
        outputPath: input.outputPath
      })
      return
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new ProviderError(errors.find(Boolean) ?? 'Image provider did not return an image.')
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

function imageModel(): string {
  return process.env.SCIFORGE_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL
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
    ...(recipe.model?.trim() ? { model: recipe.model.trim() } : {}),
    ...(recipe.negativePrompt?.trim() ? { negativePrompt: recipe.negativePrompt.trim() } : {}),
    size: normalizeSize(recipe.size, warnings),
    ...(recipe.stylePreset?.trim() ? { stylePreset: recipe.stylePreset.trim() } : {}),
    ...(recipe.referencePath?.trim() ? { referencePath: recipe.referencePath.trim() } : {}),
    outputFormat: recipe.outputFormat ?? 'png',
    ...(recipe.intent ? { intent: recipe.intent } : {}),
    ...(recipe.drawingBrief ? { drawingBrief: recipe.drawingBrief } : {}),
    ...(recipe.diagramSpec ? { diagramSpec: recipe.diagramSpec } : {}),
    ...(recipe.frameworkDesignPlan ? { frameworkDesignPlan: recipe.frameworkDesignPlan } : {}),
    ...(recipe.confirmation ? { confirmation: recipe.confirmation } : {}),
    ...(recipe.promptProfile ? { promptProfile: recipe.promptProfile } : {})
  }
}

function scientificUsagePolicyForRecipe(recipe: ImageGenerationRecipe | undefined): ImageGenerationUsagePolicy | undefined {
  if (!recipe) return undefined
  return isScientificImageRequest([recipe.prompt, recipe.stylePreset]) ? SCIENTIFIC_BASE_IMAGE_USAGE_POLICY : undefined
}

function scientificUsagePolicyForEditIntent(intent: ImageEditIntent | undefined): ImageGenerationUsagePolicy | undefined {
  if (!intent) return undefined
  return isScientificImageRequest([intent.instruction]) ? SCIENTIFIC_BASE_IMAGE_USAGE_POLICY : undefined
}

function isScientificImageRequest(values: Array<string | undefined>): boolean {
  return values.some((value) => SCIENTIFIC_IMAGE_REQUEST_PATTERN.test(value ?? ''))
}

function pushUsagePolicyWarning(warnings: string[], usagePolicy: ImageGenerationUsagePolicy | undefined): void {
  if (!usagePolicy || warnings.includes(usagePolicy.warning)) return
  warnings.push(usagePolicy.warning)
}

function providerPromptForRecipe(recipe: ImageGenerationRecipe): string {
  const prompt = recipe.prompt.trim()
  return scientificUsagePolicyForRecipe(recipe)
    ? prompt + '\n\n' + SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION
    : prompt
}

function providerPromptForEditIntent(intent: ImageEditIntent | undefined): string {
  const instruction = intent?.instruction.trim() ?? ''
  return scientificUsagePolicyForEditIntent(intent)
    ? instruction + '\n\n' + SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION
    : instruction
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
  manifestPath: string
  sourcePath?: string
  referencePath?: string
  canvasId?: string
  threadId?: string
  usagePolicy?: ImageGenerationUsagePolicy
  title: string
  intent?: ImageDrawingIntent
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  promptProfile?: ImageGenerationRecipe['promptProfile']
  review?: ImageGenerationReviewResult
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
    manifestPath: input.manifestPath,
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    ...(input.referencePath ? { referencePath: input.referencePath } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.diagramSpecPath ? { diagramSpecPath: input.diagramSpecPath } : {}),
    ...(input.frameworkDesignPlanPath ? { frameworkDesignPlanPath: input.frameworkDesignPlanPath } : {}),
    ...(input.diagramLayerManifestPath ? { diagramLayerManifestPath: input.diagramLayerManifestPath } : {}),
    ...(input.promptProfile ? { promptProfile: input.promptProfile } : {}),
    title: input.title,
    ...(input.usagePolicy ? { usagePolicy: input.usagePolicy } : {}),
    ...(input.review?.ok ? { reviewScore: input.review.score } : {})
  })
  return artifactManifestPath
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function loadReviewPacket(request: ImageGenerationEditFromCanvasPacketRequest, workspaceRoot: string): Promise<unknown> {
  if (request.reviewPacket) return request.reviewPacket
  if (!request.reviewPacketPath?.trim()) throw new Error('reviewPacket or reviewPacketPath is required.')
  const packetPath = await resolveWorkspacePath(workspaceRoot, request.reviewPacketPath)
  return JSON.parse(await readFile(packetPath, 'utf8'))
}

function extractEditIntents(packet: unknown, workspaceRoot: string, warnings: string[]): ImageEditIntent[] {
  const record = asRecord(packet)
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.map(asRecord) : []
  const suggestions = Array.isArray(record.modificationSuggestions) ? record.modificationSuggestions.map(asRecord) : []
  const intents: ImageEditIntent[] = []
  for (const suggestion of suggestions) {
    const targetShapeId = typeof suggestion.targetShapeId === 'string' ? suggestion.targetShapeId : undefined
    const target = artifacts.find((artifact) => typeof artifact.shapeId === 'string' && artifact.shapeId === targetShapeId)
      ?? artifacts.find((artifact) => isImageArtifactKind(String(artifact.artifactKind ?? '')))
    if (!target) continue
    const sourcePath = stringValue(target.outputPath) ?? stringValue(target.sourcePath) ?? stringValue(target.path)
    if (!sourcePath) continue
    const instruction = stringValue(suggestion.instruction) ?? 'Apply the canvas annotation as a non-destructive image edit.'
    try {
      ensureInsideWorkspace(workspaceRoot, isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(workspaceRoot, sourcePath))
      intents.push({
        mode: 'replace',
        sourcePath,
        instruction,
        ...(typeof suggestion.annotationShapeId === 'string' ? { annotationShapeId: suggestion.annotationShapeId } : {}),
        ...(targetShapeId ? { targetShapeId } : {}),
        preserve: ['composition', 'layout']
      })
    } catch (error) {
      warnings.push('Skipped image edit target outside workspace: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  return intents
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

function renderReviewPacketMarkdown(title: string, items: unknown[], warnings: string[]): string {
  const lines = ['# ' + title, '', 'Items: ' + items.length, '']
  if (warnings.length) {
    lines.push('## Warnings', '', ...warnings.map((warning) => '- ' + warning), '')
  }
  lines.push('## Manifests', '')
  for (const item of items) {
    const record = asRecord(item)
    lines.push('- ' + (stringValue(record.outputPath) ?? stringValue(record.path) ?? 'unknown output'))
  }
  lines.push('')
  return lines.join('\n')
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
): Extract<ImageGenerationEditFromCanvasPacketResult, { ok: false }>['status'] {
  if (error instanceof WorkspaceError) return 'invalid_workspace'
  if (error instanceof ProviderNotConfiguredError) return 'provider_not_configured'
  if (error instanceof ProviderError) return 'provider_failed'
  return 'write_failed'
}
