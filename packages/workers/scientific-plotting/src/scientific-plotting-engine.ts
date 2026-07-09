import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type {
  FigureStyleReviewResult,
  FigureStyleSimilarityScore,
  FigureStyleSpec
} from './types'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES,
  type ScientificExternalSkillCatalogItem,
  type ScientificExternalSkillSourceKind,
  type ScientificFigureNeed,
  type ScientificFigureNeedClassification,
  type ScientificPaperFigureCompositionPlan,
  type ScientificPaperFigureProductionPlan,
  type ScientificPlottingAttempt,
  type ScientificPlottingAutoRepairOptions,
  type ScientificPlottingCropBox,
  type ScientificPlottingDataMappingRequest,
  type ScientificPlottingDataMappingResult,
  type ScientificPlottingDraftHandoff,
  type ScientificPlottingImagePolishRecommendation,
  type ScientificPlottingLabels,
  type ScientificPlottingManifest,
  type ScientificPlottingPlanRequest,
  type ScientificPlottingPlanResult,
  type ScientificPlottingPrepareReferenceRequest,
  type ScientificPlottingPrepareReferenceResult,
  type ScientificPlottingReferenceManifest,
  type ScientificPlottingReferenceProfile,
  type ScientificPlottingRenderRequest,
  type ScientificPlottingRenderResult,
  type ScientificPlottingResearchBriefRequest,
  type ScientificPlottingResearchBriefResult,
  type ScientificPlottingResearchPaper,
  type ScientificPlottingReviewPacket,
  type ScientificPlottingReviewPacketItem,
  type ScientificPlottingReviewPacketRequest,
  type ScientificPlottingReviewPacketResult,
  type ScientificPlottingReviewRequest,
  type ScientificPlottingReviewResult,
  type ScientificPlottingSelectedSkillProfile,
  type ScientificPlottingStatusResult,
  type ScientificPlottingStyleProfile,
  type ScientificPlottingStyleProfileMatch,
  type ScientificPlottingStyleProfileSummary,
  type ScientificPlottingStyleProfilesRequest,
  type ScientificPlottingStyleProfilesResult,
  type ScientificPlottingStyleTransferManifest,
  type ScientificPlottingStyleTransferRequest,
  type ScientificPlottingStyleTransferResult,
  type ScientificPlottingTemplate,
  type ScientificPlottingTemplateAdvice,
  type ScientificPlottingTemplateGuide,
  type ScientificPlottingTemplateSelection
} from './types'
import {
  EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES,
  buildScientificExternalSkillCatalog
} from './scientific-skills-index'
import {
  buildFigureStyleApplyPlan,
  extractFigureStyle,
  reviewFigureStyleOutput
} from './figure-style-extractor'
import {
  canonicalPath,
  extensionFromName,
  expandHomePath,
  resolveOpenTargetPath,
  resolveTargetPathWithinWorkspace
} from './workspace-paths'

type MatplotlibStatus = {
  available: boolean
  version?: string
  message?: string
}

type CommandStatus = {
  available: boolean
  command?: string
  message?: string
}

type RenderPayload = {
  template: ScientificPlottingTemplate
  data: unknown
  labels: ScientificPlottingLabels
  outputPath: string
  styleSpec: FigureStyleSpec
  rcParams: Record<string, string | number | boolean>
  palette: string[]
  heatmapCmapColors?: string[]
}

type DataSummary = Extract<ScientificPlottingDataMappingResult, { ok: true }>['dataSummary']
type DataMappingCandidate = {
  template: ScientificPlottingTemplate
  confidence: number
  data: unknown
  labels?: ScientificPlottingLabels
  inputShape: DataSummary['inputShape']
  dataSignals: ScientificPlottingTemplate[]
  reasons: string[]
  warnings: string[]
  summary: DataSummary
}

type TabularColumnProfile = {
  key: string
  numericCount: number
  stringCount: number
  finiteValues: number[]
  uniqueValues: string[]
}

type RendererDiagnostics = NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>

type InternalStyleProfileMatch = {
  profile: ScientificPlottingStyleProfile
  score: number
  reasons: string[]
  cautions: string[]
}

type PythonRunResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; stdout: string; stderr: string; message: string }

const RENDERER_VERSION = '0.1.0'
const PYTHON_COMMAND = process.env.SCIFORGE_PYTHON?.trim() || 'python3'
const PDFTOPPM_COMMAND = process.env.SCIFORGE_PDFTOPPM?.trim() || 'pdftoppm'
const DEFAULT_OUTPUT_RELATIVE_DIR = '.sciforge/figures'
const DEFAULT_REFERENCE_RELATIVE_DIR = '.sciforge/figure-references'
const DEFAULT_REVIEW_PACKET_RELATIVE_DIR = '.sciforge/figure-reviews'
const PDF_RENDER_RELATIVE_DIR = '.sciforge/pdf-render-cache'
const MAX_SERIES = 12
const MAX_POINTS = 5000
const MAX_HEATMAP_CELLS = 40_000
const MAX_SCHEMATIC_NODES = 50
const MAX_FLOWCHART_NODES = 12
const MAX_FLOWCHART_LABEL_CHARS = 720
const MAX_DISTRIBUTION_GROUPS = 24
const MAX_DISTRIBUTION_POINTS = 6000
const MAX_MULTI_PANELS = 6
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const MAX_REFERENCE_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_REFERENCE_PDF_BYTES = 120 * 1024 * 1024
const MAX_REVIEW_PACKET_ITEMS = 30
const STYLE_PROFILE_REGISTRY_VERSION = 1

export async function getScientificPlottingStatus(): Promise<ScientificPlottingStatusResult> {
  const matplotlib = await checkMatplotlib()
  const pdfRenderer = await checkPdfRenderer()
  const styleProfiles = builtInStyleProfiles()
  return {
    ok: true,
    serverName: 'scientific_plotting',
    version: RENDERER_VERSION,
    renderer: {
      kind: 'matplotlib',
      pythonCommand: PYTHON_COMMAND,
      available: matplotlib.available,
      ...(matplotlib.version ? { version: matplotlib.version } : {}),
      ...(matplotlib.message ? { message: matplotlib.message } : {})
    },
    referencePreparation: {
      imageCrop: true,
      pdfCrop: {
        available: pdfRenderer.available,
        command: pdfRenderer.command ?? PDFTOPPM_COMMAND,
        ...(pdfRenderer.message ? { message: pdfRenderer.message } : {})
      },
      defaultRelativeDir: DEFAULT_REFERENCE_RELATIVE_DIR
    },
    reviewPackets: {
      defaultRelativeDir: DEFAULT_REVIEW_PACKET_RELATIVE_DIR,
      readsRenderManifests: true,
      writesMarkdownAndJson: true
    },
    styleProfiles: {
      builtIn: styleProfiles.length,
      acceptsStyleProfileId: true,
      defaultProfileIds: styleProfiles.map((profile) => profile.id)
    },
    supportedTemplates: [...SCIENTIFIC_PLOTTING_TEMPLATES],
    templateGuides: scientificPlottingTemplateGuides(),
    outputPolicy: {
      defaultRelativeDir: DEFAULT_OUTPUT_RELATIVE_DIR,
      writesOnlyInsideWorkspace: true,
      formats: ['png']
    },
    degraded: !matplotlib.available,
    guardrails: [
      'Only first-party renderer code is executed.',
      'Renderer input is structured JSON; user-provided Python or shell code is rejected.',
      'Artifacts are written only inside the selected workspace.',
      'Auto-repair may only change visual style parameters, never source data or statistics.'
    ]
  }
}

export async function listScientificPlottingStyleProfiles(
  request: ScientificPlottingStyleProfilesRequest = {}
): Promise<ScientificPlottingStyleProfilesResult> {
  const warnings: string[] = []
  let workspaceRoot: string | undefined
  if (request.workspaceRoot?.trim()) {
    try {
      workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    } catch (error) {
      if (request.referencePath?.trim() || request.styleSpecPath?.trim()) {
        return {
          ok: false,
          status: 'invalid_request',
          message: `workspaceRoot is required for reference-driven profile matching: ${error instanceof Error ? error.message : String(error)}`,
          availableProfileIds: builtInStyleProfiles().map((profile) => profile.id),
          warnings
        }
      }
      warnings.push(`workspaceRoot was not used for built-in profiles: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const profiles = builtInStyleProfiles()
  const availableProfileIds = profiles.map((profile) => profile.id)
  const topK = Math.max(1, Math.min(20, Math.floor(request.topK ?? 12)))
  const query = request.query?.trim().toLowerCase()
  const profileId = request.profileId?.trim()
  if (profileId) {
    const selected = profiles.find((profile) => profile.id === profileId)
    if (!selected) {
      return {
        ok: false,
        status: 'not_found',
        message: `Unknown scientific plotting style profile: ${profileId}.`,
        availableProfileIds,
        warnings
      }
    }
    return {
      ok: true,
      status: 'found',
      profiles: [shapeStyleProfileForResult(selected, request.includeStyleSpec === true)],
      total: 1,
      selectedProfile: shapeStyleProfileForResult(selected, request.includeStyleSpec === true),
      recommendedNextTools: [
        'scientific_plotting_plan',
        'scientific_plotting_map_data',
        'scientific_plotting_render',
        'scientific_plotting_review'
      ],
      warnings
    }
  }

  const styleSpecForMatching = await resolveStyleSpecForProfileSelection(request, workspaceRoot, warnings)
  if (styleSpecForMatching) {
    const referenceProfile = inferReferenceProfileFromStyle(styleSpecForMatching, {
      task: request.query
    })
    const matches = rankStyleProfilesForStyleSpec(styleSpecForMatching, referenceProfile, query)
      .slice(0, topK)
      .map((match) => shapeStyleProfileMatchForResult(match, request.includeStyleSpec === true))
    return {
      ok: true,
      status: 'matched',
      profiles: matches.map((match) => match.profile),
      total: matches.length,
      ...(matches[0] ? { selectedProfile: matches[0].profile } : {}),
      profileMatches: matches,
      referenceProfile,
      recommendedNextTools: [
        'scientific_plotting_plan',
        'scientific_plotting_map_data',
        'scientific_plotting_render',
        'scientific_plotting_review'
      ],
      warnings
    }
  }
  if (request.referencePath?.trim() || request.styleSpecPath?.trim() || request.styleSpec) {
    return {
      ok: false,
      status: 'invalid_request',
      message: 'Reference-driven style profile matching requires a readable referencePath, styleSpecPath, or FigureStyleSpec v1 object.',
      availableProfileIds,
      warnings
    }
  }

  const matched = query
    ? profiles
        .map((profile) => ({
          profile,
          score: scoreStyleProfileMatch(profile, query)
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.profile)
    : profiles
  return {
    ok: true,
    status: 'listed',
    profiles: matched.slice(0, topK).map((profile) => shapeStyleProfileForResult(profile, request.includeStyleSpec === true)),
    total: matched.length,
    recommendedNextTools: [
      'scientific_plotting_plan',
      'scientific_plotting_map_data',
      'scientific_plotting_render',
      'scientific_plotting_review'
    ],
    warnings
  }
}

export function buildScientificFigureNeedClassification(
  task: string,
  options: {
    domain?: string
    targetVenue?: string
    templateHint?: ScientificPlottingTemplate
  } = {}
): ScientificFigureNeedClassification {
  const normalizedTask = task.trim()
  const text = `${normalizedTask} ${options.domain ?? ''} ${options.targetVenue ?? ''}`
  const scores = new Map<ScientificFigureNeed, number>()
  const add = (need: ScientificFigureNeed, pattern: RegExp, score: number): void => {
    if (!pattern.test(text)) return
    scores.set(need, Math.max(scores.get(need) ?? 0, score))
  }

  add('multi_panel_figure', /multi[-\s]?panel|多\s*panel|subplot|facet|panel figure|figure panel|supplementary|组合图|复合图|拼接图|拼图|多面板|多子图/i, 0.86)
  add('statistical_comparison', /violin|box\s*plot|boxplot|error\s*bar|confidence interval|p[-\s]?value|anova|t[-\s]?test|significance|significant|distribution comparison|distributions?\s+(?:for|across|by|between)|response distributions?|统计|显著性|箱线图|小提琴图|误差棒/i, 0.84)
  add('heatmap_matrix', /heatmap|matrix|correlation|attention|alignment|expression|omics|cluster|热图|矩阵|相关性|表达矩阵|聚类/i, 0.83)
  add('method_flow', /flow\s*chart|flowchart|workflow|pipeline|protocol|process flow|method|prisma|consort|流程图|流程|工作流|管线|方法|实验流程/i, 0.82)
  add('mechanism_schematic', /mechanism|signaling|cascade|interaction|regulation|pathogenesis|schematic|机制|信号通路|级联|调控|示意图/i, 0.84)
  add('model_architecture', /architecture|model structure|neural network|transformer|cnn|gnn|reinforcement learning|rl|attention model|模型结构|网络结构|神经网络|强化学习/i, 0.84)
  add('pathway_network', /pathway|network|graph|gene set|ontology|reactome|kegg|路径|通路|网络|图结构/i, 0.8)
  add('image_panel', /microscopy|western blot|gel|histology|image panel|fluorescence|ct|mri|显微|成像|免疫印迹|凝胶|病理|图像面板/i, 0.82)
  add('summary_figure', /summary figure|graphical abstract|overview|teaser|toc|infographic|cover|poster|宣传图|信息图|封面|总览图|图形摘要/i, 0.86)
  add('statistical_comparison', /histogram|density|kde|residual distribution|value distribution|distribution plot|分布图|直方图|密度图/i, 0.86)
  add('quantitative_chart', /line|curve|scatter|bar|chart|plot|time series|dose|benchmark|柱状|折线|散点|曲线|图表|时间序列/i, 0.72)

  const templateNeed = needForTemplate(options.templateHint)
  if (templateNeed) scores.set(templateNeed, Math.max(scores.get(templateNeed) ?? 0, 0.68))

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const primaryNeed = ranked[0]?.[0] ?? 'quantitative_chart'
  const secondaryNeeds = ranked
    .slice(1, 4)
    .map(([need]) => need)
    .filter((need) => need !== primaryNeed)
  const confidence = Number(Math.min(0.96, ranked[0]?.[1] ?? 0.52).toFixed(2))
  const domain = inferRequestedScientificFigureDomain(options.domain) ?? inferScientificFigureDomain(text)
  const hasExplicitNodeEdges = /\bnodes?\b|\bedges?\b|from\s*[:=]|to\s*[:=]|json|节点|边|连接|步骤\s*[:：]|^\s*\d+[.)、]/im.test(normalizedTask)
  const looksLikeLongProse = normalizedTask.length > 520 || /according to the following|based on the following|one goal in|in this paper|we argue|we discuss|paper excerpt|根据以下内容|根据.*论文|文献内容|论文段落|这篇文章/i.test(normalizedTask)
  const needsResearchBrief = shouldRecommendResearchBrief(normalizedTask, primaryNeed, options.targetVenue)
  const route = routeForFigureNeed(primaryNeed, {
    hasExplicitNodeEdges,
    looksLikeLongProse,
    needsResearchBrief
  })
  const recommendedNextTool = needsResearchBrief
    ? 'scientific_plotting_research_brief'
    : route === 'controlled_plotting_renderer' || route === 'panel_layout_then_renderer'
      ? 'scientific_plotting_map_data'
      : 'image_generation_plan'
  const avoidTemplates: ScientificPlottingTemplate[] = route === 'diagram_spec_or_image_generation' && !hasExplicitNodeEdges
    ? ['flowchart']
    : []
  const warnings = [
    ...(looksLikeLongProse && !hasExplicitNodeEdges
      ? ['Long prose should be converted into a figure brief or image/diagram prompt before rendering; avoid forcing it into compact flowchart nodes.']
      : []),
    ...(needsResearchBrief
      ? ['Paper-figure tasks should confirm figure conclusion, evidence logic, archetype, and export contract before rendering.']
      : [])
  ]

  return {
    primaryNeed,
    secondaryNeeds,
    confidence,
    route,
    routeReason: routeReasonForFigureNeed(primaryNeed, route, { hasExplicitNodeEdges, looksLikeLongProse, needsResearchBrief }),
    domain,
    recommendedNextTool,
    requiredInputs: requiredInputsForFigureNeed(primaryNeed, route),
    avoidTemplates,
    warnings
  }
}

export async function createScientificPlottingResearchBrief(
  request: ScientificPlottingResearchBriefRequest
): Promise<ScientificPlottingResearchBriefResult> {
  const task = request.task.trim()
  if (!task) return { ok: false, message: 'Task is required.', warnings: [] }
  const figureNeed = buildScientificFigureNeedClassification(task, {
    domain: request.domain,
    targetVenue: request.targetVenue
  })
  const maxPapers = Math.max(0, Math.min(8, Math.floor(request.maxPapers ?? 4)))
  const candidatePapers = (request.candidatePapers ?? [])
    .filter((paper) => paper.title?.trim())
    .slice(0, maxPapers)
    .map((paper) => ({
      ...paper,
      title: paper.title.trim(),
      ...(paper.figureHints ? { figureHints: paper.figureHints.slice(0, 8) } : {})
    }))
  const skillCatalog = buildScientificExternalSkillCatalog({
    figureNeeds: [figureNeed.primaryNeed, ...figureNeed.secondaryNeeds],
    domain: request.domain ?? figureNeed.domain
  })
  const recommendedSkillLayers = buildRecommendedSkillLayers(skillCatalog, figureNeed)
  const selectedSkillProfile = buildSelectedSkillProfile({
    task,
    figureNeed,
    request,
    candidatePapers,
    skillCatalog,
    recommendedSkillLayers
  })
  const literatureStrategy = buildResearchBriefLiteratureStrategy(task, figureNeed, request)
  const figureContract = buildResearchBriefFigureContract(task, figureNeed, request)
  const paperFigureProductionPlan = buildPaperFigureProductionPlan(task, figureNeed, request)
  const promptSpecDraft = buildResearchBriefPromptSpec(task, figureNeed, candidatePapers, request)
  const availableSkillIds = uniqueStrings(skillCatalog
    .filter((item) => item.sourceKind !== 'compat')
    .slice(0, 10)
    .map((item) => item.skillId))
  const confirmationCard = {
    title: `Confirm ${labelForFigureNeed(figureNeed.primaryNeed)} before rendering`,
    proposedRoute: figureNeed.route,
    analysisAngle: inferAnalysisAngle(task, request),
    questions: confirmationQuestionsForFigureNeed(figureNeed),
    requiredInputs: figureNeed.requiredInputs,
    availableSkillIds
  }
  return {
    ok: true,
    task,
    domain: figureNeed.domain,
    ...(request.targetVenue?.trim() ? { targetVenue: request.targetVenue.trim() } : {}),
    figureNeed,
    selectedSkillProfile,
    skillCatalog,
    recommendedSkillLayers,
    literatureStrategy,
    candidatePapers,
    figureContract,
    ...(paperFigureProductionPlan ? { paperFigureProductionPlan } : {}),
    promptSpecDraft,
    confirmationCard,
    guardrails: [
      'External skills are read-only planning sources; do not execute third-party scripts or allowed-tools.',
      'Use K-Dense/SciForge controlled plotting as the base layer, then add CNS/domain guidance where relevant.',
      'Do not copy copyrighted figure composition, labels, or data from reference papers; use them for style and archetype guidance only.',
      'Confirm the figure conclusion, analysis angle, and data availability before rendering.',
      'After rendering, create an artifact card and use Canvas annotations/review packets for revision.'
    ],
    warnings: [
      ...figureNeed.warnings,
      ...(candidatePapers.length === 0
        ? ['No candidate papers were supplied; use the suggested literature queries before treating the brief as evidence-grounded.']
        : []),
      `Excluded from this workflow: ${EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES.join(', ')}.`
    ]
  }
}

export async function planScientificPlotting(
  request: ScientificPlottingPlanRequest
): Promise<ScientificPlottingPlanResult> {
  const task = request.task.trim()
  if (!task) return { ok: false, message: 'Task is required.' }
  const warnings: string[] = []
  const workspaceRoot = request.workspaceRoot?.trim()
    ? await resolveWorkspaceRoot(request.workspaceRoot)
    : undefined
  const styleProfile = styleProfileForPlanning(
    request.styleSpec || request.styleSpecPath?.trim() ? undefined : request.styleProfileId,
    warnings
  )
  if (request.styleProfileId?.trim() && (request.styleSpec || request.styleSpecPath?.trim())) {
    warnings.push('styleProfileId was ignored because explicit styleSpec/styleSpecPath was provided.')
  }
  const styleSpec = await resolvePlanStyleSpec(request, workspaceRoot, warnings, styleProfile)
  const referenceProfile = styleProfile?.referenceProfile ?? (styleSpec
    ? inferReferenceProfileFromStyle(styleSpec, {
        task,
        templateHint: request.templateHint
      })
    : undefined)
  const styleProfileMatches = !styleProfile && styleSpec && referenceProfile
    ? rankStyleProfilesForStyleSpec(styleSpec, referenceProfile, task)
        .slice(0, 3)
        .map((match) => shapeStyleProfileMatchForResult(match, false))
    : undefined
  const recommendedProfile = styleProfile
    ? shapeStyleProfileForResult(styleProfile, false)
    : styleProfileMatches?.[0]?.profile
  const taskTemplate = inferTemplateFromTask(task)
  const initialTemplate = request.templateHint ?? referenceProfile?.recommendedTemplate ?? taskTemplate
  const figureNeed = buildScientificFigureNeedClassification(task, {
    domain: request.domain,
    targetVenue: request.targetVenue,
    templateHint: initialTemplate
  })
  const template = request.templateHint ?? templateForFigureNeed(figureNeed.primaryNeed, referenceProfile?.recommendedTemplate ?? taskTemplate)
  const isStyleTransfer = /style|paper|figure|nature|science|cell|neurips|iclr|论文|文献|风格|顶刊|顶会/i.test(task)
  const templateAdvice = buildTemplateAdvice(template, referenceProfile, undefined)
  const toolRoutingRecommendation = buildScientificPlottingToolRoutingRecommendation(task, template)
  const researchBriefRecommendation = buildResearchBriefRecommendation(task, figureNeed, request.targetVenue)
  const imagePolishRecommendation = buildImagePolishRecommendation(task, figureNeed, {
    targetVenue: request.targetVenue,
    researchBriefRecommended: researchBriefRecommendation?.recommended === true,
    template
  })
  const planSkillCatalog = buildScientificExternalSkillCatalog({
    figureNeeds: [figureNeed.primaryNeed, ...figureNeed.secondaryNeeds],
    domain: request.domain ?? figureNeed.domain
  })
  const recommendedSkillIds = recommendedSkillIdsForPlan(planSkillCatalog, figureNeed, {
    includeCns: researchBriefRecommendation?.recommended === true
  })
  const controlledTool = researchBriefRecommendation?.recommended
    ? 'scientific_plotting_research_brief'
    : toolRoutingRecommendation?.preferredTool ?? 'scientific_plotting_render'
  return {
    ok: true,
    recommendedTemplate: template,
    reason: referenceProfile
      ? `Use the controlled ${template} template because the reference profile suggests ${templateReason(template)}.`
      : `Use the controlled ${template} template because the task appears to request ${templateReason(template)}.`,
    supportedTemplates: [...SCIENTIFIC_PLOTTING_TEMPLATES],
    ...(referenceProfile ? { referenceProfile } : {}),
    ...(recommendedProfile ? {
      styleProfileId: recommendedProfile.id,
      styleProfile: recommendedProfile
    } : {}),
    ...(styleProfileMatches ? { styleProfileMatches } : {}),
    templateSelection: buildTemplateSelection(template, request, referenceProfile),
    templateGuides: scientificPlottingTemplateGuides(),
    figureNeed,
    ...(toolRoutingRecommendation ? { toolRoutingRecommendation } : {}),
    ...(researchBriefRecommendation ? { researchBriefRecommendation } : {}),
    ...(imagePolishRecommendation ? { imagePolishRecommendation } : {}),
    externalSkillCatalog: {
      recommendedSkillIds,
      primarySources: uniqueStrings(planSkillCatalog
        .filter((item) => recommendedSkillIds.includes(item.skillId))
        .map((item) => item.sourceKind)) as ScientificExternalSkillSourceKind[],
      excludedSources: [...EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES]
    },
    templateAlternatives: buildTemplateAlternatives(template, taskTemplate, referenceProfile),
    requiredInputs: requiredInputsForTemplate(template),
    styleInputs: isStyleTransfer
      ? ['Optional styleProfileId, FigureStyleSpec, or reference image path for post-render review.']
      : ['Optional styleProfileId or FigureStyleSpec for publication styling.'],
    controlledTool,
    planningWarnings: [
      ...warnings,
      ...figureNeed.warnings,
      ...(templateAdvice?.messages ?? []),
      ...(toolRoutingRecommendation ? [toolRoutingRecommendation.reason] : []),
      ...(researchBriefRecommendation ? [researchBriefRecommendation.reason] : []),
      ...(imagePolishRecommendation ? [imagePolishRecommendation.reason] : [])
    ],
    guardrails: [
      'Do not emit executable shell or Python commands.',
      'Use K-Dense skills only as read-only plotting guidance.',
      'Use CNS/domain skills only as read-only planning guidance; do not execute third-party scripts.',
      'For paper figures, confirm figure conclusion, evidence logic, archetype, and export contract before rendering.',
      'Use the image model only as a final visual polish layer for insets, callouts, panel stitching, or explanatory annotations; prefer gpt-image-2 and fall back to the configured Model Router image model if needed.',
      'Render with SciForge controlled templates and review the output before presenting it.',
      'Do not alter data values during style repair.'
    ],
    skillHints: {
      recommendedSkills: uniqueStrings([
        'scientific-visualization',
        'matplotlib',
        template === 'schematic-grid' || template === 'flowchart' ? 'scientific-schematics' : 'seaborn',
        ...recommendedSkillIds.slice(0, 5)
      ]),
      recommendedLibraries: template === 'schematic-grid' || template === 'flowchart'
        ? ['Matplotlib', 'Scientific schematics']
        : template === 'multi-panel'
          ? ['Matplotlib', 'Seaborn', 'GridSpec']
        : template === 'attention-map'
          ? ['Matplotlib', 'Seaborn', 'Attention visualization']
          : template === 'box-violin'
            ? ['Matplotlib', 'Seaborn', 'Statistical comparison plots']
          : template === 'histogram-density'
            ? ['Matplotlib', 'Seaborn', 'Distribution plots']
          : ['Matplotlib', 'Seaborn']
    }
  }
}

export async function mapScientificPlottingData(
  request: ScientificPlottingDataMappingRequest
): Promise<ScientificPlottingDataMappingResult> {
  const task = request.task.trim()
  const warnings: string[] = []
  if (!task) {
    return {
      ok: false,
      status: 'invalid_request',
      message: 'Task is required.',
      missingInputs: ['task'],
      warnings
    }
  }
  try {
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const styleProfile = styleProfileForPlanning(
      request.styleSpec || request.styleSpecPath?.trim() ? undefined : request.styleProfileId,
      warnings
    )
    if (request.styleProfileId?.trim() && (request.styleSpec || request.styleSpecPath?.trim())) {
      warnings.push('styleProfileId was ignored because explicit styleSpec/styleSpecPath was provided.')
    }
    const styleSpec = await resolvePlanStyleSpec(request, workspaceRoot, warnings, styleProfile)
    const referenceProfile = styleProfile?.referenceProfile ?? (styleSpec
      ? inferReferenceProfileFromStyle(styleSpec, {
          task,
          templateHint: request.templateHint
        })
      : undefined)
    const styleProfileMatches = !styleProfile && styleSpec && referenceProfile
      ? rankStyleProfilesForStyleSpec(styleSpec, referenceProfile, task)
          .slice(0, 3)
          .map((match) => shapeStyleProfileMatchForResult(match, false))
      : undefined
    const recommendedProfile = styleProfile
      ? shapeStyleProfileForResult(styleProfile, false)
      : styleProfileMatches?.[0]?.profile
    const taskSignals = inferTemplateSignalsFromText(task)
    const taskTemplate = taskSignals[0] ?? 'line'
    const candidates = buildDataMappingCandidates(request.data, {
      task,
      labels: request.labels,
      taskTemplate,
      templateHint: request.templateHint,
      referenceProfile
    })
    if (candidates.length === 0) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: 'Could not map the provided data to a controlled plotting template.',
        missingInputs: [
          'Provide template-ready data, rows/records with numeric columns, a matrix, grouped values, or explicit panels.'
        ],
        warnings
      }
    }
    const selected = selectDataMappingCandidate(candidates, {
      templateHint: request.templateHint,
      taskTemplate,
      referenceProfile
    })
    try {
      validateTemplateData(selected.template, selected.data)
    } catch (error) {
      return {
        ok: false,
        status: 'invalid_request',
        message: error instanceof Error ? error.message : String(error),
        missingInputs: requiredInputsForTemplate(selected.template),
        warnings: [...warnings, ...selected.warnings]
      }
    }

    const selectedBy = request.templateHint && selected.template === request.templateHint
      ? 'templateHint'
      : selected.template === taskTemplate
        ? 'task'
        : referenceProfile && selected.template === referenceProfile.recommendedTemplate
          ? 'referenceProfile'
          : 'dataShape'
    const labels = mergeLabels(request.labels, selected.labels)
    const templateAdvice = buildTemplateAdvice(selected.template, referenceProfile, undefined)
    const renderRequest: ScientificPlottingRenderRequest = {
      workspaceRoot,
      template: selected.template,
      data: selected.data,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      ...(request.figureId ? { figureId: request.figureId } : {}),
      ...(request.styleSpec ? { styleSpec: request.styleSpec } : {}),
      ...(request.styleSpecPath ? { styleSpecPath: request.styleSpecPath } : {}),
      ...(styleProfile && request.styleProfileId ? { styleProfileId: styleProfile.id } : {}),
      ...(!request.styleSpec && !request.styleSpecPath && !styleProfile && recommendedProfile ? { styleProfileId: recommendedProfile.id } : {}),
      ...(request.referencePath ? { referencePath: request.referencePath } : {}),
      ...(request.reviewReferencePath ? { reviewReferencePath: request.reviewReferencePath } : {}),
      ...(request.outputDir ? { outputDir: request.outputDir } : {}),
      ...(request.outputScale ? { outputScale: request.outputScale } : {}),
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.autoRepair ? { autoRepair: request.autoRepair } : {})
    }
    return {
      ok: true,
      status: 'mapped',
      selectedTemplate: selected.template,
      confidence: Number(selected.confidence.toFixed(2)),
      renderRequest,
      ...(referenceProfile ? { referenceProfile } : {}),
      ...(templateAdvice ? { templateAdvice } : {}),
      ...(recommendedProfile ? {
        styleProfileId: recommendedProfile.id,
        styleProfile: recommendedProfile
      } : {}),
      ...(styleProfileMatches ? { styleProfileMatches } : {}),
      dataSummary: selected.summary,
      mappingBasis: {
        taskSignals,
        dataSignals: selected.dataSignals,
        selectedBy,
        reasons: selected.reasons
      },
      alternatives: candidates
        .filter((candidate) => candidate.template !== selected.template)
        .slice(0, 4)
        .map((candidate) => ({
          template: candidate.template,
          confidence: Number(candidate.confidence.toFixed(2)),
          reason: candidate.reasons[0] ?? 'Alternative data mapping.'
        })),
      warnings: [...warnings, ...selected.warnings, ...(templateAdvice?.messages ?? [])],
      guardrails: [
        'This tool maps data into a controlled render request; it does not render or write files.',
        'Mapping may reshape records into template JSON, but it must not execute user code.',
        'If duplicate summary rows are aggregated, review the mapping warning before rendering.',
        'Use scientific_plotting_render for artifact creation and scientific_plotting_review for style QA.'
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : 'invalid_request',
      message,
      missingInputs: [],
      warnings
    }
  }
}

export async function reviewScientificPlottingOutput(
  request: ScientificPlottingReviewRequest
): Promise<ScientificPlottingReviewResult> {
  const baseReview = await reviewFigureStyleOutput({
    workspaceRoot: request.workspaceRoot,
    referencePath: request.referencePath,
    outputPath: request.outputPath,
    minOverall: request.minOverall
  })
  if (!baseReview.ok) return baseReview

  const referenceProfile = await inferReferenceProfileFromReferencePath(request)
  const templateAdvice = buildTemplateAdvice(request.template, referenceProfile, baseReview.score)
  return {
    ...baseReview,
    ...(request.template ? { template: request.template } : {}),
    ...(referenceProfile ? { referenceProfile } : {}),
    ...(templateAdvice ? { templateAdvice } : {})
  }
}

export async function runScientificPlottingStyleTransfer(
  request: ScientificPlottingStyleTransferRequest
): Promise<ScientificPlottingStyleTransferResult> {
  const warnings: string[] = []
  try {
    const task = request.task.trim()
    if (!task) {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'Task is required.',
        warnings
      }
    }
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const figureId = slugForFigureId(request.figureId ?? `v2-style-transfer-${new Date().toISOString()}`)

    let preparedReference: Extract<ScientificPlottingPrepareReferenceResult, { ok: true }> | undefined
    let referenceImagePath = request.reference?.referencePath?.trim()
    let effectiveStyleSpec = request.styleSpec
    let effectiveStyleSpecPath = request.styleSpecPath?.trim()

    if (request.reference?.sourcePath?.trim()) {
      const prepared = await prepareScientificPlottingReference({
        workspaceRoot,
        sourcePath: request.reference.sourcePath,
        ...(request.reference.sourceType ? { sourceType: request.reference.sourceType } : {}),
        ...(request.reference.page ? { page: request.reference.page } : {}),
        ...(request.reference.cropBox ? { cropBox: request.reference.cropBox } : {}),
        figureId: request.reference.figureId ?? `${figureId}-reference`,
        outputDir,
        ...(request.reference.dpi ? { dpi: request.reference.dpi } : {}),
        extractStyle: true
      })
      if (!prepared.ok) {
        return {
          ok: false,
          status: 'reference_failed',
          message: prepared.message,
          preparedReference: prepared,
          warnings: [...warnings, ...(prepared.warnings ?? [])]
        }
      }
      preparedReference = prepared
      referenceImagePath = prepared.croppedImagePath
      if (!effectiveStyleSpec && !effectiveStyleSpecPath && prepared.styleSpecPath) {
        effectiveStyleSpecPath = prepared.styleSpecPath
      }
    }

    const hasExplicitStyleSpec = Boolean(effectiveStyleSpec || effectiveStyleSpecPath)
    if (request.styleProfileId?.trim() && hasExplicitStyleSpec) {
      warnings.push('styleProfileId was ignored because explicit styleSpec/styleSpecPath was provided.')
    }

    const styleProfiles = await selectStyleProfilesForTransfer({
      workspaceRoot,
      referenceImagePath,
      styleSpec: effectiveStyleSpec,
      styleSpecPath: effectiveStyleSpecPath,
      explicitStyleProfileId: hasExplicitStyleSpec ? undefined : request.styleProfileId,
      warnings
    })
    if (request.styleProfileId?.trim() && !hasExplicitStyleSpec && styleProfiles && !styleProfiles.ok) {
      return {
        ok: false,
        status: 'invalid_request',
        message: styleProfiles.message,
        preparedReference,
        styleProfiles,
        warnings
      }
    }
    const selectedStyleProfileId = (!hasExplicitStyleSpec && request.styleProfileId?.trim()) ||
      (!hasExplicitStyleSpec && styleProfiles?.ok ? styleProfiles.selectedProfile?.id : undefined)

    const plan = await planScientificPlotting({
      workspaceRoot,
      task,
      ...(request.templateHint ? { templateHint: request.templateHint } : {}),
      ...(effectiveStyleSpec ? { styleSpec: effectiveStyleSpec } : {}),
      ...(effectiveStyleSpecPath ? { styleSpecPath: effectiveStyleSpecPath } : {}),
      ...(!hasExplicitStyleSpec && selectedStyleProfileId ? { styleProfileId: selectedStyleProfileId } : {}),
      ...(referenceImagePath ? { referencePath: referenceImagePath } : {})
    })
    if (!plan.ok) {
      return {
        ok: false,
        status: 'invalid_request',
        message: plan.message,
        preparedReference,
        ...(styleProfiles ? { styleProfiles } : {}),
        plan,
        warnings
      }
    }

    const mapping = await mapScientificPlottingData({
      workspaceRoot,
      task,
      data: request.data,
      ...(request.labels ? { labels: request.labels } : {}),
      ...(request.templateHint ? { templateHint: request.templateHint } : {}),
      ...(effectiveStyleSpec ? { styleSpec: effectiveStyleSpec } : {}),
      ...(effectiveStyleSpecPath ? { styleSpecPath: effectiveStyleSpecPath } : {}),
      ...(!hasExplicitStyleSpec && selectedStyleProfileId ? { styleProfileId: selectedStyleProfileId } : {}),
      ...(referenceImagePath ? { referencePath: referenceImagePath, reviewReferencePath: referenceImagePath } : {}),
      figureId,
      outputDir,
      ...(request.outputScale ? { outputScale: request.outputScale } : {}),
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      autoRepair: request.autoRepair ?? { enabled: true, maxAttempts: 1, minOverall: 0.82 }
    })
    if (!mapping.ok) {
      return {
        ok: false,
        status: 'mapping_failed',
        message: mapping.message,
        preparedReference,
        ...(styleProfiles ? { styleProfiles } : {}),
        plan,
        mapping,
        warnings: [...warnings, ...mapping.warnings]
      }
    }

    const render = await renderScientificPlot({
      ...mapping.renderRequest,
      workspaceRoot,
      figureId,
      outputDir,
      ...(request.outputScale ? { outputScale: request.outputScale } : {}),
      ...(referenceImagePath ? { referencePath: referenceImagePath, reviewReferencePath: referenceImagePath } : {}),
      autoRepair: request.autoRepair ?? mapping.renderRequest.autoRepair ?? { enabled: true, maxAttempts: 1, minOverall: 0.82 }
    })
    if (!render.ok) {
      return {
        ok: false,
        status: 'render_failed',
        message: render.message,
        preparedReference,
        ...(styleProfiles ? { styleProfiles } : {}),
        plan,
        mapping,
        render,
        warnings: [...warnings, ...(render.warnings ?? [])]
      }
    }

    let reviewPacket: ScientificPlottingReviewPacketResult | undefined
    if (request.createReviewPacket !== false) {
      reviewPacket = await createScientificPlottingReviewPacket({
        workspaceRoot,
        manifestPaths: [render.manifestPath],
        packetId: `${figureId}-review-packet`,
        outputDir,
        title: `v2 Scientific Plotting Style Transfer: ${task.slice(0, 90)}`
      })
      if (!reviewPacket.ok) {
        return {
          ok: false,
          status: 'review_packet_failed',
          message: reviewPacket.message,
          preparedReference,
          ...(styleProfiles ? { styleProfiles } : {}),
          plan,
          mapping,
          render,
          reviewPacket,
          warnings: [...warnings, ...(reviewPacket.warnings ?? [])]
        }
      }
    }

    const reviewWarnings = render.review?.ok
      ? [
          ...(render.review.status === 'pass' ? [] : [`Final style review status: ${render.review.status}.`]),
          ...render.review.score.warnings
        ]
      : []
    const finalWarnings = uniqueReviewStrings([...warnings, ...render.warnings, ...reviewWarnings])
    const styleTransferManifest: ScientificPlottingStyleTransferManifest = {
      version: 2,
      tool: 'scientific_plotting_style_transfer',
      createdAt: new Date().toISOString(),
      requestHash: hashStyleTransferRequest(request),
      task,
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(request.outputScale ? { outputScale: normalizeOutputScale(request.outputScale) } : {}),
      ...(referenceImagePath ? { referenceImagePath } : {}),
      ...(effectiveStyleSpecPath ? { styleSpecPath: effectiveStyleSpecPath } : {}),
      selectedTemplate: mapping.selectedTemplate,
      ...(render.styleProfileId ?? selectedStyleProfileId ? { selectedStyleProfileId: render.styleProfileId ?? selectedStyleProfileId } : {}),
      outputPath: render.outputPath,
      renderManifestPath: render.manifestPath,
      artifactManifestPath: render.artifactManifestPath,
      ...(render.review?.ok ? {
        reviewStatus: render.review.status,
        reviewScore: render.review.score
      } : {}),
      ...(reviewPacket?.ok ? {
        reviewPacketPath: reviewPacket.packetPath,
        reviewPacketJsonPath: reviewPacket.packetJsonPath
      } : {}),
      warnings: finalWarnings,
      guardrails: [
        'This v2 workflow executes only SciForge first-party controlled plotting code.',
        'Reference figures are used as style guidance only; data values and statistics come from structured input.',
        'Auto-repair is limited to bounded visual parameters and never changes source data.',
        'K-Dense skills may inform planning but are not executed by this workflow.'
      ]
    }
    const styleTransferManifestPath = join(outputDir, `${figureId}.style-transfer.json`)
    await writeFile(styleTransferManifestPath, `${JSON.stringify(styleTransferManifest, null, 2)}\n`, 'utf8')

    return {
      ok: true,
      status: render.status === 'review_failed' ? 'review_failed' : reviewPacket?.ok ? 'completed' : 'rendered',
      ...(referenceImagePath ? { referenceImagePath } : {}),
      ...(preparedReference ? { preparedReference } : {}),
      ...(styleProfiles ? { styleProfiles } : {}),
      plan,
      mapping,
      render,
      ...(reviewPacket ? { reviewPacket } : {}),
      outputPath: render.outputPath,
      renderManifestPath: render.manifestPath,
      artifactManifestPath: render.artifactManifestPath,
      styleTransferManifestPath,
      styleTransferManifest,
      warnings: finalWarnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : 'invalid_request',
      message,
      warnings
    }
  }
}

export async function createScientificPlottingReviewPacket(
  request: ScientificPlottingReviewPacketRequest
): Promise<ScientificPlottingReviewPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const rawManifestPaths = [...new Set(request.manifestPaths.map((item) => item.trim()).filter(Boolean))]
    if (rawManifestPaths.length === 0) {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'At least one render manifest path is required.',
        warnings
      }
    }
    const maxItems = Math.max(1, Math.min(MAX_REVIEW_PACKET_ITEMS, Math.floor(request.maxItems ?? MAX_REVIEW_PACKET_ITEMS)))
    const manifestPaths = rawManifestPaths.slice(0, maxItems)
    if (rawManifestPaths.length > maxItems) {
      warnings.push(`Review packet was limited to ${maxItems} manifests.`)
    }

    const outputDir = await resolveReviewPacketOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const items: ScientificPlottingReviewPacketItem[] = []
    for (const rawManifestPath of manifestPaths) {
      const manifestPath = await resolveOpenTargetPath(rawManifestPath, workspaceRoot, {
        allowBasenameFallback: false
      })
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
      const manifest = parseScientificPlottingManifest(parsed)
      if (!manifest) {
        throw new Error(`Invalid scientific plotting render manifest: ${rawManifestPath}`)
      }
      const outputPath = await resolveTargetPathWithinWorkspace(manifest.outputPath, workspaceRoot)
      items.push(buildReviewPacketItem({
        manifestPath,
        outputPath,
        manifest
      }))
    }

    const title = request.title?.trim() || 'Scientific Plotting Review Packet'
    const packet: ScientificPlottingReviewPacket = {
      version: 1,
      tool: 'scientific_plotting_review_packet',
      createdAt: new Date().toISOString(),
      title,
      itemCount: items.length,
      items,
      summary: summarizeReviewPacketItems(items, warnings),
      guardrails: [
        'This packet summarizes existing SciForge render manifests; it does not rerender figures.',
        'Warnings are diagnostic signals for human or agent review, not automatic proof of scientific correctness.',
        'Recommended actions may adjust style/layout only and must not alter source data or statistics.',
        'K-Dense skills remain read-only planning knowledge and are not executed by this packet tool.'
      ]
    }

    const packetId = slugForFigureId(request.packetId ?? `review-packet-${new Date().toISOString()}`)
    const packetJsonPath = join(outputDir, `${packetId}.json`)
    const packetPath = join(outputDir, `${packetId}.md`)
    await writeFile(packetJsonPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
    await writeFile(packetPath, renderReviewPacketMarkdown(packet), 'utf8')

    return {
      ok: true,
      status: 'created',
      packetPath,
      packetJsonPath,
      packet,
      warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace')
        ? 'invalid_workspace'
        : message.includes('manifest') || message.includes('JSON')
          ? 'manifest_read_failed'
          : 'invalid_request',
      message,
      warnings
    }
  }
}

export async function prepareScientificPlottingReference(
  request: ScientificPlottingPrepareReferenceRequest
): Promise<ScientificPlottingPrepareReferenceResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const sourcePath = await resolveOpenTargetPath(request.sourcePath, workspaceRoot, {
      allowBasenameFallback: true
    })
    const sourceInfo = await stat(sourcePath)
    if (sourceInfo.isDirectory()) throw new Error('Reference source must be a file.')
    const sourceType = inferReferenceSourceType(sourcePath, request.sourceType)
    if (sourceType === 'image' && sourceInfo.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error('Reference image is too large.')
    }
    if (sourceType === 'pdf' && sourceInfo.size > MAX_REFERENCE_PDF_BYTES) {
      throw new Error('Reference PDF is too large.')
    }

    const outputDir = await resolveReferenceOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const figureId = slugForFigureId(request.figureId ?? `${basename(sourcePath, extensionFromName(sourcePath))}-reference`)
    const page = normalizePdfPage(request.page)
    const imageSource = sourceType === 'pdf'
      ? await renderPdfPageForCrop({
          workspaceRoot,
          sourcePath,
          page,
          dpi: normalizeReferenceDpi(request.dpi),
          figureId
        })
      : { path: sourcePath, tempPath: undefined as string | undefined }

    const crop = await cropImageToPng({
      sourcePath: imageSource.path,
      outputPath: join(outputDir, `${figureId}.png`),
      cropBox: request.cropBox
    })
    if (imageSource.tempPath) {
      await rm(imageSource.tempPath, { force: true })
    }

    let styleSpec: FigureStyleSpec | undefined
    let styleSpecPath: string | undefined
    let referenceProfile: ScientificPlottingReferenceProfile | undefined
    let styleProfileMatches: ScientificPlottingStyleProfileMatch[] | undefined
    let recommendedStyleProfile: ScientificPlottingStyleProfileSummary | undefined
    if (request.extractStyle !== false) {
      const extracted = await extractFigureStyle({
        workspaceRoot,
        sourcePath: crop.outputPath,
        sourceType: 'image',
        figureId
      })
      if (extracted.ok) {
        styleSpec = extracted.spec
        referenceProfile = inferReferenceProfileFromStyle(extracted.spec, {
          task: request.figureId
        })
        styleProfileMatches = rankStyleProfilesForStyleSpec(extracted.spec, referenceProfile)
          .slice(0, 3)
          .map((match) => shapeStyleProfileMatchForResult(match, false))
        recommendedStyleProfile = styleProfileMatches[0]?.profile
        styleSpecPath = join(outputDir, `${figureId}.style.json`)
        await writeFile(styleSpecPath, `${JSON.stringify({
          spec: extracted.spec,
          applyPlan: extracted.applyPlan,
          diagnostics: extracted.diagnostics,
          referenceProfile,
          styleProfileMatches,
          recommendedStyleProfile
        }, null, 2)}\n`, 'utf8')
      } else {
        warnings.push(`Style extraction failed: ${extracted.message}`)
      }
    }

    const source = {
      path: sourcePath,
      type: sourceType,
      ...(sourceType === 'pdf' ? { page } : {}),
      width: crop.sourceWidth,
      height: crop.sourceHeight
    }
    const referenceManifestPath = join(outputDir, `${figureId}.reference.json`)
    const referenceManifest: ScientificPlottingReferenceManifest = {
      version: 1,
      tool: 'scientific_plotting_prepare_reference',
      createdAt: new Date().toISOString(),
      requestHash: hashPrepareReferenceRequest(request),
      source,
      cropBox: crop.cropBox,
      croppedImagePath: crop.outputPath,
      ...(styleSpecPath ? { styleSpecPath } : {}),
      ...(referenceProfile ? { referenceProfile } : {}),
      ...(styleProfileMatches ? { styleProfileMatches } : {}),
      ...(recommendedStyleProfile ? { recommendedStyleProfile } : {}),
      warnings,
      nextWorkflow: {
        ...(styleSpecPath ? { styleSpecPath } : {}),
        referencePath: crop.outputPath,
        ...(recommendedStyleProfile ? { suggestedStyleProfileId: recommendedStyleProfile.id } : {}),
        suggestedProfileTool: 'scientific_plotting_style_profiles',
        suggestedPlanTool: 'scientific_plotting_plan',
        suggestedRenderTool: 'scientific_plotting_render',
        suggestedReviewTool: 'scientific_plotting_review',
        guardrails: [
          'Use the cropped PNG as the review reference, not the full paper page.',
          'Use StyleSpec as styling guidance only; do not execute third-party skill scripts.',
          'Render with SciForge controlled templates and review before presenting the figure.'
        ]
      }
    }
    await writeFile(referenceManifestPath, `${JSON.stringify(referenceManifest, null, 2)}\n`, 'utf8')

    return {
      ok: true,
      status: 'prepared',
      source,
      cropBox: crop.cropBox,
      croppedImagePath: crop.outputPath,
      ...(styleSpecPath ? { styleSpecPath } : {}),
      referenceManifestPath,
      referenceManifest,
      ...(styleSpec ? { styleSpec } : {}),
      ...(referenceProfile ? { referenceProfile } : {}),
      ...(styleProfileMatches ? { styleProfileMatches } : {}),
      ...(recommendedStyleProfile ? { recommendedStyleProfile } : {}),
      warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace')
        ? 'invalid_workspace'
        : message.includes('pdftoppm')
          ? 'pdf_renderer_unavailable'
          : message.includes('Unsupported')
            ? 'unsupported_source'
            : 'invalid_request',
      message,
      warnings
    }
  }
}

export async function renderScientificPlot(
  request: ScientificPlottingRenderRequest
): Promise<ScientificPlottingRenderResult> {
  const warnings: string[] = []
  try {
    validateRenderRequestShape(request)
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    validateTemplateData(request.template, request.data)
    const draftHandoff = buildDiagramDraftHandoffForRender(request)
    if (draftHandoff) {
      return {
        ok: false,
        status: 'diagram_requires_image_generation',
        message: 'This diagram request should not be finalized by scientific_plotting_render. Treat the structured output as a draft and use image_generation_plan/image_generation_render for the polished figure.',
        draftHandoff,
        warnings: [
          ...warnings,
          'scientific_plotting_render is blocked for semantic diagrams so Matplotlib draft boxes are not presented as final artwork.',
          'Use the draftHandoff as the structure/spec for image_generation.'
        ]
      }
    }
    if (request.styleProfileId?.trim() && (request.styleSpec || request.styleSpecPath?.trim())) {
      warnings.push('styleProfileId was ignored because explicit styleSpec/styleSpecPath was provided.')
    }
    const styleProfile = styleProfileForRender(request)
    const outputScale = normalizeOutputScale(request.outputScale)
    const styleSpec = scaleStyleSpecForOutput(
      await resolveRenderStyleSpec(request, workspaceRoot, styleProfile),
      outputScale
    )
    if (outputScale > 1) {
      warnings.push(`outputScale=${outputScale} increased export DPI to ${styleSpec.export.dpi} for print-ready raster output.`)
    }
    const referenceProfile = styleProfile?.referenceProfile ?? inferReferenceProfileFromStyle(styleSpec, {
      task: request.labels?.title
    })
    const templateAdvice = buildTemplateAdvice(request.template, referenceProfile, undefined)
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })

    const matplotlib = await checkMatplotlib(workspaceRoot)
    if (!matplotlib.available) {
      return {
        ok: false,
        status: 'renderer_unavailable',
        message: matplotlib.message ?? 'Matplotlib is unavailable.',
        warnings
      }
    }

    const figureId = slugForFigureId(request.figureId ?? `${request.template}-${new Date().toISOString()}`)
    const baseOutputPath = join(outputDir, `${figureId}.png`)
    const referencePath = request.referencePath ?? request.reviewReferencePath
    const attempts: ScientificPlottingAttempt[] = []
    const autoRepair = normalizeAutoRepairOptions(request.autoRepair)
    const first = await renderAttempt({
      request,
      workspaceRoot,
      styleSpec,
      outputPath: baseOutputPath
    })
    if (!first.ok) return first.error

    let finalOutputPath = baseOutputPath
    let finalReview: ScientificPlottingReviewResult | undefined
    let status: 'rendered' | 'repaired' | 'review_failed' = 'rendered'

    let firstReview: FigureStyleReviewResult | undefined
    if (referencePath) {
      firstReview = await reviewFigureStyleOutput({
        workspaceRoot,
        referencePath,
        outputPath: baseOutputPath,
        minOverall: autoRepair.minOverall
      })
      finalReview = decorateReviewWithPlottingContext(firstReview, request.template, referenceProfile)
      if (!firstReview.ok) {
        status = 'review_failed'
        warnings.push(firstReview.message)
      }
    }
    attempts.push({
      attempt: 1,
      outputPath: baseOutputPath,
      repaired: false,
      ...(finalReview ? { review: finalReview } : {}),
      ...(first.rendererDiagnostics ? { rendererDiagnostics: first.rendererDiagnostics } : {}),
      warnings: [...warnings]
    })

    if (
      referencePath &&
      firstReview?.ok &&
      firstReview.autoRepair.shouldRerender &&
      autoRepair.enabled &&
      autoRepair.maxAttempts > 0
    ) {
      const repairedOutputPath = join(outputDir, `${figureId}-repaired.png`)
      const repair = await renderAttempt({
        request,
        workspaceRoot,
        styleSpec,
        outputPath: repairedOutputPath,
        rcParamsPatch: firstReview.autoRepair.rcParamsPatch,
        paletteOverride: firstReview.autoRepair.palette
      })
      if (!repair.ok) return repair.error
      const repairedReview = await reviewFigureStyleOutput({
        workspaceRoot,
        referencePath,
        outputPath: repairedOutputPath,
        minOverall: autoRepair.minOverall
      })
      finalOutputPath = repairedOutputPath
      finalReview = decorateReviewWithPlottingContext(repairedReview, request.template, referenceProfile)
      status = 'repaired'
      attempts.push({
        attempt: 2,
        outputPath: repairedOutputPath,
        repaired: true,
        review: finalReview,
        rcParamsPatch: firstReview.autoRepair.rcParamsPatch,
        ...(repair.rendererDiagnostics ? { rendererDiagnostics: repair.rendererDiagnostics } : {}),
        warnings: repairedReview.ok ? repairedReview.score.warnings : [repairedReview.message]
      })
    }

    const manifestPath = join(outputDir, `${figureId}.manifest.json`)
    const manifest: ScientificPlottingManifest = {
      version: 1,
      renderer: 'sciforge-scientific-plotting-mcp',
      rendererVersion: RENDERER_VERSION,
      tool: 'scientific_plotting_render',
      template: request.template,
      referenceProfile,
      ...(templateAdvice ? { templateAdvice } : {}),
      ...(styleProfile ? {
        styleProfileId: styleProfile.id,
        styleProfile: shapeStyleProfileForResult(styleProfile, false)
      } : {}),
      createdAt: new Date().toISOString(),
      requestHash: hashRequest(request),
      outputPath: finalOutputPath,
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(outputScale > 1 ? { outputScale } : {}),
      ...(request.styleSpecPath ? { styleSpecPath: request.styleSpecPath } : {}),
      ...(referencePath ? { referencePath } : {}),
      attempts,
      ...(finalReview ? { finalReview } : {}),
      warnings
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const artifactManifestPath = await writeScientificPlottingArtifactManifest({
      workspaceRoot,
      figureId,
      outputPath: finalOutputPath,
      manifestPath,
      request,
      styleSpec,
      review: finalReview
    })
    return {
      ok: true,
      status,
      outputPath: finalOutputPath,
      manifestPath,
      artifactManifestPath,
      attempts,
      ...(finalReview ? { review: finalReview } : {}),
      referenceProfile,
      ...(templateAdvice ? { templateAdvice } : {}),
      ...(styleProfile ? {
        styleProfileId: styleProfile.id,
        styleProfile: shapeStyleProfileForResult(styleProfile, false)
      } : {}),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Error && error.message.includes('workspace') ? 'invalid_workspace' : 'invalid_request',
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

async function renderAttempt(input: {
  request: ScientificPlottingRenderRequest
  workspaceRoot: string
  styleSpec: FigureStyleSpec
  outputPath: string
  rcParamsPatch?: Record<string, string | number | boolean>
  paletteOverride?: string[]
}): Promise<{ ok: true; rendererDiagnostics?: RendererDiagnostics } | { ok: false; error: ScientificPlottingRenderResult }> {
  const applyPlan = buildFigureStyleApplyPlan(input.styleSpec)
  const rcParams = enforceReadableTextColors(enforcePublicationTypography({
    ...applyPlan.matplotlibHints.rcParams,
    ...(input.rcParamsPatch ?? {})
  }))
  const payload: RenderPayload = {
    template: input.request.template,
    data: input.request.data,
    labels: input.request.labels ?? {},
    outputPath: input.outputPath,
    styleSpec: input.styleSpec,
    rcParams,
    palette: input.paletteOverride ?? applyPlan.matplotlibHints.palette,
    ...heatmapCmapForRequest(
      input.request,
      input.styleSpec,
      input.paletteOverride ?? applyPlan.matplotlibHints.palette
    )
  }
  const run = await runPythonRenderer(payload, input.workspaceRoot)
  if (!run.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        status: 'render_failed',
        message: run.message,
        stdoutTail: tail(run.stdout),
        stderrTail: tail(run.stderr)
      }
    }
  }
  return { ok: true, ...parseRendererDiagnostics(run.stdout) }
}

function parseRendererDiagnostics(stdout: string): { rendererDiagnostics?: RendererDiagnostics } {
  const lastLine = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!lastLine) return {}
  try {
    const parsed = JSON.parse(lastLine) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.rendererDiagnostics)) return {}
    const diagnostics = parsed.rendererDiagnostics
    const layoutNotes = isStringArray(diagnostics.layoutNotes, 0, 20)
      ? diagnostics.layoutNotes
      : []
    const legendPlacement = diagnostics.legendPlacement === 'inside' ||
      diagnostics.legendPlacement === 'outside-right' ||
      diagnostics.legendPlacement === 'none'
      ? diagnostics.legendPlacement
      : undefined
    const barOrientation = diagnostics.barOrientation === 'vertical' ||
      diagnostics.barOrientation === 'horizontal'
      ? diagnostics.barOrientation
      : undefined
    const barColorMode = diagnostics.barColorMode === 'series' ||
      diagnostics.barColorMode === 'per-bar'
      ? diagnostics.barColorMode
      : undefined
    const categoryLabelRotation = typeof diagnostics.categoryLabelRotation === 'number' &&
      Number.isFinite(diagnostics.categoryLabelRotation)
      ? diagnostics.categoryLabelRotation
      : undefined
    const savefigPadInches = typeof diagnostics.savefigPadInches === 'number' &&
      Number.isFinite(diagnostics.savefigPadInches)
      ? diagnostics.savefigPadInches
      : undefined
    const multiPanelCount = typeof diagnostics.multiPanelCount === 'number' &&
      Number.isInteger(diagnostics.multiPanelCount) &&
      diagnostics.multiPanelCount > 0
      ? diagnostics.multiPanelCount
      : undefined
    const schematicNodeCount = typeof diagnostics.schematicNodeCount === 'number' &&
      Number.isInteger(diagnostics.schematicNodeCount) &&
      diagnostics.schematicNodeCount > 0
      ? diagnostics.schematicNodeCount
      : undefined
    const schematicEdgeCount = typeof diagnostics.schematicEdgeCount === 'number' &&
      Number.isInteger(diagnostics.schematicEdgeCount) &&
      diagnostics.schematicEdgeCount >= 0
      ? diagnostics.schematicEdgeCount
      : undefined
    const schematicExplicitPositions = typeof diagnostics.schematicExplicitPositions === 'boolean'
      ? diagnostics.schematicExplicitPositions
      : undefined
    const typography = isRecord(diagnostics.typography)
      ? parseRendererTypographyDiagnostics(diagnostics.typography)
      : undefined
    const fontFallback = isRecord(diagnostics.fontFallback)
      ? { cjk: typeof diagnostics.fontFallback.cjk === 'string' ? diagnostics.fontFallback.cjk : null }
      : undefined
    const layoutQuality = isRecord(diagnostics.layoutQuality)
      ? parseRendererLayoutQualityDiagnostics(diagnostics.layoutQuality)
      : undefined
    return {
      rendererDiagnostics: {
        ...(fontFallback ? { fontFallback } : {}),
        ...(legendPlacement ? { legendPlacement } : {}),
        ...(barOrientation ? { barOrientation } : {}),
        ...(barColorMode ? { barColorMode } : {}),
        ...(categoryLabelRotation !== undefined ? { categoryLabelRotation } : {}),
        ...(savefigPadInches !== undefined ? { savefigPadInches } : {}),
        ...(multiPanelCount !== undefined ? { multiPanelCount } : {}),
        ...(schematicNodeCount !== undefined ? { schematicNodeCount } : {}),
        ...(schematicEdgeCount !== undefined ? { schematicEdgeCount } : {}),
        ...(schematicExplicitPositions !== undefined ? { schematicExplicitPositions } : {}),
        ...(typography ? { typography } : {}),
        ...(layoutQuality ? { layoutQuality } : {}),
        layoutNotes
      }
    }
  } catch {
    return {}
  }
}

function parseRendererTypographyDiagnostics(value: Record<string, unknown>): RendererDiagnostics['typography'] | undefined {
  const titleSize = finiteNumber(value.titleSize)
  const labelSize = finiteNumber(value.labelSize)
  const tickSize = finiteNumber(value.tickSize)
  const legendSize = finiteNumber(value.legendSize)
  const panelSize = finiteNumber(value.panelSize)
  if (
    titleSize === undefined ||
    labelSize === undefined ||
    tickSize === undefined ||
    legendSize === undefined ||
    panelSize === undefined
  ) {
    return undefined
  }
  return {
    titleSize,
    labelSize,
    tickSize,
    legendSize,
    panelSize,
    publicationClampApplied: value.publicationClampApplied === true
  }
}

function parseRendererLayoutQualityDiagnostics(value: Record<string, unknown>): RendererDiagnostics['layoutQuality'] | undefined {
  const legendItemCount = finiteNumber(value.legendItemCount)
  const legendColumnCount = finiteNumber(value.legendColumnCount)
  const legendOverlapRisk = parseLayoutRisk(value.legendOverlapRisk)
  const textOverflowRisk = parseLayoutRisk(value.textOverflowRisk)
  if (
    legendItemCount === undefined ||
    legendColumnCount === undefined ||
    !legendOverlapRisk ||
    !textOverflowRisk
  ) {
    return undefined
  }
  return {
    legendItemCount,
    legendColumnCount,
    legendOutsidePlot: value.legendOutsidePlot === true,
    legendOverlapRisk,
    textOverflowRisk,
    panelLabelAdjusted: value.panelLabelAdjusted === true,
    warnings: isStringArray(value.warnings, 0, 12) ? value.warnings : []
  }
}

function parseLayoutRisk(value: unknown): 'none' | 'low' | 'medium' | 'high' | undefined {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high'
    ? value
    : undefined
}

async function writeScientificPlottingArtifactManifest(input: {
  workspaceRoot: string
  figureId: string
  outputPath: string
  manifestPath: string
  request: ScientificPlottingRenderRequest
  styleSpec: FigureStyleSpec
  review?: ScientificPlottingReviewResult
}): Promise<string> {
  const artifactsDir = join(input.workspaceRoot, '.sciforge', 'artifacts')
  await mkdir(artifactsDir, { recursive: true })
  const artifactManifestPath = join(artifactsDir, input.figureId + '.scientific-plot.artifact.json')
  const artifactManifest = {
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: 'scientific_plotting',
    artifactKind: 'scientific_plot',
    path: input.outputPath,
    outputPath: input.outputPath,
    manifestPath: input.manifestPath,
    ...(input.request.canvasId ? { canvasId: input.request.canvasId } : {}),
    ...(input.request.threadId ? { threadId: input.request.threadId } : {}),
    ...(input.request.outputScale ? { outputScale: normalizeOutputScale(input.request.outputScale) } : {}),
    ...(input.request.styleSpecPath ? { styleSpecPath: input.request.styleSpecPath } : {}),
    ...(input.request.referencePath || input.request.reviewReferencePath
      ? { referencePath: input.request.reviewReferencePath ?? input.request.referencePath }
      : {}),
    title: input.request.labels?.title ?? input.request.figureId ?? input.figureId,
    ...(input.review?.ok ? { reviewScore: input.review.score } : {})
  }
  await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8')
  return artifactManifestPath
}

function parseScientificPlottingManifest(value: unknown): ScientificPlottingManifest | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (value.renderer !== 'sciforge-scientific-plotting-mcp') return null
  if (value.tool !== 'scientific_plotting_render') return null
  if (!SCIENTIFIC_PLOTTING_TEMPLATES.includes(value.template as ScientificPlottingTemplate)) return null
  if (typeof value.outputPath !== 'string' || !value.outputPath.trim()) return null
  if (!Array.isArray(value.attempts)) return null
  return value as ScientificPlottingManifest
}

function buildReviewPacketItem(input: {
  manifestPath: string
  outputPath: string
  manifest: ScientificPlottingManifest
}): ScientificPlottingReviewPacketItem {
  const lastAttempt = input.manifest.attempts.at(-1)
  const review = okReview(input.manifest.finalReview) || okReview(lastAttempt?.review)
  const score = review?.score
  const status = inferManifestRenderStatus(input.manifest)
  const layoutQuality = lastAttempt?.rendererDiagnostics?.layoutQuality
  const typography = lastAttempt?.rendererDiagnostics?.typography
  const warnings = uniqueReviewStrings([
    ...stringItems(input.manifest.warnings),
    ...stringItems(score?.warnings),
    ...input.manifest.attempts.flatMap((attempt) => stringItems(attempt.warnings)),
    ...input.manifest.attempts.flatMap((attempt) => stringItems(attempt.rendererDiagnostics?.layoutQuality?.warnings)),
    ...stringItems(input.manifest.templateAdvice?.messages)
  ]).slice(0, 16)
  const notes = uniqueReviewStrings([
    ...input.manifest.attempts.flatMap((attempt) => stringItems(attempt.rendererDiagnostics?.layoutNotes)),
    ...(input.manifest.templateAdvice?.severity === 'warning' ? stringItems(input.manifest.templateAdvice.messages) : [])
  ]).slice(0, 12)
  const repairAttempted = input.manifest.attempts.some((attempt) => attempt.repaired)
  return {
    manifestPath: input.manifestPath,
    outputPath: input.outputPath,
    template: input.manifest.template,
    status,
    ...(input.manifest.createdAt ? { createdAt: input.manifest.createdAt } : {}),
    ...(score ? { score } : {}),
    ...(review ? { reviewStatus: review.status } : {}),
    repairAttempted,
    attempts: input.manifest.attempts.length,
    warnings,
    ...(layoutQuality ? { layoutQuality } : {}),
    ...(typography ? { typography } : {}),
    notes,
    recommendedActions: buildReviewPacketRecommendedActions({
      status,
      score,
      reviewStatus: review?.status,
      repairAttempted,
      layoutQuality,
      warnings
    })
  }
}

function summarizeReviewPacketItems(
  items: ScientificPlottingReviewPacketItem[],
  packetWarnings: string[]
): ScientificPlottingReviewPacket['summary'] {
  const scores = items
    .map((item) => item.score?.overall)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
  const total = scores.reduce((sum, score) => sum + score, 0)
  const needsAttention = items.filter((item) => reviewPacketItemNeedsAttention(item)).length
  return {
    rendered: items.filter((item) => item.status === 'rendered').length,
    repaired: items.filter((item) => item.status === 'repaired').length,
    reviewFailed: items.filter((item) => item.status === 'review_failed').length,
    needsAttention,
    pass: items.filter((item) => item.reviewStatus === 'pass').length,
    repairable: items.filter((item) => item.reviewStatus === 'repairable').length,
    manualReview: items.filter((item) => item.reviewStatus === 'manual_review').length,
    ...(scores.length > 0 ? {
      bestOverall: roundScore(Math.max(...scores)),
      worstOverall: roundScore(Math.min(...scores)),
      averageOverall: roundScore(total / scores.length)
    } : {}),
    warnings: uniqueReviewStrings([
      ...packetWarnings,
      ...items.flatMap((item) => item.warnings)
    ]).slice(0, 20)
  }
}

function renderReviewPacketMarkdown(packet: ScientificPlottingReviewPacket): string {
  const lines = [
    `# ${escapeMarkdown(packet.title)}`,
    '',
    `Generated at: ${packet.createdAt}`,
    '',
    '## Summary',
    '',
    `- Items: ${packet.itemCount}`,
    `- Rendered: ${packet.summary.rendered}`,
    `- Repaired: ${packet.summary.repaired}`,
    `- Review failed: ${packet.summary.reviewFailed}`,
    `- Needs attention: ${packet.summary.needsAttention}`,
    `- Overall score: best ${formatScore(packet.summary.bestOverall)}, average ${formatScore(packet.summary.averageOverall)}, worst ${formatScore(packet.summary.worstOverall)}`,
    ''
  ]
  if (packet.summary.warnings.length > 0) {
    lines.push('## Packet Warnings', '')
    for (const warning of packet.summary.warnings) {
      lines.push(`- ${escapeMarkdown(warning)}`)
    }
    lines.push('')
  }
  lines.push('## Figures', '')
  packet.items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${escapeMarkdown(item.template)} (${escapeMarkdown(item.status)})`)
    lines.push('')
    lines.push(`![${escapeMarkdown(item.template)} output](${item.outputPath})`)
    lines.push('')
    lines.push(`- Output: ${item.outputPath}`)
    lines.push(`- Manifest: ${item.manifestPath}`)
    lines.push(`- Attempts: ${item.attempts}${item.repairAttempted ? ' (repaired)' : ''}`)
    if (item.score) {
      lines.push(`- Score: overall ${formatScore(item.score.overall)}, palette ${formatScore(item.score.palette)}, axes ${formatScore(item.score.axes)}, grid ${formatScore(item.score.grid)}, layout ${formatScore(item.score.layout)}, marks ${formatScore(item.score.marks)}, typography ${formatScore(item.score.typography)}`)
    }
    if (item.layoutQuality) {
      lines.push(`- Layout QA: legend ${item.layoutQuality.legendOutsidePlot ? 'outside' : 'inside'}, overlap ${item.layoutQuality.legendOverlapRisk}, text ${item.layoutQuality.textOverflowRisk}, panel adjusted ${item.layoutQuality.panelLabelAdjusted}`)
    }
    if (item.typography) {
      lines.push(`- Typography: title ${item.typography.titleSize}, label ${item.typography.labelSize}, tick ${item.typography.tickSize}, legend ${item.typography.legendSize}, clamp ${item.typography.publicationClampApplied}`)
    }
    if (item.warnings.length > 0) {
      lines.push('- Warnings:')
      for (const warning of item.warnings) lines.push(`  - ${escapeMarkdown(warning)}`)
    }
    if (item.notes.length > 0) {
      lines.push('- Notes:')
      for (const note of item.notes) lines.push(`  - ${escapeMarkdown(note)}`)
    }
    lines.push('- Recommended actions:')
    for (const action of item.recommendedActions) lines.push(`  - ${escapeMarkdown(action)}`)
    lines.push('')
  })
  lines.push('## Guardrails', '')
  for (const guardrail of packet.guardrails) {
    lines.push(`- ${escapeMarkdown(guardrail)}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function inferManifestRenderStatus(manifest: ScientificPlottingManifest): ScientificPlottingReviewPacketItem['status'] {
  if (manifest.finalReview && !manifest.finalReview.ok) return 'review_failed'
  if (manifest.attempts.some((attempt) => attempt.repaired)) return 'repaired'
  if (manifest.outputPath) return 'rendered'
  return 'unknown'
}

function okReview(review: unknown): Extract<FigureStyleReviewResult, { ok: true }> | undefined {
  return isRecord(review) && review.ok === true && isRecord(review.score) ? review as Extract<FigureStyleReviewResult, { ok: true }> : undefined
}

function reviewPacketItemNeedsAttention(item: ScientificPlottingReviewPacketItem): boolean {
  if (item.status === 'review_failed') return true
  if (item.reviewStatus === 'repairable' || item.reviewStatus === 'manual_review') return true
  if (item.score && item.score.overall < 0.72) return true
  if (item.layoutQuality?.legendOverlapRisk === 'medium' || item.layoutQuality?.legendOverlapRisk === 'high') return true
  if (item.layoutQuality?.textOverflowRisk === 'medium' || item.layoutQuality?.textOverflowRisk === 'high') return true
  return item.warnings.length > 0
}

function buildReviewPacketRecommendedActions(input: {
  status: ScientificPlottingReviewPacketItem['status']
  score?: FigureStyleSimilarityScore
  reviewStatus?: ScientificPlottingReviewPacketItem['reviewStatus']
  repairAttempted: boolean
  layoutQuality?: ScientificPlottingReviewPacketItem['layoutQuality']
  warnings: string[]
}): string[] {
  const actions: string[] = []
  if (!input.score) {
    actions.push('Use scientific_plotting_review with a reference image before treating this figure as style-matched.')
  } else {
    if (input.score.overall < 0.72) {
      actions.push('Inspect reference similarity before acceptance; style match is currently weak.')
    }
    if (input.score.palette < 0.72) {
      actions.push('Tune palette mapping or use a closer StyleSpec palette.')
    }
    if (input.score.axes < 0.72 || input.score.grid < 0.72) {
      actions.push('Compare axes, spine, and grid visibility against the reference.')
    }
    if ((input.score.typography ?? 1) < 0.72) {
      actions.push('Review typography weight and label density at final figure size.')
    }
  }
  if (input.status === 'review_failed') {
    actions.push('Repair the missing or invalid review reference before relying on the score.')
  }
  if (input.reviewStatus === 'repairable') {
    actions.push('Allow one bounded style repair or inspect the repair history before final approval.')
  }
  if (input.reviewStatus === 'manual_review') {
    actions.push('Send this figure to visual user review before using it in a manuscript draft.')
  }
  if (input.repairAttempted) {
    actions.push('Compare the repaired output with the first attempt to ensure only style changed.')
  }
  if (input.layoutQuality?.legendOverlapRisk === 'medium' || input.layoutQuality?.legendOverlapRisk === 'high') {
    actions.push('Move or compact the legend because it may overlap the plotted data.')
  }
  if (input.layoutQuality?.textOverflowRisk === 'medium' || input.layoutQuality?.textOverflowRisk === 'high') {
    actions.push('Shorten labels or adjust margins because text overflow risk is elevated.')
  }
  if (input.warnings.length > 0 && actions.length === 0) {
    actions.push('Review warnings before accepting this figure.')
  }
  if (actions.length === 0) {
    actions.push('Ready for visual user review.')
  }
  return uniqueReviewStrings(actions).slice(0, 8)
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function uniqueReviewStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

function roundScore(score: number): number {
  return Number(score.toFixed(3))
}

function formatScore(score: number | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(3) : 'n/a'
}

function escapeMarkdown(value: string): string {
  return value.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim()
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function checkMatplotlib(workspaceRoot?: string): Promise<MatplotlibStatus> {
  const run = await runPython(
    ['-c', 'import matplotlib; print(matplotlib.__version__)'],
    '',
    workspaceRoot,
    12_000
  )
  if (!run.ok) {
    return {
      available: false,
      message: run.message || tail(run.stderr) || 'Matplotlib import failed.'
    }
  }
  return {
    available: true,
    version: run.stdout.trim().split('\n').at(-1)?.trim() || undefined
  }
}

async function checkPdfRenderer(): Promise<CommandStatus> {
  const errors: string[] = []
  for (const command of pdftoppmCandidates()) {
    const run = await runCommand(command, ['-v'], '', undefined, 8_000)
    if (run.ok || /pdftoppm/i.test(run.stderr) || /pdftoppm/i.test(run.stdout)) {
      return { available: true, command }
    }
    errors.push(`${command}: ${run.message || tail(run.stderr)}`)
  }
  return {
    available: false,
    command: PDFTOPPM_COMMAND,
    message: errors.join('; ') || 'pdftoppm is unavailable.'
  }
}

function pdftoppmCandidates(): string[] {
  const candidates = [
    PDFTOPPM_COMMAND,
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm'),
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdftoppm')
  ]
  return [...new Set(candidates.filter(Boolean))]
}

async function runPythonRenderer(payload: RenderPayload, workspaceRoot: string): Promise<PythonRunResult> {
  return runPython(['-c', PYTHON_RENDERER_SOURCE], JSON.stringify(payload), workspaceRoot, 45_000)
}

async function runCommand(
  command: string,
  args: string[],
  stdin: string,
  cwd?: string,
  timeoutMs = 30_000
): Promise<PythonRunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolvePromise({
        ok: false,
        stdout,
        stderr,
        message: `${command} timed out after ${timeoutMs}ms.`
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolvePromise({
        ok: false,
        stdout,
        stderr,
        message: error.message
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) resolvePromise({ ok: true, stdout, stderr })
      else {
        resolvePromise({
          ok: false,
          stdout,
          stderr,
          message: tail(stderr) || `${command} exited with code ${code}.`
        })
      }
    })
    child.stdin.end(stdin)
  })
}

async function runPython(
  args: string[],
  stdin: string,
  workspaceRoot?: string,
  timeoutMs = 30_000
): Promise<PythonRunResult> {
  const mplConfigDir = workspaceRoot
    ? join(workspaceRoot, '.sciforge', 'matplotlib-cache')
    : join(tmpdir(), 'sciforge-matplotlib-cache')
  await mkdir(mplConfigDir, { recursive: true })
  return new Promise((resolvePromise) => {
    const child = spawn(PYTHON_COMMAND, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MPLCONFIGDIR: mplConfigDir
      }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolvePromise({
        ok: false,
        stdout,
        stderr,
        message: `Python renderer timed out after ${timeoutMs}ms.`
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolvePromise({
        ok: false,
        stdout,
        stderr,
        message: error.message
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise({ ok: true, stdout, stderr })
      } else {
        resolvePromise({
          ok: false,
          stdout,
          stderr,
          message: tail(stderr) || `Python renderer exited with code ${code}.`
        })
      }
    })
    child.stdin.end(stdin)
  })
}

async function resolveWorkspaceRoot(raw: string): Promise<string> {
  const value = raw.trim()
  if (!value) throw new Error('workspaceRoot is required.')
  const workspaceRoot = await canonicalPath(resolve(expandHomePath(value)))
  const info = await stat(workspaceRoot)
  if (!info.isDirectory()) throw new Error('workspaceRoot must be a directory.')
  return workspaceRoot
}

async function resolveOutputDir(workspaceRoot: string, rawOutputDir?: string): Promise<string> {
  if (!rawOutputDir?.trim()) return join(workspaceRoot, DEFAULT_OUTPUT_RELATIVE_DIR)
  const target = await resolveTargetPathWithinWorkspace(rawOutputDir, workspaceRoot)
  if (!isWithinWorkspace(workspaceRoot, target)) {
    throw new Error('Output directory must stay within the selected workspace.')
  }
  return target
}

async function resolveReferenceOutputDir(workspaceRoot: string, rawOutputDir?: string): Promise<string> {
  if (!rawOutputDir?.trim()) return join(workspaceRoot, DEFAULT_REFERENCE_RELATIVE_DIR)
  const target = await resolveTargetPathWithinWorkspace(rawOutputDir, workspaceRoot)
  if (!isWithinWorkspace(workspaceRoot, target)) {
    throw new Error('Reference output directory must stay within the selected workspace.')
  }
  return target
}

async function resolveReviewPacketOutputDir(workspaceRoot: string, rawOutputDir?: string): Promise<string> {
  if (!rawOutputDir?.trim()) return join(workspaceRoot, DEFAULT_REVIEW_PACKET_RELATIVE_DIR)
  const target = await resolveTargetPathWithinWorkspace(rawOutputDir, workspaceRoot)
  if (!isWithinWorkspace(workspaceRoot, target)) {
    throw new Error('Review packet output directory must stay within the selected workspace.')
  }
  return target
}

async function resolveRenderStyleSpec(
  request: ScientificPlottingRenderRequest,
  workspaceRoot: string,
  styleProfile?: ScientificPlottingStyleProfile
): Promise<FigureStyleSpec> {
  if (request.styleSpec) return request.styleSpec
  if (request.styleSpecPath?.trim()) {
    const stylePath = await resolveOpenTargetPath(request.styleSpecPath, workspaceRoot, {
      allowBasenameFallback: true
    })
    const parsed = JSON.parse(await readFile(stylePath, 'utf8')) as unknown
    const spec = unwrapFigureStyleSpec(parsed)
    if (!spec) {
      throw new Error('styleSpecPath must point to a FigureStyleSpec JSON file.')
    }
    return spec
  }
  if (styleProfile) return styleProfile.styleSpec
  return defaultFigureStyleSpec(request)
}

function normalizeOutputScale(outputScale: number | undefined): number {
  if (outputScale === undefined) return 1
  if (!Number.isFinite(outputScale) || outputScale < 1 || outputScale > 4) {
    throw new Error('outputScale must be a finite number between 1 and 4.')
  }
  return Number(outputScale.toFixed(3))
}

function scaleStyleSpecForOutput(styleSpec: FigureStyleSpec, outputScale: number): FigureStyleSpec {
  if (outputScale === 1) return styleSpec
  const scaled = JSON.parse(JSON.stringify(styleSpec)) as FigureStyleSpec
  const baseDpi = Number.isFinite(scaled.export.dpi) && scaled.export.dpi > 0
    ? scaled.export.dpi
    : 300
  scaled.export = {
    ...scaled.export,
    dpi: Math.round(baseDpi * outputScale)
  }
  return scaled
}

function inferReferenceSourceType(
  sourcePath: string,
  explicit?: 'image' | 'pdf'
): 'image' | 'pdf' {
  if (explicit) return explicit
  const ext = extensionFromName(sourcePath)
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  throw new Error(`Unsupported reference source type: ${ext || '(none)'}.`)
}

function normalizePdfPage(page?: number): number {
  if (page === undefined) return 1
  if (!Number.isInteger(page) || page < 1 || page > 5000) {
    throw new Error('PDF page must be an integer between 1 and 5000.')
  }
  return page
}

function normalizeReferenceDpi(dpi?: number): number {
  if (dpi === undefined) return 180
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 360) {
    throw new Error('Reference PDF render dpi must be between 72 and 360.')
  }
  return Math.round(dpi)
}

async function renderPdfPageForCrop(input: {
  workspaceRoot: string
  sourcePath: string
  page: number
  dpi: number
  figureId: string
}): Promise<{ path: string; tempPath: string }> {
  const renderer = await checkPdfRenderer()
  if (!renderer.available) {
    throw new Error(renderer.message ?? 'pdftoppm is unavailable.')
  }
  const renderDir = join(input.workspaceRoot, PDF_RENDER_RELATIVE_DIR)
  await mkdir(renderDir, { recursive: true })
  const prefix = join(renderDir, `${input.figureId}-page-${input.page}`)
  const outputPath = `${prefix}.png`
  const run = await runCommand(
    renderer.command ?? PDFTOPPM_COMMAND,
    [
      '-png',
      '-singlefile',
      '-f',
      String(input.page),
      '-l',
      String(input.page),
      '-r',
      String(input.dpi),
      input.sourcePath,
      prefix
    ],
    '',
    input.workspaceRoot,
    45_000
  )
  if (!run.ok) {
    throw new Error(`pdftoppm failed: ${tail(run.stderr) || run.message}`)
  }
  return { path: outputPath, tempPath: outputPath }
}

async function cropImageToPng(input: {
  sourcePath: string
  outputPath: string
  cropBox?: ScientificPlottingCropBox
}): Promise<{
  sourceWidth: number
  sourceHeight: number
  cropBox: ScientificPlottingCropBox & { unit: 'pixel' }
  outputPath: string
}> {
  const image = await loadImage(input.sourcePath)
  const sourceWidth = image.width
  const sourceHeight = image.height
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Reference source image has invalid dimensions.')
  }
  const cropBox = normalizeCropBox(input.cropBox, sourceWidth, sourceHeight)
  const canvas = createCanvas(cropBox.width, cropBox.height)
  const context = canvas.getContext('2d')
  context.drawImage(
    image,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    cropBox.width,
    cropBox.height
  )
  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
  return {
    sourceWidth,
    sourceHeight,
    cropBox,
    outputPath: input.outputPath
  }
}

function normalizeCropBox(
  cropBox: ScientificPlottingCropBox | undefined,
  sourceWidth: number,
  sourceHeight: number
): ScientificPlottingCropBox & { unit: 'pixel' } {
  if (!cropBox) {
    return {
      unit: 'pixel',
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight
    }
  }
  const unit = cropBox.unit ?? 'ratio'
  const raw = unit === 'ratio'
    ? {
        x: cropBox.x * sourceWidth,
        y: cropBox.y * sourceHeight,
        width: cropBox.width * sourceWidth,
        height: cropBox.height * sourceHeight
      }
    : cropBox
  const x = Math.floor(raw.x)
  const y = Math.floor(raw.y)
  const width = Math.round(raw.width)
  const height = Math.round(raw.height)
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 8 ||
    height < 8
  ) {
    throw new Error('Crop box must describe a region at least 8x8 pixels.')
  }
  if (x < 0 || y < 0 || x + width > sourceWidth || y + height > sourceHeight) {
    throw new Error('Crop box must stay inside the source image/page.')
  }
  return {
    unit: 'pixel',
    x,
    y,
    width,
    height
  }
}

async function resolvePlanStyleSpec(
  request: ScientificPlottingPlanRequest,
  workspaceRoot: string | undefined,
  warnings: string[],
  styleProfile?: ScientificPlottingStyleProfile
): Promise<FigureStyleSpec | undefined> {
  if (request.styleSpec) return request.styleSpec
  if (request.styleSpecPath?.trim()) {
    if (!workspaceRoot) {
      warnings.push('styleSpecPath was provided, but workspaceRoot is required to read it.')
      return undefined
    }
    try {
      const stylePath = await resolveOpenTargetPath(request.styleSpecPath, workspaceRoot, {
        allowBasenameFallback: true
      })
      const parsed = JSON.parse(await readFile(stylePath, 'utf8')) as unknown
      const spec = unwrapFigureStyleSpec(parsed)
      if (!spec) warnings.push('styleSpecPath did not contain a FigureStyleSpec v1 object.')
      return spec ?? undefined
    } catch (error) {
      warnings.push(`Could not read styleSpecPath: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  if (styleProfile) return styleProfile.styleSpec
  if (request.referencePath?.trim()) {
    if (!workspaceRoot) {
      warnings.push('referencePath was provided, but workspaceRoot is required to inspect it.')
      return undefined
    }
    const extracted = await extractFigureStyle({
      workspaceRoot,
      sourcePath: request.referencePath,
      sourceType: 'image',
      figureId: 'scientific-plotting-plan-reference'
    })
    if (!extracted.ok) {
      warnings.push(`Could not inspect referencePath: ${extracted.message}`)
      return undefined
    }
    return extracted.spec
  }
  return undefined
}

async function inferReferenceProfileFromReferencePath(
  request: ScientificPlottingReviewRequest
): Promise<ScientificPlottingReferenceProfile | undefined> {
  const extracted = await extractFigureStyle({
    workspaceRoot: request.workspaceRoot,
    sourcePath: request.referencePath,
    sourceType: 'image',
    figureId: 'scientific-plotting-review-reference'
  })
  if (!extracted.ok) return undefined
  return inferReferenceProfileFromStyle(extracted.spec, {})
}

function decorateReviewWithPlottingContext(
  review: FigureStyleReviewResult,
  template: ScientificPlottingTemplate,
  referenceProfile: ScientificPlottingReferenceProfile | undefined
): ScientificPlottingReviewResult {
  if (!review.ok) return review
  const templateAdvice = buildTemplateAdvice(template, referenceProfile, review.score)
  return {
    ...review,
    template,
    ...(referenceProfile ? { referenceProfile } : {}),
    ...(templateAdvice ? { templateAdvice } : {})
  }
}

function inferReferenceProfileFromStyle(
  styleSpec: FigureStyleSpec,
  input: {
    task?: string
    templateHint?: ScientificPlottingTemplate
  }
): ScientificPlottingReferenceProfile {
  const scores = new Map<ScientificPlottingTemplate, number>()
  const reasons = new Map<ScientificPlottingTemplate, string[]>()
  const risks: string[] = []
  const add = (template: ScientificPlottingTemplate, score: number, reason: string): void => {
    scores.set(template, (scores.get(template) ?? 0) + score)
    const current = reasons.get(template) ?? []
    current.push(reason)
    reasons.set(template, current)
  }
  const text = [
    input.task,
    styleSpec.source.figureId,
    styleSpec.source.notes,
    styleSpec.source.path
  ].filter(Boolean).join(' ').toLowerCase()
  const traits = referenceTraitsFromStyle(styleSpec, text)
  for (const signal of traits.textSignals) {
    const weight = signal === 'attention-map'
      ? 0.78
      : signal === 'multi-panel'
        ? 0.68
        : signal === 'box-violin' || signal === 'histogram-density'
          ? 0.64
          : signal === 'heatmap'
            ? 0.46
            : 0.52
    add(signal, weight, `Text hint suggests ${signal}.`)
  }
  if (input.templateHint) add(input.templateHint, 0.08, `Caller provided ${input.templateHint} as a weak template hint.`)

  const aspect = styleSpec.canvas.aspectRatio
  const backgroundLum = hexLuminance(styleSpec.canvas.background)
  if (backgroundLum < 60 && styleSpec.palette.colorMode !== 'monochrome') {
    add('heatmap', 0.2, 'Dark canvas with colored foreground often indicates matrix or attention-style visualization.')
  }
  const hasVisibleMeasuredAxes = styleSpec.axes.spine !== 'none' && styleSpec.axes.spine !== 'minimal'
  const hasMeasuredGrid = styleSpec.axes.grid && hasVisibleMeasuredAxes
  const hasLightMeasuredCanvas = backgroundLum > 180 && hasVisibleMeasuredAxes
  if (styleSpec.marks.density === 'dense' && !hasLightMeasuredCanvas) {
    add('heatmap', 0.18, 'Dense foreground marks are compatible with matrix-style plots.')
  }
  if (styleSpec.marks.density === 'dense' && hasLightMeasuredCanvas) {
    add('bar', 0.28, 'Dense foreground marks on a light measured axis are closer to categorical or multi-panel chart styling.')
  }
  if (aspect > 1.75 && styleSpec.axes.grid && styleSpec.palette.colorMode !== 'monochrome') {
    add('schematic-grid', 0.14, 'Wide, color-rich reference with many light structural marks can be a schematic panel.')
  }
  if (aspect < 0.85 && styleSpec.axes.grid) {
    add('bar', 0.28, 'Tall chart with visible grid is compatible with categorical comparison panels.')
  }
  if (traits.panelGrid !== '1x1') {
    add('multi-panel', 0.38, `Reference layout reports panel grid ${traits.panelGrid}.`)
  }
  if (
    traits.aspect === 'wide' &&
    traits.markDensity === 'dense' &&
    traits.background === 'light' &&
    traits.axes !== 'none'
  ) {
    add('multi-panel', 0.1, 'Wide dense light reference may contain multiple chart panels.')
  }
  if (
    traits.textSignals.length === 0 &&
    traits.markDensity === 'dense' &&
    traits.axes === 'measured' &&
    styleSpec.annotations.legend !== 'none'
  ) {
    add('histogram-density', 0.08, 'Dense measured chart with legend may be a distribution comparison.')
  }
  if (hasMeasuredGrid) {
    add('bar', 0.08, 'Visible axes and grid indicate a measured chart rather than a freeform schematic.')
  }
  if (hasVisibleMeasuredAxes && !styleSpec.axes.grid) {
    add('bar', 0.06, 'Visible measured axes indicate a chart even when light grid lines are not detected.')
  }
  if (styleSpec.axes.spine === 'minimal' || styleSpec.axes.spine === 'none') {
    add('schematic-grid', 0.1, 'Minimal axes can indicate a schematic rather than a measured chart.')
  }
  if (styleSpec.source.path === 'sciforge-default') {
    risks.push('No external reference image or StyleSpec was provided; profile is based on the default SciForge style.')
  }
  if (styleSpec.confidence.typography < 0.5) {
    risks.push('Typography was inferred conservatively; exact font matching should be reviewed visually.')
  }
  if (
    traits.textSignals.includes('box-violin') ||
    traits.textSignals.includes('histogram-density') ||
    traits.textSignals.includes('multi-panel')
  ) {
    risks.push('Specialized template recognition combines visual traits with text hints; confirm the selected template visually.')
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
  const [recommendedTemplate, score] = ranked[0] ?? ['line', 0.24]
  const kind = kindForTemplate(recommendedTemplate, score)
  return {
    kind,
    recommendedTemplate,
    confidence: Number(clampNumber(score, 0.24, 0.92).toFixed(2)),
    detectedTraits: traits,
    reasons: (reasons.get(recommendedTemplate) ?? ['No strong visual-template evidence was detected.']).slice(0, 4),
    risks
  }
}

function referenceTraitsFromStyle(
  styleSpec: FigureStyleSpec,
  text: string
): NonNullable<ScientificPlottingReferenceProfile['detectedTraits']> {
  const aspect = styleSpec.canvas.aspectRatio > 1.45
    ? 'wide'
    : styleSpec.canvas.aspectRatio < 0.85
      ? 'tall'
      : 'balanced'
  const backgroundLum = hexLuminance(styleSpec.canvas.background)
  const background = backgroundLum > 190 ? 'light' : backgroundLum < 85 ? 'dark' : 'mid'
  const axes = styleSpec.axes.spine === 'left-bottom' || styleSpec.axes.spine === 'box'
    ? 'measured'
    : styleSpec.axes.spine === 'minimal'
      ? 'minimal'
      : styleSpec.axes.spine === 'none'
        ? 'none'
        : 'unknown'
  return {
    aspect,
    background,
    axes,
    grid: styleSpec.axes.gridTone,
    markDensity: styleSpec.marks.density,
    colorMode: styleSpec.palette.colorMode,
    panelGrid: styleSpec.layout.panelGrid,
    textSignals: inferTemplateSignalsFromText(text)
  }
}

function scientificPlottingTemplateGuides(): ScientificPlottingTemplateGuide[] {
  return SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES.map((guide) => ({
    template: guide.template,
    useWhen: [...guide.useWhen],
    avoidWhen: [...guide.avoidWhen],
    expectedData: [...guide.expectedData],
    modelSelectionHint: guide.modelSelectionHint
  }))
}

function templateGuideFor(template: ScientificPlottingTemplate): ScientificPlottingTemplateGuide {
  return scientificPlottingTemplateGuides().find((guide) => guide.template === template) ?? scientificPlottingTemplateGuides()[0]
}

function needForTemplate(template: ScientificPlottingTemplate | undefined): ScientificFigureNeed | undefined {
  if (!template) return undefined
  if (template === 'heatmap' || template === 'attention-map') return 'heatmap_matrix'
  if (template === 'box-violin' || template === 'histogram-density' || template === 'errorbar-bar') return 'statistical_comparison'
  if (template === 'multi-panel') return 'multi_panel_figure'
  if (template === 'flowchart') return 'method_flow'
  if (template === 'schematic-grid') return 'mechanism_schematic'
  return 'quantitative_chart'
}

function templateForFigureNeed(
  need: ScientificFigureNeed,
  fallback: ScientificPlottingTemplate
): ScientificPlottingTemplate {
  if (need === 'multi_panel_figure' || need === 'image_panel' || need === 'summary_figure') return 'multi-panel'
  if (need === 'method_flow' || need === 'model_architecture') return 'flowchart'
  if (need === 'mechanism_schematic') return 'schematic-grid'
  if (need === 'heatmap_matrix') {
    return fallback === 'attention-map' ? 'attention-map' : 'heatmap'
  }
  if (need === 'statistical_comparison') {
    return ['box-violin', 'histogram-density', 'errorbar-bar', 'bar', 'multi-panel'].includes(fallback)
      ? fallback
      : 'box-violin'
  }
  return fallback
}

function inferRequestedScientificFigureDomain(rawDomain: string | undefined): ScientificFigureNeedClassification['domain'] | undefined {
  const domain = rawDomain?.trim()
  if (!domain) return undefined
  if (/life|bio|cell|gene|protein|omics|生命|生物|基因|蛋白|细胞|通路/i.test(domain)) return 'life-science'
  if (/chem|drug|molecule|compound|reaction|化学|药物|分子|化合物|反应/i.test(domain)) return 'chemistry'
  if (/material|crystal|battery|catalyst|alloy|polymer|材料|晶体|电池|催化|合金/i.test(domain)) return 'materials'
  if (/ai|ml|machine learning|deep learning|model|neural|transformer|rl|reinforcement|机器学习|模型|神经|强化学习/i.test(domain)) return 'ai-ml'
  if (/geo|climate|map|earth|spatial|地理|气候|地图|空间/i.test(domain)) return 'geo-climate'
  if (/general|通用/i.test(domain)) return 'general'
  return undefined
}

function inferScientificFigureDomain(text: string): ScientificFigureNeedClassification['domain'] {
  if (/single[-\s]?cell|omics|gene|protein|pathway|cell|biology|biomedical|rna|dna|生命|生物|基因|蛋白|细胞|通路/i.test(text)) {
    return 'life-science'
  }
  if (/chem|compound|molecule|reaction|drug|ligand|smiles|化学|药物|分子|化合物|反应/i.test(text)) {
    return 'chemistry'
  }
  if (/material|crystal|battery|catalyst|alloy|polymer|perovskite|材料|晶体|电池|催化|合金/i.test(text)) {
    return 'materials'
  }
  if (/machine learning|deep learning|neural|transformer|reinforcement|rl|benchmark|模型|神经网络|机器学习|深度学习|强化学习/i.test(text)) {
    return 'ai-ml'
  }
  if (/climate|geo|spatial|earth|map|remote sensing|气候|地理|空间|地图|遥感/i.test(text)) {
    return 'geo-climate'
  }
  return 'general'
}

function shouldRecommendResearchBrief(
  task: string,
  primaryNeed: ScientificFigureNeed,
  targetVenue?: string
): boolean {
  const text = `${task} ${targetVenue ?? ''}`
  const mentionsPaperWorkflow = /paper|figure|journal|cns|neurips|iclr|icml|cvpr|论文|文献|顶刊|顶会|期刊|参考图/i.test(text) ||
    hasCnsVenueSignal(text)
  const hasVenueOrCnsSignal = /cns|journal|neurips|iclr|icml|cvpr|顶刊|顶会|期刊|参考图|文献风格|论文图/i.test(text) ||
    hasCnsVenueSignal(text)
  const needsPaperDesign = primaryNeed === 'mechanism_schematic' ||
    primaryNeed === 'method_flow' ||
    primaryNeed === 'model_architecture' ||
    primaryNeed === 'pathway_network' ||
    primaryNeed === 'image_panel' ||
    primaryNeed === 'summary_figure'
  const looksLikeScientificDrawing = /figure|plot|diagram|flowchart|workflow|architecture|model|mechanism|paper|scientific|research|实验|科研|论文|文献|图|流程|机制|模型|结构|架构/i.test(task)
  if (hasVenueOrCnsSignal && (mentionsPaperWorkflow || needsPaperDesign)) return true
  if (needsPaperDesign && looksLikeScientificDrawing) return true
  return needsPaperDesign && /paper|figure|论文|文献|图|机制|summary|graphical abstract|panel/i.test(task)
}

function hasCnsVenueSignal(text: string): boolean {
  return /\b(?:Nature|Science)\b/i.test(text) ||
    /\bCell\s+(?:journal|paper|figure|style|article)\b/i.test(text) ||
    /(?:Nature|Science|Cell)\s*(?:期刊|论文|文章|风格|图|figure|journal|paper|style)/i.test(text)
}

function routeForFigureNeed(
  primaryNeed: ScientificFigureNeed,
  options: {
    hasExplicitNodeEdges: boolean
    looksLikeLongProse: boolean
    needsResearchBrief: boolean
  }
): ScientificFigureNeedClassification['route'] {
  if (primaryNeed === 'quantitative_chart' || primaryNeed === 'statistical_comparison' || primaryNeed === 'heatmap_matrix') {
    return 'controlled_plotting_renderer'
  }
  if (primaryNeed === 'multi_panel_figure' || primaryNeed === 'image_panel') return 'panel_layout_then_renderer'
  return 'diagram_spec_or_image_generation'
}

function routeReasonForFigureNeed(
  primaryNeed: ScientificFigureNeed,
  route: ScientificFigureNeedClassification['route'],
  options: {
    hasExplicitNodeEdges: boolean
    looksLikeLongProse: boolean
    needsResearchBrief: boolean
  }
): string {
  if (route === 'controlled_plotting_renderer') {
    return 'The request is primarily structured numeric, matrix, or statistical plotting that fits SciForge controlled templates.'
  }
  if (route === 'panel_layout_then_renderer') {
    return 'The request is a paper-style panel figure, so SciForge should plan the panel contract before rendering individual panels.'
  }
  if (options.looksLikeLongProse && !options.hasExplicitNodeEdges) {
    return 'The request contains long prose; first convert it into a figure brief or diagram prompt instead of forcing dense text into boxes.'
  }
  if (options.needsResearchBrief) {
    return 'The request needs paper-figure reasoning: conclusion, evidence hierarchy, archetype, and export contract should be confirmed first.'
  }
  return 'The request is a schematic/diagram-style figure where visual grouping and composition matter more than numeric axes.'
}

function requiredInputsForFigureNeed(
  primaryNeed: ScientificFigureNeed,
  route: ScientificFigureNeedClassification['route']
): string[] {
  if (primaryNeed === 'quantitative_chart') return ['structured data or tabular rows', 'x/y labels', 'main comparison or trend']
  if (primaryNeed === 'statistical_comparison') return ['raw values or summary plus uncertainty', 'groups/conditions', 'statistical claim to show']
  if (primaryNeed === 'heatmap_matrix') return ['numeric matrix', 'row/column labels', 'normalization or color scale meaning']
  if (primaryNeed === 'multi_panel_figure') return ['panel list', 'per-panel evidence/data', 'shared conclusion and panel order']
  if (primaryNeed === 'image_panel') return ['image paths or panel descriptions', 'annotation targets', 'scale/crop requirements']
  if (route === 'diagram_spec_or_image_generation') {
    return ['figure conclusion', 'key entities/nodes', 'causal or temporal relationships', 'preferred paper/venue style']
  }
  return ['compact nodes[]', 'optional edges[]', 'labels for each step']
}

function buildResearchBriefRecommendation(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  targetVenue?: string
): NonNullable<Extract<ScientificPlottingPlanResult, { ok: true }>['researchBriefRecommendation']> | undefined {
  const recommended = shouldRecommendResearchBrief(task, figureNeed.primaryNeed, targetVenue)
  if (!recommended) return undefined
  return {
    recommended: true,
    reason: 'This is a paper-figure task; build a CNS/domain-aware research brief before rendering.',
    nextControlledTool: 'scientific_plotting_research_brief',
    useWhen: [
      'The user asks for a figure based on a paper, top journal/conference style, or literature evidence.',
      'The requested output is a mechanism, model architecture, pathway, image panel, summary figure, or multi-panel figure.',
      'The analysis angle or data requirements are not yet explicit enough for rendering.'
    ],
    requiresUserConfirmation: true
  }
}

function buildImagePolishRecommendation(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  options: {
    targetVenue?: string
    researchBriefRecommended?: boolean
    template?: ScientificPlottingTemplate
  } = {}
): ScientificPlottingImagePolishRecommendation | undefined {
  const text = `${task} ${options.targetVenue ?? ''}`
  const wantsPaperQuality = options.researchBriefRecommended === true
    || hasCnsVenueSignal(text)
    || /cns|paper|journal|publication|nature|science|cell|论文|文献|顶刊|期刊|顶会/i.test(text)
  const wantsVisualEdit = /放大|局部|zoom|inset|callout|标注|annotation|说明|highlight|emphasis|美化|polish|refine|排版|拼接|multi[-\s]?panel|多\s*panel|多面板|子图|panel|summary figure|graphical abstract|图形摘要|解释|介绍/i.test(text)
  const needsCompositionLayer = figureNeed.route !== 'controlled_plotting_renderer'
    || figureNeed.primaryNeed === 'multi_panel_figure'
    || figureNeed.primaryNeed === 'image_panel'
    || figureNeed.primaryNeed === 'summary_figure'
    || options.template === 'multi-panel'
  if (!wantsPaperQuality && !wantsVisualEdit && !needsCompositionLayer) return undefined

  return {
    recommended: true,
    reason: wantsVisualEdit
      ? 'The figure needs visual emphasis or explanatory edits after controlled data rendering.'
      : wantsPaperQuality
        ? 'CNS/paper-level figures often need a final image-composition layer after exact data/chart rendering.'
        : 'This figure type needs visual composition beyond a single controlled data plot.',
    model: 'gpt-image-2',
    fallbackModel: 'configured_model_router_image_model',
    nextControlledTool: 'image_generation_plan',
    followUpTools: ['image_generation_plan', 'image_generation_render'],
    useWhen: [
      'After scientific_plotting_render has produced exact data/chart panels.',
      'When the figure needs zoomed points, inset views, callouts, explanatory labels, panel stitching, graphical abstracts, or CNS-style visual polish.',
      'After Canvas review annotations request a visual edit that does not change data semantics.'
    ],
    preserve: [
      'Do not change numeric values, axes, labels, legends, sample sizes, or statistical claims.',
      'Use the controlled plot PNG/manifest as the visual and data source of truth.',
      'Only modify composition, emphasis, callouts, annotations, local magnification, or final panel arrangement.'
    ],
    guardrails: [
      'Use gpt-image-2 only as a final visual polishing layer, not as the source of data truth.',
      'For pure data correction, rerun scientific_plotting_render instead of image_generation.',
      'Keep original and polished artifacts as before/after versions on Canvas.'
    ]
  }
}

function recommendedSkillIdsForPlan(
  catalog: ScientificExternalSkillCatalogItem[],
  figureNeed: ScientificFigureNeedClassification,
  options: {
    includeCns: boolean
  } = { includeCns: false }
): string[] {
  const preferredSourceOrder: ScientificExternalSkillSourceKind[] = options.includeCns
    ? ['kdense', 'cns', 'domain', 'general']
    : ['kdense', 'domain', 'general']
  const selected: string[] = []
  const sourceQuota: Partial<Record<ScientificExternalSkillSourceKind, number>> = options.includeCns
    ? { kdense: 4, cns: 4, domain: 3, general: 2 }
    : { kdense: 6, domain: 3, general: 2 }
  const appliesToNeed = (item: ScientificExternalSkillCatalogItem): boolean =>
    item.appliesTo.includes(figureNeed.primaryNeed) || item.appliesTo.some((need) => figureNeed.secondaryNeeds.includes(need))
  const pushFromSource = (sourceKind: ScientificExternalSkillSourceKind, limit: number): void => {
    let added = 0
    for (const item of catalog) {
      if (item.sourceKind !== sourceKind) continue
      if (!appliesToNeed(item)) continue
      if (selected.includes(item.skillId)) continue
      selected.push(item.skillId)
      added += 1
      if (selected.length >= 10 || added >= limit) return
    }
  }
  for (const sourceKind of preferredSourceOrder) {
    pushFromSource(sourceKind, sourceQuota[sourceKind] ?? 2)
    if (selected.length >= 10) return uniqueStrings(selected)
  }
  for (const sourceKind of preferredSourceOrder) {
    pushFromSource(sourceKind, 10)
    if (selected.length >= 10) return uniqueStrings(selected)
  }
  return uniqueStrings(selected)
}

function buildRecommendedSkillLayers(
  catalog: ScientificExternalSkillCatalogItem[],
  figureNeed: ScientificFigureNeedClassification
): Array<{
  sourceKind: ScientificExternalSkillSourceKind
  skillIds: string[]
  reason: string
}> {
  const layers: Array<{
    sourceKind: ScientificExternalSkillSourceKind
    skillIds: string[]
    reason: string
  }> = []
  const layerDefinitions: Array<[ScientificExternalSkillSourceKind, string]> = [
    ['kdense', 'Base plotting and style guidance remains the first layer.'],
    ['cns', 'CNS/paper workflow skills add literature, figure-conclusion, and evidence-chain planning.'],
    ['domain', `Domain skills add ${figureNeed.domain} semantics, labels, and evidence constraints.`],
    ['general', 'General diagram/infographic skills help shape non-data and summary figures.'],
    ['compat', 'Compatibility standards inform SKILL.md parsing and safe read-only boundaries only.']
  ]
  for (const [sourceKind, reason] of layerDefinitions) {
    const skillIds = catalog
      .filter((item) => item.sourceKind === sourceKind)
      .slice(0, sourceKind === 'compat' ? 2 : 6)
      .map((item) => item.skillId)
    if (skillIds.length) layers.push({ sourceKind, skillIds, reason })
  }
  return layers
}

function buildSelectedSkillProfile(input: {
  task: string
  figureNeed: ScientificFigureNeedClassification
  request: ScientificPlottingResearchBriefRequest
  candidatePapers: ScientificPlottingResearchPaper[]
  skillCatalog: ScientificExternalSkillCatalogItem[]
  recommendedSkillLayers: Array<{
    sourceKind: ScientificExternalSkillSourceKind
    skillIds: string[]
    reason: string
  }>
}): ScientificPlottingSelectedSkillProfile {
  const context = [
    input.task,
    input.request.targetVenue,
    input.request.domain,
    input.request.dataSummary,
    input.request.referenceFigureNotes,
    ...input.candidatePapers.flatMap((paper) => [paper.title, paper.venue, paper.notes, ...(paper.figureHints ?? [])])
  ].filter(Boolean).join('\n')
  const cnsRelevant = hasCnsVenueSignal(context) ||
    /cns|nature|science|cell|paper[-\s]?level|multi[-\s]?panel|summary figure|graphical abstract|顶刊|论文图|多面板|图形摘要/i.test(context) ||
    input.figureNeed.primaryNeed === 'multi_panel_figure' ||
    input.figureNeed.primaryNeed === 'summary_figure'
  const imageDeltaRelevant = input.figureNeed.route !== 'controlled_plotting_renderer' ||
    (cnsRelevant && Boolean(input.request.dataSummary?.trim())) ||
    input.figureNeed.primaryNeed === 'mechanism_schematic' ||
    input.figureNeed.primaryNeed === 'model_architecture' ||
    input.figureNeed.primaryNeed === 'method_flow' ||
    input.figureNeed.primaryNeed === 'image_panel' ||
    input.figureNeed.primaryNeed === 'summary_figure' ||
    /放大|局部|zoom|inset|callout|标注|说明|highlight|美化|polish|拼接|panel|多面板|视觉统一|颜色|换色/i.test(context)
  const domainRelevant = input.figureNeed.domain !== 'general' ||
    /life|bio|protein|cell|gene|pathway|clinical|materials|chemistry|climate|生命|蛋白|细胞|基因|通路|材料|化学|气候/i.test(context)

  const profileId: ScientificPlottingSelectedSkillProfile['profileId'] = cnsRelevant && input.figureNeed.domain === 'life-science'
    ? 'paper-figure-cns-life-science-v1'
    : cnsRelevant
      ? 'paper-figure-cns-domain-v1'
      : imageDeltaRelevant
        ? 'mechanism-diagram-image-delta-v1'
        : input.figureNeed.route === 'controlled_plotting_renderer'
          ? 'controlled-data-plot-v1'
          : 'general-paper-figure-v1'

  const layerIds = (sourceKind: ScientificExternalSkillSourceKind): string[] =>
    input.recommendedSkillLayers.find((layer) => layer.sourceKind === sourceKind)?.skillIds ?? []
  const selectedSkillIds = uniqueStrings([
    ...layerIds('kdense').slice(0, 4),
    ...(cnsRelevant
      ? [
          'nature-figure',
          'nature-reader',
          'nature-data',
          ...layerIds('cns').slice(0, 4)
        ]
      : []),
    ...(domainRelevant ? layerIds('domain').slice(0, 4) : []),
    ...(imageDeltaRelevant ? ['image-delta-polish'] : [])
  ]).slice(0, 14)

  const reasonBits = [
    `primary need is ${input.figureNeed.primaryNeed}`,
    `route is ${input.figureNeed.route}`,
    cnsRelevant ? 'CNS/paper workflow guidance is relevant' : 'CNS workflow is not required',
    domainRelevant ? `${input.figureNeed.domain} domain skills add semantic constraints` : 'no specialized domain layer detected',
    imageDeltaRelevant ? 'image delta polish may be needed for composition/callouts/visual unification' : 'image model is not needed before controlled rendering'
  ]

  return {
    profileId,
    selectedSkillIds,
    selectionReason: compactWhitespace(reasonBits.join('; ')),
    skillPriority: ['kdense', 'cns', 'domain', 'image-delta'],
    readOnlyExternalSkills: true
  }
}

function buildResearchBriefLiteratureStrategy(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  request: ScientificPlottingResearchBriefRequest
): Extract<ScientificPlottingResearchBriefResult, { ok: true }>['literatureStrategy'] {
  const domain = request.domain?.trim() || figureNeed.domain
  const venue = request.targetVenue?.trim() || venueHintFromTask(task)
  const baseQuery = compactWhitespace([
    domain !== 'general' ? domain : undefined,
    task.replace(/\s+/g, ' ').slice(0, 180),
    labelForFigureNeed(figureNeed.primaryNeed),
    venue
  ].filter(Boolean).join(' '))
  const suggestedQueries = uniqueStrings([
    baseQuery,
    `${labelForFigureNeed(figureNeed.primaryNeed)} ${domain} Nature Science Cell figure`,
    `${task.slice(0, 120)} figure conclusion evidence`,
    `${domain} ${labelForFigureNeed(figureNeed.primaryNeed)} top journal paper`
  ].map(compactWhitespace)).slice(0, 4)
  return {
    suggestedQueries,
    preferredSources: [
      'Nature / Science / Cell article pages and source data links',
      'PubMed / CrossRef / Semantic Scholar for paper discovery',
      'journal supplementary information and data availability sections'
    ],
    nextControlledTool: 'research_search',
    notes: [
      'Use nature-academic-search/nature-reader concepts as read-only workflow guidance when available.',
      'Prefer papers with accessible figures, captions, source data, and method details.',
      'Extract archetype and evidence logic; do not copy exact figure content.'
    ]
  }
}

function buildResearchBriefFigureContract(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  request: ScientificPlottingResearchBriefRequest
): Extract<ScientificPlottingResearchBriefResult, { ok: true }>['figureContract'] {
  const dataClause = request.dataSummary?.trim()
    ? `Available data/context: ${request.dataSummary.trim()}`
    : 'Data/source evidence still needs confirmation before rendering.'
  const figureNotes = request.referenceFigureNotes?.trim()
    ? [`Reference figure notes: ${request.referenceFigureNotes.trim()}`]
    : []
  return {
    figureConclusion: `Show the clearest evidence-backed conclusion for: ${compactWhitespace(task).slice(0, 240)}`,
    evidenceLogic: [
      ...evidenceLogicForFigureNeed(figureNeed.primaryNeed),
      dataClause,
      ...figureNotes
    ],
    archetype: figureNeed.primaryNeed,
    journalExportContract: [
      `Target venue/style: ${request.targetVenue?.trim() || 'publication-ready CNS/domain style'}.`,
      'Use readable panel labels, conservative typography, explicit legends, and traceable captions.',
      'Keep raw data/statistical meaning unchanged across style repair.',
      'Export artifact plus manifest so Canvas review can produce before/after revisions.'
    ],
    reviewRisks: reviewRisksForFigureNeed(figureNeed.primaryNeed)
  }
}

function buildPaperFigureProductionPlan(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  request: ScientificPlottingResearchBriefRequest
): ScientificPaperFigureProductionPlan | undefined {
  const context = `${task}\n${request.dataSummary ?? ''}\n${request.referenceFigureNotes ?? ''}\n${(request.candidatePapers ?? []).flatMap((paper) => [paper.title, paper.notes, ...(paper.figureHints ?? [])]).join('\n')}`
  const wantsPaperLevelPlan = Boolean(request.dataSummary?.trim())
    || (request.candidatePapers?.length ?? 0) > 0
    || /paper|manuscript|results?|source data|raw data|figure plan|论文|文献|稿件|原始数据|结果部分|整篇/i.test(context)
  if (!wantsPaperLevelPlan) return undefined

  const assets: ScientificPaperFigureProductionPlan['proposedAssets'] = []
  const pushAsset = (asset: ScientificPaperFigureProductionPlan['proposedAssets'][number]): void => {
    if (assets.some((item) => item.id === asset.id)) return
    assets.push(asset)
  }
  const hasOutcome = /outcome|death_event|death|survival|mortality|event|status|response|group|condition|phenotype|结局|死亡|生存|响应|分组/i.test(context)
  const hasTimeToEvent = /time|follow[-\s]?up|survival|kaplan|meier|event|censor|cox|随访|生存|事件|删失/i.test(context)
  const hasMultipleContinuous = /columns?|continuous|numeric|clinical variables|matrix|correlation|spearman|pearson|变量|相关|矩阵|连续/i.test(context)
  const hasPredictiveModel = /roc|auc|classifier|classification|prediction|logistic|model|cross[-\s]?validated|预测|分类|模型/i.test(context)
  const hasRegression = /cox|hazard|ratio|regression|effect size|confidence interval|forest|hr|or|回归|风险比|效应量|森林图/i.test(context)

  pushAsset({
    id: 'table-baseline',
    kind: 'table',
    title: 'Baseline characteristics',
    claim: 'Summarize sample size, groups, units, and missingness before interpreting figures.',
    recommendedTemplate: 'three-line-table',
    dataRequirements: ['raw cohort table', 'group/outcome column if comparisons are needed', 'units and categorical coding'],
    statistics: ['n (%) for categorical variables', 'mean ± SD or median [IQR] for continuous variables', 'clearly defined tests if compared by group'],
    firstPassTool: 'table_generator',
    canvasReview: false,
    notes: ['SciForge currently records this in the plan; a dedicated three-line table worker/template would improve parity with paper-figures.']
  })

  if (hasOutcome || figureNeed.primaryNeed === 'statistical_comparison') {
    pushAsset({
      id: 'fig-key-predictors',
      kind: 'figure',
      title: 'Key predictors by outcome or condition',
      claim: 'Show which measured variables visibly differ between the main groups.',
      recommendedTemplate: 'box-violin',
      dataRequirements: ['raw numeric values', 'group/outcome labels', 'unit of analysis', 'sample size per group'],
      statistics: ['box/violin/points', 'appropriate two-group or multi-group test', 'corrected significance labels when needed'],
      firstPassTool: 'scientific_plotting_map_data',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Prefer box + jittered points for small/medium n; avoid bar-of-means as the only view.']
    })
  }

  if (hasMultipleContinuous || figureNeed.primaryNeed === 'heatmap_matrix') {
    pushAsset({
      id: 'fig-correlation-heatmap',
      kind: 'figure',
      title: 'Correlation or feature co-variation heatmap',
      claim: 'Reveal correlation structure and possible collinearity across measured variables.',
      recommendedTemplate: 'heatmap',
      dataRequirements: ['numeric matrix or raw numeric columns', 'row/column labels', 'normalization/correlation method'],
      statistics: ['Spearman or Pearson correlation', 'diverging color scale centered at zero for correlations'],
      firstPassTool: 'scientific_plotting_map_data',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Keep numeric labels and colorbar deterministic; image2 may only improve spacing/callouts.']
    })
  }

  if (hasTimeToEvent) {
    pushAsset({
      id: 'fig-survival-km',
      kind: 'figure',
      title: 'Kaplan-Meier survival by clinically meaningful group',
      claim: 'Show whether event timing differs between groups over follow-up.',
      recommendedTemplate: 'kaplan-meier',
      dataRequirements: ['time-to-event column', 'event/censor indicator', 'grouping variable', 'risk-table time points'],
      statistics: ['Kaplan-Meier curve', 'numbers-at-risk table', 'log-rank p-value', 'hazard ratio if modeled'],
      firstPassTool: 'scientific_plotting_map_data',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Current SciForge can approximate with line plots, but needs a dedicated Kaplan-Meier template for publication parity.']
    })
  }

  if (hasRegression) {
    pushAsset({
      id: 'fig-effect-size-forest',
      kind: 'figure',
      title: 'Adjusted effect-size / forest summary',
      claim: 'Show independent effects with confidence intervals after adjustment.',
      recommendedTemplate: 'cox-forest',
      dataRequirements: ['model coefficient table', 'effect estimates', 'confidence intervals', 'reference categories'],
      statistics: ['Cox/logistic/linear model effect estimate', '95% CI', 'null reference line'],
      firstPassTool: 'scientific_plotting_map_data',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Needs first-class forest/effect-size template; avoid using generic bar charts for adjusted effects.']
    })
  }

  if (hasPredictiveModel) {
    pushAsset({
      id: 'fig-model-roc',
      kind: 'figure',
      title: 'Predictive model ROC or performance curve',
      claim: 'Quantify model discrimination and compare simple versus full predictor sets.',
      recommendedTemplate: 'roc',
      dataRequirements: ['true labels', 'predicted scores/probabilities', 'cross-validation splits if available'],
      statistics: ['ROC curve', 'AUC with uncertainty', 'cross-validation protocol'],
      firstPassTool: 'scientific_plotting_map_data',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Current SciForge can draw a line curve if points are provided, but should add a dedicated ROC template with AUC metadata.']
    })
  }

  if (figureNeed.primaryNeed === 'multi_panel_figure' || /nature|science|cell|cns|multi[-\s]?panel|多面板|子图|拼接/i.test(context)) {
    pushAsset({
      id: 'fig-paper-summary-panel',
      kind: 'figure',
      title: 'Paper-level multi-panel summary',
      claim: 'Combine the most important controlled data panels into one publication figure.',
      recommendedTemplate: 'multi-panel',
      dataRequirements: ['approved component figure manifests', 'panel order', 'shared conclusion', 'caption/panel labels'],
      statistics: ['inherit statistics from component panels'],
      firstPassTool: 'scientific_plotting_render',
      polishTool: 'image_generation_plan',
      canvasReview: true,
      notes: ['Render exact component panels first; use image2 only for panel stitching, callouts, and visual hierarchy.']
    })
  }

  const missingCapabilities = uniqueStrings([
    ...(assets.some((asset) => asset.recommendedTemplate === 'kaplan-meier') ? ['dedicated Kaplan-Meier template with at-risk table and censor ticks'] : []),
    ...(assets.some((asset) => asset.recommendedTemplate === 'cox-forest') ? ['dedicated forest/effect-size template with CI and null line'] : []),
    ...(assets.some((asset) => asset.recommendedTemplate === 'roc') ? ['dedicated ROC/AUC template with cross-validation metadata'] : []),
    ...(assets.some((asset) => asset.recommendedTemplate === 'three-line-table') ? ['three-line table generator/manifest handoff'] : []),
    'paper-level figure report artifact that ties each figure to claim, caption, data source, and manuscript citation location'
  ])
  const compositionPlan = buildPaperFigureCompositionPlan(assets, context, figureNeed)

  return {
    scope: 'paper_level',
    sourceWorkflow: 'paper_figures_data_first_v1',
    requiredInputs: [
      'manuscript/result summary or paper title/abstract',
      'raw data files with column meanings and units',
      'target venue/style',
      'user-approved analysis angle and figure scope'
    ],
    proposedAssets: assets,
    ...(compositionPlan ? { compositionPlan } : {}),
    handoff: {
      firstPass: [
        'Map raw data into controlled scientific_plotting render requests.',
        'Run exact statistics and deterministic data plotting first.',
        'Export each panel with artifact manifest and review score.'
      ],
      imagePolish: [
        'Use image_generation_plan/render after exact panels exist; prefer gpt-image-2 and fall back to the configured Model Router image model if needed.',
        'Preserve numbers, axes, labels, legends, sample sizes, and statistical claims.',
        'Use image2 for panel stitching, callouts, zoomed insets, explanation labels, and composition polish.'
      ],
      reviewLoop: [
        'Insert first render and polished version into Canvas.',
        'Collect arrow/range annotations as review packets.',
        'Regenerate a new version without overwriting original artifacts.'
      ]
    },
    missingCapabilities
  }
}

function buildPaperFigureCompositionPlan(
  assets: ScientificPaperFigureProductionPlan['proposedAssets'],
  context: string,
  figureNeed: ScientificFigureNeedClassification
): ScientificPaperFigureCompositionPlan | undefined {
  const figureAssets = assets.filter((asset) => asset.kind === 'figure' && asset.canvasReview)
  const needsPaperComposition = figureAssets.length >= 2
    || figureNeed.primaryNeed === 'multi_panel_figure'
    || figureNeed.primaryNeed === 'summary_figure'
    || /nature|science|cell|cns|multi[-\s]?panel|多面板|子图|拼接|综合图|summary figure|graphical abstract/i.test(context)
  if (!needsPaperComposition) return undefined

  const polishAllowedOperations: ScientificPaperFigureCompositionPlan['controlledSubfigures'][number]['polishAllowedOperations'] = [
    'crop',
    'resize',
    'align',
    'panel_stitching',
    'callout_overlay',
    'zoom_inset',
    'visual_unification',
    'typography_cleanup'
  ]
  const compositionAllowedOperations: ScientificPaperFigureCompositionPlan['image2Composition']['allowedOperations'] = [
    'panel_stitching',
    'callout_overlay',
    'zoom_inset',
    'visual_unification',
    'typography_cleanup'
  ]
  const deltaAllowedOperations: ScientificPaperFigureCompositionPlan['imagePolishDeltaPlan']['allowedOperations'] = [
    ...compositionAllowedOperations,
    'mechanism_visual_draft'
  ]
  const lockedFacts = [
    'numeric values',
    'axes labels and scales',
    'legends',
    'sample sizes',
    'statistical tests and p-values',
    'effect directions',
    'paper claims and figure conclusions'
  ]
  const controlledSubfigures = figureAssets.map((asset) => ({
    assetId: asset.id,
    title: asset.title,
    claim: asset.claim,
    recommendedTemplate: asset.recommendedTemplate === 'three-line-table'
      ? 'multi-panel' as const
      : asset.recommendedTemplate,
    firstPassTool: asset.firstPassTool === 'table_generator'
      ? 'scientific_plotting_render' as const
      : asset.firstPassTool,
    requiredArtifact: 'png_manifest' as const,
    factLocks: [...lockedFacts],
    polishAllowedOperations: [...polishAllowedOperations]
  }))

  const inputArtifacts = controlledSubfigures.map((panel) => `${panel.assetId}.manifest.json`)
  const deltaHandoffPrompt = [
    'Use image generation only as a delta-only visual polish layer over controlled subfigure PNG/manifest artifacts.',
    'Do not redraw, replace, or reinterpret scientific data panels.',
    'Only perform panel stitching, callout overlay, zoom inset, visual unification, typography cleanup, or mechanism visual drafting when explicitly needed.',
    `Locked facts: ${lockedFacts.join('; ')}.`,
    'Return a visual composition base manifest; deterministic overlays remain the source of truth for labels, axes, legends, numeric values, and statistics.'
  ].join(' ')
  return {
    sourceWorkflow: 'controlled_subfigures_then_image2_composition_v1',
    stageOrder: ['controlled_subfigures', 'image2_composition', 'canvas_review_iteration'],
    controlledSubfigures,
    image2Composition: {
      preferredModel: 'gpt-image-2',
      fallbackModel: 'configured_model_router_image_model',
      nextControlledTool: 'image_generation_plan',
      inputArtifacts,
      allowedOperations: [...compositionAllowedOperations],
      forbiddenOperations: [
        'Do not invent, remove, or reorder data points.',
        'Do not change numeric values, axes, labels, legends, sample sizes, p-values, effect sizes, confidence intervals, or statistical conclusions.',
        'Do not replace controlled chart panels with unrelated generative imagery.',
        'Do not copy the exact layout of a copyrighted reference figure.'
      ],
      handoffPrompt: [
        'Compose only a delta visual polish layer for a paper-level multi-panel figure from the controlled subfigure PNG/manifest artifacts.',
        'Prefer gpt-image-2; if unavailable, use the currently configured Model Router image model for panel stitching, callouts, zoomed insets, typography cleanup, and visual unification.',
        'Keep every controlled subfigure as the data source of truth and preserve all numeric/statistical semantics; do not generate replacement scientific data panels.',
        'Return a new composite artifact manifest and keep the original subfigures unchanged.'
      ].join(' '),
      outputContract: [
        'Composite PNG artifact plus manifest.',
        'Panel labels and caption-ready claim summary.',
        'List of source subfigure manifests used.',
        'Canvas before/after insertion metadata for review.'
      ]
    },
    imagePolishDeltaPlan: {
      mode: 'delta_only',
      targetPanels: controlledSubfigures.map((panel) => ({
        assetId: panel.assetId,
        reason: 'Use image model only if this panel needs callouts, local zoom, alignment, stitching, typography cleanup, or visual unification after controlled rendering.',
        allowedOperations: [...deltaAllowedOperations]
      })),
      allowedOperations: [...deltaAllowedOperations],
      lockedFacts: [...lockedFacts],
      handoffPrompt: deltaHandoffPrompt
    },
    canvasReview: {
      openInCanvas: true,
      preserveOriginalArtifacts: true,
      reviewPacketRequired: true,
      revisionPolicy: 'new_version_next_to_original'
    }
  }
}

function buildResearchBriefPromptSpec(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  candidatePapers: ScientificPlottingResearchPaper[],
  request: ScientificPlottingResearchBriefRequest
): Extract<ScientificPlottingResearchBriefResult, { ok: true }>['promptSpecDraft'] {
  const literatureReady = candidatePapers.length > 0
  const renderTool = figureNeed.route === 'controlled_plotting_renderer'
    ? 'scientific_plotting_map_data'
    : figureNeed.route === 'panel_layout_then_renderer'
      ? 'scientific_plotting_map_data or image_generation_plan after panel contract confirmation'
      : 'image_generation_plan or a Mermaid/diagram spec after confirmation'
  const nextControlledTool = literatureReady ? renderTool : 'research_search'
  const imagePolishRecommendation = buildImagePolishRecommendation(task, figureNeed, {
    targetVenue: request.targetVenue,
    researchBriefRecommended: true
  })
  const fullPrompt = buildResearchBriefFullPrompt(task, figureNeed, candidatePapers, request, renderTool)
  return {
    task,
    figureNeed: figureNeed.primaryNeed,
    referencePapers: candidatePapers,
    visualPlan: visualPlanForFigureNeed(figureNeed.primaryNeed),
    dataRequirements: requiredInputsForFigureNeed(figureNeed.primaryNeed, figureNeed.route),
    styleGuidance: [
      `Prioritize ${request.targetVenue?.trim() || 'CNS/domain paper'} clarity over decorative layout.`,
      'Use reference papers for archetype and style signals, not as copied artwork.',
      'Keep labels short enough for figure-panel readability.'
    ],
    fullPrompt,
    codeGenerationPlan: {
      target: figureNeed.route === 'controlled_plotting_renderer'
        ? 'scientific_plotting_render_request'
        : figureNeed.route === 'panel_layout_then_renderer'
          ? 'panel_layout_spec'
          : 'image_generation_recipe',
      nextControlledTool: renderTool,
      notes: literatureReady
        ? [
            'Use the listed referencePapers as evidence and style anchors.',
            'Generate only a controlled render request/recipe, not arbitrary shell or Python.',
            'If visual polish is needed, render exact data panels first, then call image_generation_plan/image_generation_render with gpt-image-2 or the configured Model Router image model and the controlled plot artifacts as references.',
            'After rendering, insert the artifact into Canvas for annotation and revision.'
          ]
        : [
            'Do not render yet. First call research_search or another paper discovery tool with literatureStrategy.suggestedQueries.',
            'Read figure captions/abstracts/source-data notes from the selected papers.',
            'Call scientific_plotting_research_brief again with candidatePapers and the user analysis angle before rendering.'
          ]
    },
    ...(imagePolishRecommendation ? { imagePolishRecommendation } : {}),
    nextControlledTool
  }
}

function buildResearchBriefFullPrompt(
  task: string,
  figureNeed: ScientificFigureNeedClassification,
  candidatePapers: ScientificPlottingResearchPaper[],
  request: ScientificPlottingResearchBriefRequest,
  renderTool: string
): string {
  const papers = candidatePapers.length
    ? candidatePapers.map((paper, index) => {
        const venue = [paper.venue, paper.year].filter(Boolean).join(' ')
        const hints = paper.figureHints?.length ? ` Figure/style hints: ${paper.figureHints.join('; ')}.` : ''
        return `${index + 1}. ${paper.title}${venue ? ` (${venue})` : ''}.${paper.doi ? ` DOI: ${paper.doi}.` : ''}${paper.url ? ` URL: ${paper.url}.` : ''}${hints}`
      }).join('\n')
    : 'No reference papers confirmed yet. Search related CNS/top-conference/domain papers before rendering.'
  return [
    `Task: ${compactWhitespace(task)}`,
    `Figure need: ${labelForFigureNeed(figureNeed.primaryNeed)} (${figureNeed.route}).`,
    `Analysis angle: ${inferAnalysisAngle(task, request)}.`,
    `Target venue/style: ${request.targetVenue?.trim() || 'CNS/domain publication style'}.`,
    `Reference papers and figure evidence:\n${papers}`,
    `Visual plan:\n${visualPlanForFigureNeed(figureNeed.primaryNeed).map((item) => `- ${item}`).join('\n')}`,
    `Data/content requirements:\n${requiredInputsForFigureNeed(figureNeed.primaryNeed, figureNeed.route).map((item) => `- ${item}`).join('\n')}`,
    `Style requirements:\n- infer figure archetype, layout density, label style, palette, annotation conventions, and panel logic from the reference papers\n- do not copy exact copyrighted figure composition or data\n- keep labels concise and publication-readable`,
    `Final image polish layer:\n- when callouts, zoomed insets, panel stitching, explanatory labels, or CNS-style composition are needed, use image_generation_plan after controlled data rendering; prefer gpt-image-2 and fall back to the configured Model Router image model if needed\n- preserve numeric data, axes, labels, legends, sample sizes, and statistical claims\n- keep the controlled plot artifacts as the source of truth and create before/after versions on Canvas`,
    `Next controlled tool: ${candidatePapers.length ? renderTool : 'research_search first, then scientific_plotting_research_brief again'}.`
  ].join('\n\n')
}

function labelForFigureNeed(need: ScientificFigureNeed): string {
  const labels: Record<ScientificFigureNeed, string> = {
    quantitative_chart: 'quantitative chart',
    statistical_comparison: 'statistical comparison figure',
    heatmap_matrix: 'heatmap or matrix figure',
    multi_panel_figure: 'multi-panel paper figure',
    method_flow: 'method or experimental flow figure',
    mechanism_schematic: 'mechanism schematic',
    model_architecture: 'model architecture figure',
    pathway_network: 'pathway or network figure',
    image_panel: 'image panel figure',
    summary_figure: 'summary or graphical abstract figure'
  }
  return labels[need]
}

function inferAnalysisAngle(
  task: string,
  request: ScientificPlottingResearchBriefRequest
): string {
  if (request.referenceFigureNotes?.trim()) return request.referenceFigureNotes.trim()
  if (/compare|comparison|versus|差异|对比|比较/i.test(task)) return 'comparison and contrast'
  if (/mechanism|cause|why|机制|原因|调控/i.test(task)) return 'mechanism and causal evidence'
  if (/workflow|pipeline|method|流程|方法|步骤/i.test(task)) return 'method sequence and decision points'
  if (/model|architecture|network|模型|结构|网络/i.test(task)) return 'model components and information flow'
  return 'main scientific conclusion and supporting evidence'
}

function confirmationQuestionsForFigureNeed(
  figureNeed: ScientificFigureNeedClassification
): string[] {
  const common = [
    'What is the single figure conclusion the reader should remember?',
    'Which reference papers or figures should guide the archetype and visual style?'
  ]
  if (figureNeed.route === 'controlled_plotting_renderer') {
    return [
      ...common,
      'What structured data, grouping, matrix, or uncertainty values should be rendered?',
      'What statistical or normalization choices must be shown in the caption or legend?'
    ]
  }
  if (figureNeed.primaryNeed === 'multi_panel_figure' || figureNeed.primaryNeed === 'image_panel') {
    return [
      ...common,
      'What panels should be included and what evidence does each panel support?',
      'Which panels are data charts, image panels, or schematics?',
      'What crop, scale, or annotation constraints matter?'
    ]
  }
  return [
    ...common,
    'What entities, steps, mechanisms, or model components must be included?',
    'Which relationships are causal, temporal, hierarchical, or optional?',
    'Should the output be a compact Mermaid/diagram spec or an illustrative image prompt?'
  ]
}

function evidenceLogicForFigureNeed(need: ScientificFigureNeed): string[] {
  if (need === 'quantitative_chart') return ['Identify x/y variables, grouping, units, and the comparison implied by the chart.']
  if (need === 'statistical_comparison') return ['Define groups, sample sizes, uncertainty/statistical test, and the exact claim being compared.']
  if (need === 'heatmap_matrix') return ['Define matrix rows/columns, normalization, clustering, and color scale meaning.']
  if (need === 'multi_panel_figure') return ['Define panel-by-panel evidence hierarchy from overview to detailed validation.']
  if (need === 'image_panel') return ['Define image provenance, crop/scale bars, annotations, and quantitative support panels.']
  if (need === 'method_flow') return ['Define ordered steps, decision points, inputs/outputs, and where evidence enters the workflow.']
  if (need === 'model_architecture') return ['Define model components, information flow, inputs/outputs, and training/inference distinction.']
  if (need === 'pathway_network') return ['Define nodes, edges, pathway evidence, directionality, and highlighted modules.']
  if (need === 'mechanism_schematic') return ['Define entities, causal links, perturbations, and evidence supporting each mechanism edge.']
  return ['Define the narrative claim, supporting evidence blocks, and visual hierarchy.']
}

function reviewRisksForFigureNeed(need: ScientificFigureNeed): string[] {
  const common = ['Over-compressing text labels', 'Copying reference-paper composition too closely', 'Rendering before data/provenance is clear']
  if (need === 'method_flow' || need === 'model_architecture') {
    return [...common, 'Ambiguous arrows or directionality', 'Too many nodes for a readable paper figure']
  }
  if (need === 'mechanism_schematic' || need === 'pathway_network') {
    return [...common, 'Unsupported causal edges', 'Mixing pathway evidence with hypothesis without visual distinction']
  }
  if (need === 'image_panel') {
    return [...common, 'Missing scale bars/crop provenance', 'Annotations not tied to image evidence']
  }
  if (need === 'multi_panel_figure') {
    return [...common, 'Panels lack a shared conclusion', 'Panel order does not match the evidence hierarchy']
  }
  return common
}

function visualPlanForFigureNeed(need: ScientificFigureNeed): string[] {
  if (need === 'quantitative_chart') return ['Choose chart type from data shape', 'Apply publication style', 'Review axes/grid/palette similarity']
  if (need === 'statistical_comparison') return ['Show distributions or uncertainty', 'Encode groups consistently', 'Reserve annotations for confirmed statistics']
  if (need === 'heatmap_matrix') return ['Prepare matrix and labels', 'Choose color scale and clustering policy', 'Add compact side labels or panel notes']
  if (need === 'multi_panel_figure') return ['Define panel grid', 'Map each panel to data/schematic/image renderer', 'Balance shared legend and captions']
  if (need === 'image_panel') return ['Create panel layout', 'Place source images with scale/crops', 'Add bounded annotations and provenance']
  if (need === 'method_flow') return ['Extract ordered steps', 'Group stages', 'Use arrows only for confirmed sequence or dependency']
  if (need === 'model_architecture') return ['Identify modules', 'Show information flow', 'Separate training, inference, and evaluation paths']
  if (need === 'pathway_network') return ['Extract nodes/edges', 'Mark evidence strength', 'Highlight modules or perturbations']
  if (need === 'mechanism_schematic') return ['Extract entities and causal links', 'Show perturbations/outcomes', 'Keep unsupported links visually tentative']
  return ['Define narrative blocks', 'Select paper-style visual hierarchy', 'Prepare concise labels and callouts']
}

function venueHintFromTask(task: string): string | undefined {
  const match = task.match(/\b(Nature|Science|Cell|NeurIPS|ICLR|ICML|CVPR|PNAS|JAMA|Lancet)\b/i)
  if (match?.[1]) return match[1]
  if (/顶刊|CNS|论文/i.test(task)) return 'CNS/top journal'
  return undefined
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function buildTemplateSelection(
  selectedTemplate: ScientificPlottingTemplate,
  request: ScientificPlottingPlanRequest,
  referenceProfile: ScientificPlottingReferenceProfile | undefined
): ScientificPlottingTemplateSelection {
  const guide = templateGuideFor(selectedTemplate)
  return {
    selectedTemplate,
    selectedBy: request.templateHint === selectedTemplate
      ? 'templateHint'
      : referenceProfile?.recommendedTemplate === selectedTemplate
        ? 'referenceProfile'
        : 'taskIntent',
    useWhen: [...guide.useWhen],
    avoidWhen: [...guide.avoidWhen],
    expectedData: [...guide.expectedData],
    modelSelectionHint: guide.modelSelectionHint
  }
}

function buildScientificPlottingToolRoutingRecommendation(
  task: string,
  template: ScientificPlottingTemplate
): { preferredTool: 'image_generation_plan'; reason: string; useWhen: string[] } | undefined {
  if (template !== 'flowchart' && template !== 'schematic-grid') return undefined
  const looksLikeVisualDiagram = /flow\s*chart|flowchart|workflow|pipeline|diagram|infographic|poster|cover|illustrat|流程图|流程|工作流|管线|示意图|信息图|宣传图|封面图|海报/i.test(task)
  if (!looksLikeVisualDiagram) return undefined
  return {
    preferredTool: 'image_generation_plan',
    reason: 'This is a semantic diagram request. Use scientific_plotting only to draft the structure; use image_generation_plan/image_generation_render for the final polished visual.',
    useWhen: [
      'Flowcharts, model architectures, workflows, mechanisms, and schematics need composition beyond Matplotlib boxes.',
      'Use scientific_plotting output as a draft/spec, not as the final user-facing diagram.',
      'The image model should choose layout, icons, visual grouping, typography, and polished composition.'
    ]
  }
}

function buildTemplateAdvice(
  selectedTemplate: ScientificPlottingTemplate | undefined,
  referenceProfile: ScientificPlottingReferenceProfile | undefined,
  score: FigureStyleSimilarityScore | undefined
): ScientificPlottingTemplateAdvice | undefined {
  if (!selectedTemplate) return undefined
  const messages: string[] = []
  const nextActions: string[] = []
  let compatible = true
  if (
    referenceProfile &&
    referenceProfile.kind !== 'unknown' &&
    referenceProfile.confidence >= 0.48 &&
    referenceProfile.recommendedTemplate !== selectedTemplate
  ) {
    compatible = false
    messages.push(`Reference profile looks closer to ${referenceProfile.recommendedTemplate} than ${selectedTemplate}.`)
    nextActions.push(`Try scientific_plotting_render with template=${referenceProfile.recommendedTemplate} before manual style tuning.`)
  }
  if (score && score.marks < 0.62) {
    messages.push('Foreground mark density differs; this often requires a better template or semantic renderer, not another style-only repair.')
    nextActions.push('Keep the data unchanged and review whether the selected controlled template matches the reference figure type.')
  }
  if (score && (selectedTemplate === 'schematic-grid' || selectedTemplate === 'flowchart') && (score.axes < 0.62 || score.grid < 0.62)) {
    messages.push('Schematic and flowchart panels may score low on axes/grid because reference diagrams contain structural marks rather than measured axes.')
    nextActions.push('Treat axes/grid warnings as diagnostic context for schematic templates.')
  }
  if (score && (selectedTemplate === 'heatmap' || selectedTemplate === 'attention-map') && score.palette < 0.68) {
    messages.push('Heatmap palette differs; use the style-derived colormap when the user did not provide a domain-specific colormap.')
    nextActions.push('Prefer a dedicated attention/matrix template if the reference contains token alignments or block structure.')
  }
  return {
    selectedTemplate,
    ...(referenceProfile ? { referenceRecommendedTemplate: referenceProfile.recommendedTemplate } : {}),
    compatible,
    severity: compatible ? 'info' : 'warning',
    messages,
    nextActions: nextActions.length > 0 ? nextActions : ['Proceed with controlled rendering and visual review.']
  }
}

function buildTemplateAlternatives(
  selectedTemplate: ScientificPlottingTemplate,
  taskTemplate: ScientificPlottingTemplate,
  referenceProfile: ScientificPlottingReferenceProfile | undefined
): Array<{ template: ScientificPlottingTemplate; reason: string }> {
  const alternatives: Array<{ template: ScientificPlottingTemplate; reason: string }> = []
  const add = (template: ScientificPlottingTemplate, reason: string): void => {
    if (template === selectedTemplate) return
    if (alternatives.some((item) => item.template === template)) return
    alternatives.push({ template, reason })
  }
  if (referenceProfile) {
    add(referenceProfile.recommendedTemplate, 'Reference-profile fallback.')
  }
  add(taskTemplate, 'Task-text fallback.')
  if (selectedTemplate === 'flowchart') add('schematic-grid', 'Use when the diagram is a conceptual layout rather than a directed process.')
  if (selectedTemplate === 'schematic-grid') {
    add('flowchart', 'Use when the schematic is actually a directed workflow or process.')
    add('bar', 'Use when the schematic is actually categorical data.')
  }
  if (selectedTemplate === 'bar') add('errorbar-bar', 'Use when categorical comparisons need visible uncertainty.')
  if (selectedTemplate === 'errorbar-bar') add('bar', 'Use when uncertainty is not present.')
  if (selectedTemplate === 'bar' || selectedTemplate === 'errorbar-bar') {
    add('box-violin', 'Use when the comparison should show distributions or individual observations.')
  }
  if (selectedTemplate === 'box-violin') add('bar', 'Use when only summary values are available.')
  if (selectedTemplate === 'histogram-density') add('box-violin', 'Use when comparing distributions across categories.')
  if (selectedTemplate === 'box-violin') add('histogram-density', 'Use when the main question is distribution shape.')
  if (selectedTemplate !== 'multi-panel') add('multi-panel', 'Use when the final output should combine multiple related panels.')
  if (selectedTemplate === 'heatmap') add('scatter', 'Use when matrix-like colors actually encode point embeddings.')
  if (selectedTemplate === 'heatmap') add('attention-map', 'Use when the matrix is a token alignment or attention panel.')
  if (selectedTemplate === 'attention-map') add('heatmap', 'Use for a generic matrix with colorbar and axes.')
  return alternatives.slice(0, 3)
}

function heatmapCmapForRequest(
  request: ScientificPlottingRenderRequest,
  styleSpec: FigureStyleSpec,
  palette: string[]
): { heatmapCmapColors?: string[] } {
  if (request.template !== 'heatmap' && request.template !== 'attention-map') return {}
  if (!request.styleSpec && !request.styleSpecPath && !request.referencePath && !request.reviewReferencePath) return {}
  const data = isRecord(request.data) ? request.data : {}
  const requestedCmap = typeof data.cmap === 'string' ? data.cmap.toLowerCase() : ''
  if (requestedCmap && !['viridis', 'cividis', 'plasma', 'magma'].includes(requestedCmap)) return {}
  const background = styleSpec.canvas.background
  const accents = uniqueHexStrings(palette)
    .filter((color) => color.toLowerCase() !== background.toLowerCase())
    .filter((color) => hexDistance(color, background) > 34)
    .slice(0, 5)
  if (accents.length === 0) return {}
  const colors = hexLuminance(background) < 88
    ? uniqueHexStrings([background, ...accents])
    : uniqueHexStrings(['#ffffff', ...accents])
  return colors.length >= 2 ? { heatmapCmapColors: colors } : {}
}

function buildDataMappingCandidates(
  data: unknown,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
    templateHint?: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
  }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  const add = (candidate: DataMappingCandidate): void => {
    try {
      validateTemplateData(candidate.template, candidate.data)
    } catch {
      return
    }
    if (candidates.some((item) => item.template === candidate.template && JSON.stringify(item.data) === JSON.stringify(candidate.data))) {
      return
    }
    candidates.push(candidate)
  }

  for (const candidate of templateReadyCandidates(data, context)) add(candidate)
  for (const candidate of matrixAndVectorCandidates(data, context)) add(candidate)
  const rows = extractTabularRows(data)
  if (rows.length > 0) {
    for (const candidate of tabularMappingCandidates(rows, context)) add(candidate)
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      confidence: adjustedMappingConfidence(candidate, context)
    }))
    .sort((left, right) => right.confidence - left.confidence)
}

function selectDataMappingCandidate(
  candidates: DataMappingCandidate[],
  context: {
    templateHint?: ScientificPlottingTemplate
    taskTemplate: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
  }
): DataMappingCandidate {
  if (context.templateHint) {
    const hinted = candidates.find((candidate) => candidate.template === context.templateHint)
    if (hinted) return hinted
  }
  const taskMatched = candidates.find((candidate) => candidate.template === context.taskTemplate)
  if (taskMatched) return taskMatched
  if (context.referenceProfile && context.referenceProfile.confidence >= 0.58) {
    const referenceMatched = candidates.find((candidate) => candidate.template === context.referenceProfile?.recommendedTemplate)
    if (referenceMatched) return referenceMatched
  }
  return candidates[0]
}

function adjustedMappingConfidence(
  candidate: DataMappingCandidate,
  context: {
    taskTemplate: ScientificPlottingTemplate
    templateHint?: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
  }
): number {
  let confidence = candidate.confidence
  if (context.templateHint === candidate.template) confidence += 0.16
  if (context.taskTemplate === candidate.template) confidence += 0.12
  if (context.referenceProfile?.recommendedTemplate === candidate.template) {
    confidence += context.referenceProfile.confidence >= 0.58 ? 0.08 : 0.03
  }
  return clampNumber(confidence, 0.2, 0.96)
}

function templateReadyCandidates(
  data: unknown,
  context: { labels?: ScientificPlottingLabels }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  for (const template of SCIENTIFIC_PLOTTING_TEMPLATES) {
    try {
      validateTemplateData(template, data)
      candidates.push({
        template,
        confidence: template === 'multi-panel' ? 0.94 : 0.9,
        data,
        labels: context.labels,
        inputShape: template === 'multi-panel'
          ? 'multi-panel'
          : template === 'heatmap' || template === 'attention-map'
            ? 'matrix'
            : template === 'schematic-grid' || template === 'flowchart'
              ? 'network'
              : 'template-ready',
        dataSignals: [template],
        reasons: [`Input already matches the controlled ${template} schema.`],
        warnings: [],
        summary: summarizeTemplateReadyData(template, data)
      })
    } catch {
      // Try the next controlled template.
    }
  }
  return candidates
}

function matrixAndVectorCandidates(
  data: unknown,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
  }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  const matrix = rawMatrixFromData(data)
  if (matrix) {
    const template = context.taskTemplate === 'attention-map' ? 'attention-map' : 'heatmap'
    candidates.push({
      template,
      confidence: template === 'attention-map' ? 0.82 : 0.78,
      data: { matrix },
      labels: mergeLabels(context.labels, {
        title: inferTitle(context.task),
        x: context.taskTemplate === 'attention-map' ? 'Target' : undefined,
        y: context.taskTemplate === 'attention-map' ? 'Source' : undefined
      }),
      inputShape: 'matrix',
      dataSignals: [template],
      reasons: [`Input is a ${matrix.length}x${matrix[0]?.length ?? 0} numeric matrix.`],
      warnings: [],
      summary: {
        inputShape: 'matrix',
        matrixShape: [matrix.length, matrix[0]?.length ?? 0]
      }
    })
  }
  if (isFiniteNumberArray(data, 1, MAX_DISTRIBUTION_POINTS)) {
    candidates.push({
      template: 'histogram-density',
      confidence: 0.76,
      data: {
        series: [{ name: 'Values', values: data }],
        bins: defaultHistogramBins(data.length)
      },
      labels: mergeLabels(context.labels, {
        title: inferTitle(context.task),
        x: 'Value',
        y: 'Density',
        legend: false
      }),
      inputShape: 'vector',
      dataSignals: ['histogram-density'],
      reasons: ['Input is a numeric vector, which maps to a distribution plot.'],
      warnings: [],
      summary: {
        inputShape: 'vector',
        seriesCount: 1,
        pointCount: data.length
      }
    })
  }
  return candidates
}

function tabularMappingCandidates(
  rows: Array<Record<string, unknown>>,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
  }
): DataMappingCandidate[] {
  const profiles = profileTabularColumns(rows)
  const numericColumns = profiles.filter((profile) => profile.numericCount > 0)
  const categoricalColumns = profiles.filter((profile) =>
    profile.stringCount > 0 || (profile.numericCount > 0 && profile.uniqueValues.length <= Math.min(24, Math.max(4, rows.length / 2)))
  )
  const baseSummary = {
    inputShape: 'tabular' as const,
    rowCount: rows.length,
    columnCount: profiles.length,
    numericColumns: numericColumns.map((profile) => profile.key),
    categoricalColumns: categoricalColumns.map((profile) => profile.key)
  }
  const candidates: DataMappingCandidate[] = []
  const valueKey = chooseColumn(numericColumns, [/^(value|score|response|measurement|metric|accuracy|auroc|f1|loss)$/i, /value|score|response|metric|measurement/i])
    ?? numericColumns.find((profile) => !/error|sem|sd|ci|stderr/i.test(profile.key))?.key
  const errorKey = chooseColumn(numericColumns, [/^(error|sem|sd|ci|stderr)$/i, /error|sem|sd|ci|stderr/i])
  const categoryKey = chooseColumn(categoricalColumns, [/^(condition|treatment|group|category|class|target|cohort)$/i, /condition|treatment|group|category|class|target|cohort/i])
    ?? categoricalColumns.find((profile) => profile.key !== valueKey)?.key
  const seriesKey = chooseColumn(
    categoricalColumns.filter((profile) => profile.key !== categoryKey),
    [/^(method|model|series|algorithm|variant)$/i, /method|model|series|algorithm|variant/i]
  )
  const xKey = chooseColumn(profiles, [/^(x|time|epoch|step|dose|position)$/i, /time|epoch|step|dose|position/i])
  const yKey = chooseColumn(
    numericColumns.filter((profile) => profile.key !== xKey && profile.key !== errorKey),
    [/^(y|value|score|response|measurement|metric|accuracy|loss)$/i, /value|score|response|metric|measurement|accuracy|loss/i]
  ) ?? valueKey
  const pointCount = rows.length

  if (categoryKey && valueKey) {
    const grouped = groupedValues(rows, categoryKey, valueKey)
    if (grouped.length > 0) {
      const duplicateCount = grouped.filter((group) => group.values.length > 1).length
      candidates.push({
        template: 'box-violin',
        confidence: duplicateCount > 0 ? 0.78 : 0.58,
        data: {
          groups: grouped,
          showPoints: true
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(categoryKey),
          y: labelFromColumn(valueKey)
        }),
        inputShape: 'tabular',
        dataSignals: ['box-violin'],
        reasons: [`Rows contain categorical ${categoryKey} and numeric ${valueKey} values.`],
        warnings: duplicateCount === 0 ? ['Only one value per group was detected; a bar chart may be clearer than a distribution plot.'] : [],
        summary: {
          ...baseSummary,
          groupCount: grouped.length,
          pointCount
        }
      })
    }
  }

  if (valueKey) {
    const series = categoryKey && context.taskTemplate === 'histogram-density'
      ? groupedValues(rows, categoryKey, valueKey).slice(0, MAX_SERIES).map((group) => ({
          name: group.name,
          values: group.values
        }))
      : [{ name: labelFromColumn(valueKey), values: numericValuesForColumn(rows, valueKey).slice(0, MAX_DISTRIBUTION_POINTS) }]
    if (series.length > 0 && series.every((item) => item.values.length > 0)) {
      candidates.push({
        template: 'histogram-density',
        confidence: context.taskTemplate === 'histogram-density' ? 0.82 : 0.56,
        data: {
          series,
          bins: defaultHistogramBins(Math.max(...series.map((item) => item.values.length)))
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(valueKey),
          y: 'Density',
          legend: series.length > 1
        }),
        inputShape: 'tabular',
        dataSignals: ['histogram-density'],
        reasons: [`Rows contain numeric ${valueKey} values suitable for distribution shape analysis.`],
        warnings: [],
        summary: {
          ...baseSummary,
          seriesCount: series.length,
          pointCount
        }
      })
    }
  }

  if (categoryKey && valueKey) {
    const bar = barDataFromRows(rows, {
      categoryKey,
      valueKey,
      seriesKey,
      errorKey
    })
    if (bar) {
      const template: ScientificPlottingTemplate = errorKey ? 'errorbar-bar' : 'bar'
      candidates.push({
        template,
        confidence: context.taskTemplate === template || context.taskTemplate === 'bar' ? 0.82 : 0.64,
        data: bar.data,
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(categoryKey),
          y: labelFromColumn(valueKey),
          legend: Boolean(seriesKey)
        }),
        inputShape: 'tabular',
        dataSignals: [template],
        reasons: [`Rows contain categorical ${categoryKey} and summary-like numeric ${valueKey} values.`],
        warnings: bar.warnings,
        summary: {
          ...baseSummary,
          seriesCount: bar.seriesCount,
          groupCount: bar.categoryCount
        }
      })
    }
  }

  if (xKey && yKey) {
    const grouped = seriesFromRows(rows, { xKey, yKey, seriesKey })
    if (grouped.length > 0) {
      const scatter = context.taskTemplate === 'scatter' || (!/time|epoch|step/i.test(xKey) && numericColumns.some((profile) => profile.key === xKey))
      const template: ScientificPlottingTemplate = scatter ? 'scatter' : 'line'
      candidates.push({
        template,
        confidence: context.taskTemplate === template ? 0.84 : 0.7,
        data: {
          series: grouped
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(xKey),
          y: labelFromColumn(yKey),
          legend: grouped.length > 1
        }),
        inputShape: 'tabular',
        dataSignals: [template],
        reasons: [`Rows contain x=${xKey} and y=${yKey} columns.`],
        warnings: [],
        summary: {
          ...baseSummary,
          seriesCount: grouped.length,
          pointCount
        }
      })
    }
  }

  return candidates
}

function summarizeTemplateReadyData(template: ScientificPlottingTemplate, data: unknown): DataSummary {
  if (isRecord(data) && template === 'multi-panel' && Array.isArray(data.panels)) {
    return { inputShape: 'multi-panel', seriesCount: data.panels.length }
  }
  if (isRecord(data) && (template === 'heatmap' || template === 'attention-map') && Array.isArray(data.matrix)) {
    const width = Array.isArray(data.matrix[0]) ? data.matrix[0].length : 0
    return { inputShape: 'matrix', matrixShape: [data.matrix.length, width] }
  }
  if (isRecord(data) && template === 'box-violin' && Array.isArray(data.groups)) {
    return {
      inputShape: 'template-ready',
      groupCount: data.groups.length,
      pointCount: data.groups.reduce((sum, group) => isRecord(group) && Array.isArray(group.values) ? sum + group.values.length : sum, 0)
    }
  }
  if (isRecord(data) && Array.isArray(data.series)) {
    return {
      inputShape: 'template-ready',
      seriesCount: data.series.length
    }
  }
  if (isRecord(data) && (template === 'schematic-grid' || template === 'flowchart') && Array.isArray(data.nodes)) {
    return { inputShape: 'network', groupCount: data.nodes.length }
  }
  return { inputShape: 'template-ready' }
}

function extractTabularRows(data: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.rows)
      ? data.rows
      : isRecord(data) && Array.isArray(data.records)
        ? data.records
        : isRecord(data) && Array.isArray(data.table)
          ? data.table
          : []
  return candidate.filter(isRecord).slice(0, MAX_POINTS)
}

function profileTabularColumns(rows: Array<Record<string, unknown>>): TabularColumnProfile[] {
  const keys = uniqueStrings(rows.flatMap((row) => Object.keys(row))).slice(0, 64)
  return keys.map((key) => {
    const finiteValues: number[] = []
    const uniqueValues: string[] = []
    let numericCount = 0
    let stringCount = 0
    for (const row of rows) {
      const value = row[key]
      const numeric = numberFromCell(value)
      if (numeric !== undefined) {
        numericCount += 1
        finiteValues.push(numeric)
      }
      const stringValue = stringFromCell(value)
      if (stringValue !== undefined) {
        stringCount += 1
        if (!uniqueValues.includes(stringValue)) uniqueValues.push(stringValue)
      }
    }
    return {
      key,
      numericCount,
      stringCount,
      finiteValues,
      uniqueValues: uniqueValues.slice(0, 250)
    }
  })
}

function chooseColumn(
  profiles: TabularColumnProfile[],
  patterns: RegExp[]
): string | undefined {
  for (const pattern of patterns) {
    const matched = profiles.find((profile) => pattern.test(profile.key))
    if (matched) return matched.key
  }
  return undefined
}

function groupedValues(
  rows: Array<Record<string, unknown>>,
  groupKey: string,
  valueKey: string
): Array<{ name: string; values: number[] }> {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const group = stringFromCell(row[groupKey])
    const value = numberFromCell(row[valueKey])
    if (group === undefined || value === undefined) continue
    const current = groups.get(group) ?? []
    current.push(value)
    groups.set(group, current)
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 0)
    .slice(0, MAX_DISTRIBUTION_GROUPS)
    .map(([name, values]) => ({
      name,
      values: values.slice(0, MAX_DISTRIBUTION_POINTS)
    }))
}

function numericValuesForColumn(rows: Array<Record<string, unknown>>, key: string): number[] {
  return rows
    .map((row) => numberFromCell(row[key]))
    .filter((value): value is number => value !== undefined)
}

function seriesFromRows(
  rows: Array<Record<string, unknown>>,
  input: {
    xKey: string
    yKey: string
    seriesKey?: string
  }
): Array<{ name?: string; x: Array<number | string>; y: number[] }> {
  const buckets = new Map<string, Array<{ x: number | string; y: number }>>()
  for (const row of rows) {
    const x = axisValueFromCell(row[input.xKey])
    const y = numberFromCell(row[input.yKey])
    if (x === undefined || y === undefined) continue
    const name = input.seriesKey ? stringFromCell(row[input.seriesKey]) ?? 'Series' : 'Series'
    const current = buckets.get(name) ?? []
    current.push({ x, y })
    buckets.set(name, current)
  }
  return [...buckets.entries()]
    .slice(0, MAX_SERIES)
    .map(([name, values]) => ({
      ...(name !== 'Series' ? { name } : {}),
      x: values.map((value) => value.x),
      y: values.map((value) => value.y)
    }))
    .filter((series) => series.y.length > 0)
}

function barDataFromRows(
  rows: Array<Record<string, unknown>>,
  input: {
    categoryKey: string
    valueKey: string
    seriesKey?: string
    errorKey?: string
  }
): { data: { categories: string[]; series: Array<{ name?: string; values: number[]; error?: number[] }> }; seriesCount: number; categoryCount: number; warnings: string[] } | null {
  const warnings: string[] = []
  const categories = uniqueStrings(
    rows
      .map((row) => stringFromCell(row[input.categoryKey]))
      .filter((value): value is string => value !== undefined)
  ).slice(0, 200)
  if (categories.length === 0) return null
  const seriesNames = input.seriesKey
    ? uniqueStrings(rows.map((row) => stringFromCell(row[input.seriesKey!])).filter((value): value is string => value !== undefined)).slice(0, MAX_SERIES)
    : ['Value']
  if (seriesNames.length === 0) return null
  const series: Array<{ name?: string; values: number[]; error?: number[] }> = []
  for (const seriesName of seriesNames) {
    const values: number[] = []
    const errors: number[] = []
    for (const category of categories) {
      const matching = rows.filter((row) =>
        stringFromCell(row[input.categoryKey]) === category &&
        (!input.seriesKey || stringFromCell(row[input.seriesKey]) === seriesName)
      )
      const finite = matching
        .map((row) => numberFromCell(row[input.valueKey]))
        .filter((value): value is number => value !== undefined)
      if (finite.length === 0) return null
      if (finite.length > 1) warnings.push(`Averaged ${finite.length} rows for ${seriesName}/${category}; verify this summary is intended.`)
      values.push(mean(finite))
      if (input.errorKey) {
        const errorValues = matching
          .map((row) => numberFromCell(row[input.errorKey!]))
          .filter((value): value is number => value !== undefined)
        if (errorValues.length > 0) errors.push(mean(errorValues))
      }
    }
    series.push({
      ...(input.seriesKey ? { name: seriesName } : {}),
      values,
      ...(input.errorKey && errors.length === categories.length ? { error: errors } : {})
    })
  }
  return {
    data: {
      categories,
      series
    },
    seriesCount: series.length,
    categoryCount: categories.length,
    warnings: uniqueStrings(warnings).slice(0, 8)
  }
}

function rawMatrixFromData(data: unknown): number[][] | null {
  const candidate = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.matrix)
      ? data.matrix
      : null
  if (!Array.isArray(candidate) || candidate.length === 0 || !Array.isArray(candidate[0])) return null
  const width = candidate[0].length
  if (width === 0 || candidate.length * width > MAX_HEATMAP_CELLS) return null
  const matrix: number[][] = []
  for (const row of candidate) {
    if (!Array.isArray(row) || row.length !== width) return null
    const values = row.map(numberFromCell)
    if (values.some((value) => value === undefined)) return null
    matrix.push(values as number[])
  }
  return matrix
}

function numberFromCell(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringFromCell(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function axisValueFromCell(value: unknown): number | string | undefined {
  const numeric = numberFromCell(value)
  if (numeric !== undefined) return numeric
  return stringFromCell(value)
}

function mergeLabels(
  primary: ScientificPlottingLabels | undefined,
  inferred: ScientificPlottingLabels | undefined
): ScientificPlottingLabels {
  return {
    ...(inferred ?? {}),
    ...(primary ?? {})
  }
}

function inferTitle(task: string): string | undefined {
  const trimmed = task.trim()
  if (!trimmed || trimmed.length > 80) return undefined
  return trimmed
}

function labelFromColumn(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function defaultHistogramBins(pointCount: number): number {
  return Math.max(5, Math.min(40, Math.ceil(Math.sqrt(Math.max(1, pointCount)))))
}

function mean(values: number[]): number {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function validateRenderRequestShape(request: ScientificPlottingRenderRequest): void {
  if (!SCIENTIFIC_PLOTTING_TEMPLATES.includes(request.template)) {
    throw new Error(`Unsupported scientific plotting template: ${String(request.template)}.`)
  }
  if (request.styleSpec && !isFigureStyleSpec(request.styleSpec)) {
    throw new Error('styleSpec must be a FigureStyleSpec v1 object.')
  }
  normalizeOutputScale(request.outputScale)
}

function validateTemplateData(template: ScientificPlottingTemplate, data: unknown): void {
  if (!isRecord(data)) throw new Error('data must be a JSON object.')
  if (template === 'line' || template === 'scatter') {
    const series = data.series
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`${template} data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item)) throw new Error(`${template} series entries must be objects.`)
      const y = item.y
      if (!isFiniteNumberArray(y, 1, MAX_POINTS)) {
        throw new Error(`${template} series.y must be a finite number array.`)
      }
      if (item.x !== undefined && !isAxisArray(item.x, y.length)) {
        throw new Error(`${template} series.x must match y length.`)
      }
      if (item.error !== undefined && !isFiniteNumberArray(item.error, y.length, y.length)) {
        throw new Error(`${template} series.error must match y length.`)
      }
    }
    return
  }
  if (template === 'bar' || template === 'errorbar-bar') {
    const categories = data.categories
    const series = data.series
    if (!isStringArray(categories, 1, 200)) throw new Error(`${template} data.categories must be a string array.`)
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`${template} data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item) || !isFiniteNumberArray(item.values, categories.length, categories.length)) {
        throw new Error(`${template} series.values must match categories length.`)
      }
      if (
        item.error !== undefined &&
        !isFiniteNumberArray(item.error, categories.length, categories.length)
      ) {
        throw new Error(`${template} series.error must match categories length.`)
      }
    }
    return
  }
  if (template === 'heatmap' || template === 'attention-map') {
    const matrix = data.matrix
    if (!Array.isArray(matrix) || matrix.length === 0) throw new Error(`${template} data.matrix is required.`)
    const width = Array.isArray(matrix[0]) ? matrix[0].length : 0
    if (width <= 0 || matrix.length * width > MAX_HEATMAP_CELLS) {
      throw new Error(`${template} matrix must contain at most ${MAX_HEATMAP_CELLS} cells.`)
    }
    for (const row of matrix) {
      if (!isFiniteNumberArray(row, width, width)) {
        throw new Error(`${template} matrix rows must be equal-length finite number arrays.`)
      }
    }
    return
  }
  if (template === 'box-violin') {
    const groups = data.groups
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_DISTRIBUTION_GROUPS) {
      throw new Error(`box-violin data.groups must include 1-${MAX_DISTRIBUTION_GROUPS} groups.`)
    }
    for (const group of groups) {
      if (
        !isRecord(group) ||
        typeof group.name !== 'string' ||
        !group.name.trim() ||
        !isFiniteNumberArray(group.values, 1, MAX_DISTRIBUTION_POINTS)
      ) {
        throw new Error('box-violin groups must include name and finite values.')
      }
    }
    return
  }
  if (template === 'histogram-density') {
    const series = data.series
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`histogram-density data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item) || !isFiniteNumberArray(item.values, 1, MAX_DISTRIBUTION_POINTS)) {
        throw new Error('histogram-density series entries must include finite values.')
      }
    }
    if (
      data.bins !== undefined &&
      (typeof data.bins !== 'number' || !Number.isInteger(data.bins) || data.bins < 5 || data.bins > 120)
    ) {
      throw new Error('histogram-density bins must be an integer from 5 to 120.')
    }
    return
  }
  if (template === 'multi-panel') {
    const panels = data.panels
    if (!Array.isArray(panels) || panels.length === 0 || panels.length > MAX_MULTI_PANELS) {
      throw new Error(`multi-panel data.panels must include 1-${MAX_MULTI_PANELS} panels.`)
    }
    if (
      data.columns !== undefined &&
      (typeof data.columns !== 'number' || !Number.isInteger(data.columns) || data.columns < 1 || data.columns > 3)
    ) {
      throw new Error('multi-panel columns must be an integer from 1 to 3.')
    }
    for (const panel of panels) {
      if (!isRecord(panel) || typeof panel.template !== 'string' || !isRecord(panel.data)) {
        throw new Error('multi-panel panels must include template and data.')
      }
      if (panel.template === 'multi-panel' || !SCIENTIFIC_PLOTTING_TEMPLATES.includes(panel.template as ScientificPlottingTemplate)) {
        throw new Error('multi-panel nested panels must use a supported non-multi-panel template.')
      }
      validateTemplateData(panel.template as ScientificPlottingTemplate, panel.data)
    }
    return
  }
  if (template === 'schematic-grid' || template === 'flowchart') {
    const nodes = data.nodes
    const maxNodes = template === 'flowchart' ? MAX_FLOWCHART_NODES : MAX_SCHEMATIC_NODES
    if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > maxNodes) {
      throw new Error(template === 'flowchart'
        ? `flowchart data.nodes must include 1-${MAX_FLOWCHART_NODES} compact nodes. For dense prose-to-visual diagrams, use image_generation_plan/image_generation_render.`
        : `${template} data.nodes must include 1-${MAX_SCHEMATIC_NODES} nodes.`)
    }
    const labels: string[] = []
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) {
        throw new Error(`${template} nodes must include labels.`)
      }
      labels.push(node.label.trim())
    }
    if (template === 'flowchart' && labels.join(' ').length > MAX_FLOWCHART_LABEL_CHARS) {
      throw new Error(`flowchart node labels must be compact and total at most ${MAX_FLOWCHART_LABEL_CHARS} characters. For long prose-to-visual diagrams, use image_generation_plan/image_generation_render.`)
    }
    if (template === 'flowchart' && data.edges !== undefined) {
      if (!Array.isArray(data.edges)) throw new Error('flowchart data.edges must be an array when provided.')
      for (const edge of data.edges) {
        if (!isRecord(edge) || edge.from === undefined || edge.to === undefined) {
          throw new Error('flowchart edges must include from and to.')
        }
      }
    }
  }
}

function buildDiagramDraftHandoffForRender(
  request: ScientificPlottingRenderRequest
): ScientificPlottingDraftHandoff | undefined {
  if (!requiresImageGenerationFinalRender(request.template, request.data)) return undefined
  const title = request.labels?.title?.trim()
  const draftSpec = {
    template: request.template,
    ...(title ? { title } : {}),
    ...draftSpecFromDiagramData(request.template, request.data)
  }
  const figureLabel = title || templateReason(request.template)
  return {
    kind: 'diagram_draft_handoff',
    draftRole: 'structure_only',
    sourceTemplate: request.template,
    recommendedNextTools: ['image_generation_plan', 'image_generation_render'],
    imageGenerationTask: [
      `Create a polished publication-style ${figureLabel}.`,
      'Use the provided draft structure as content guidance, but redesign the layout visually.',
      'Avoid plain Matplotlib blocks; use clear hierarchy, readable labels, arrows, grouping, whitespace, and domain-appropriate visual metaphors.'
    ].join(' '),
    promptGuidance: [
      'Preserve the scientific meaning, node order, and key relationships from draftSpec.',
      'Improve composition, typography, spacing, arrow routing, and grouping for a final user-facing figure.',
      'Use image_generation_render for the final PNG artifact, then insert that artifact into Canvas for review.',
      'Do not call scientific_plotting_render again for this diagram unless the user explicitly asks for a structural draft.'
    ],
    draftSpec,
    guardrails: [
      'scientific_plotting is the structure/data draft layer for semantic diagrams.',
      'image_generation is the final visual rendering layer for flowcharts, mechanisms, and model architecture diagrams.',
      'Do not present Matplotlib draft boxes as the final diagram.',
      'Do not change scientific semantics while beautifying the visual design.'
    ]
  }
}

function requiresImageGenerationFinalRender(template: ScientificPlottingTemplate, data: unknown): boolean {
  if (template === 'flowchart') return true
  if (template === 'schematic-grid') return !hasExplicitSchematicLayout(data)
  if (template !== 'multi-panel' || !isRecord(data) || !Array.isArray(data.panels)) return false
  return data.panels.some((panel) => {
    if (!isRecord(panel) || typeof panel.template !== 'string') return false
    if (panel.template === 'flowchart') return true
    if (panel.template === 'schematic-grid') return !hasExplicitSchematicLayout(panel.data)
    return false
  })
}

function hasExplicitSchematicLayout(data: unknown): boolean {
  if (!isRecord(data) || !Array.isArray(data.nodes) || data.nodes.length === 0) return false
  return data.nodes.every((node) => {
    if (!isRecord(node)) return false
    const x = Number(node.x)
    const y = Number(node.y)
    return Number.isFinite(x) && Number.isFinite(y)
  })
}

function draftSpecFromDiagramData(
  template: ScientificPlottingTemplate,
  data: unknown
): Omit<ScientificPlottingDraftHandoff['draftSpec'], 'template' | 'title'> {
  if (!isRecord(data)) return {}
  if (template === 'multi-panel' && Array.isArray(data.panels)) {
    return {
      panels: data.panels.slice(0, MAX_MULTI_PANELS).map((panel) => {
        if (!isRecord(panel)) return {}
        const panelData = isRecord(panel.data) ? panel.data : undefined
        return {
          ...(typeof panel.template === 'string' ? { template: panel.template } : {}),
          ...(typeof panel.title === 'string' && panel.title.trim() ? { title: panel.title.trim() } : {}),
          ...(panelData && Array.isArray(panelData.nodes) ? { nodeCount: panelData.nodes.length } : {})
        }
      })
    }
  }
  return {
    nodes: Array.isArray(data.nodes)
      ? data.nodes.slice(0, MAX_SCHEMATIC_NODES).flatMap((node) => {
          if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) return []
          return [{
            ...(typeof node.id === 'string' && node.id.trim() ? { id: node.id.trim() } : {}),
            label: node.label.trim(),
            ...(typeof node.group === 'string' && node.group.trim() ? { group: node.group.trim() } : {})
          }]
        })
      : undefined,
    edges: Array.isArray(data.edges)
      ? data.edges.slice(0, 80).flatMap((edge) => {
          if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') return []
          return [{
            from: edge.from,
            to: edge.to,
            ...(typeof edge.label === 'string' && edge.label.trim() ? { label: edge.label.trim() } : {})
          }]
        })
      : undefined
  }
}

function normalizeAutoRepairOptions(
  options?: ScientificPlottingAutoRepairOptions
): { enabled: boolean; maxAttempts: 0 | 1; minOverall?: number } {
  return {
    enabled: options?.enabled !== false,
    maxAttempts: options?.maxAttempts === 0 ? 0 : 1,
    ...(typeof options?.minOverall === 'number' ? { minOverall: options.minOverall } : {})
  }
}

function inferTemplateFromTask(task: string): ScientificPlottingTemplate {
  return inferTemplateSignalFromText(task) ?? 'line'
}

function inferTemplateSignalFromText(text: string): ScientificPlottingTemplate | undefined {
  return inferTemplateSignalsFromText(text)[0]
}

function inferTemplateSignalsFromText(text: string): ScientificPlottingTemplate[] {
  const signals: ScientificPlottingTemplate[] = []
  const add = (template: ScientificPlottingTemplate, pattern: RegExp): void => {
    if (!pattern.test(text)) return
    if (!signals.includes(template)) signals.push(template)
  }
  add('multi-panel', /multi[-\s]?panel|多\s*panel|subplot|facet|figure panel|panel figure|组合图|复合图|拼接图|拼图|多面板|多子图/i)
  add('box-violin', /violin|box\s*plot|boxplot|strip\s*plot|swarm|distribution comparison|compare .*distributions?|distributions? (for|across|by) (conditions?|groups?|categories?|recipes?|arms?)|distribution by (condition|group|category)|grouped distribution|箱线图|小提琴图|组间分布/i)
  add('histogram-density', /histogram|density|kde|residual distribution|value distribution|分布图|直方图|密度图/i)
  add('flowchart', /flow\s*chart|flowchart|workflow|pipeline|process flow|decision tree|pathway|流程图|流程|工作流|管线|步骤|路径/i)
  add('schematic-grid', /schematic|diagram|mechanism|architecture|model structure|network structure|array programming|numpy|示意|机制|架构|模型结构|网络结构/i)
  add('attention-map', /attention\s*(?:map|matrix|heatmap|weights?)|token alignment|注意力(?:图|矩阵|热图|权重)/i)
  add('heatmap', /heatmap|matrix|correlation|表达矩阵|热图|矩阵/i)
  add('scatter', /scatter|embedding|umap|tsne|point cloud|散点|降维/i)
  add('errorbar-bar', /error\s*bar|confidence interval|ci\b|uncertainty|误差棒|置信区间|不确定性/i)
  add('bar', /bar|category|comparison|benchmark|柱状|条形|分类|基准/i)
  add('line', /line|curve|trend|time series|trajectory|折线|曲线|趋势|时间序列/i)
  return signals
}

function kindForTemplate(
  template: ScientificPlottingTemplate,
  score: number
): ScientificPlottingReferenceProfile['kind'] {
  if (score < 0.28) return 'unknown'
  if (template === 'heatmap' || template === 'attention-map') return 'matrix'
  if (template === 'schematic-grid' || template === 'flowchart') return 'schematic'
  if (template === 'multi-panel') return 'mixed'
  return 'chart'
}

function templateReason(template: ScientificPlottingTemplate): string {
  if (template === 'line') return 'curves, trends, or time-series data'
  if (template === 'scatter') return 'point clouds or embedding-style comparisons'
  if (template === 'bar') return 'categorical comparisons'
  if (template === 'errorbar-bar') return 'categorical comparisons with uncertainty or error bars'
  if (template === 'heatmap') return 'matrix-valued data'
  if (template === 'attention-map') return 'token alignment or attention matrix visualization'
  if (template === 'box-violin') return 'grouped distributions with optional individual observations'
  if (template === 'histogram-density') return 'distribution shape or density comparisons'
  if (template === 'multi-panel') return 'a compact multi-panel scientific figure'
  if (template === 'flowchart') return 'a directed process or workflow diagram'
  return 'a simple scientific schematic'
}

function requiredInputsForTemplate(template: ScientificPlottingTemplate): string[] {
  if (template === 'bar') return ['categories', 'series[].values', 'optional labels']
  if (template === 'errorbar-bar') return ['categories', 'series[].values', 'optional series[].error', 'optional labels']
  if (template === 'heatmap') return ['matrix', 'optional xLabels/yLabels', 'optional labels']
  if (template === 'attention-map') return ['matrix', 'optional xLabels/yLabels', 'optional labels']
  if (template === 'box-violin') return ['groups[].name', 'groups[].values', 'optional showPoints/mode']
  if (template === 'histogram-density') return ['series[].values', 'optional bins/density']
  if (template === 'multi-panel') return ['panels[].template', 'panels[].data', 'optional columns and labels']
  if (template === 'flowchart') return ['nodes[].id', 'nodes[].label', 'optional edges[].from/to']
  if (template === 'schematic-grid') return ['nodes[].label', 'optional edges', 'optional labels']
  return ['series[].y', 'optional series[].x', 'optional labels']
}

function builtInStyleProfiles(): ScientificPlottingStyleProfile[] {
  return [
    {
      id: 'nature-2021-alphafold-fig2',
      name: 'Nature 2021 AlphaFold Fig. 2',
      venue: 'Nature',
      sourceLabel: 'AlphaFold style smoke reference',
      description: 'Tall, light-background comparison chart with pale blue accents, visible grid, compact typography, and outside legend handling.',
      recommendedTemplates: ['bar', 'errorbar-bar', 'line', 'box-violin'],
      tags: ['nature', 'biology', 'benchmark', 'light', 'grid', 'bar', 'errorbar'],
      styleSpec: profileStyleSpec({
        id: 'nature-2021-alphafold-fig2',
        width: 546,
        height: 900,
        background: '#ffffff',
        colors: ['#90d8f0', '#c0d8f0', '#90c0d8', '#78a8d8', '#4890c0', '#181818'],
        ink: '#000000',
        colorMode: 'multi-hue',
        axisSize: 8,
        labelSize: 9,
        titleSize: 11,
        panelLabels: 'unknown',
        margin: { left: 0.12, right: 0.04, top: 0.04, bottom: 0.1 },
        grid: true,
        gridTone: 'light',
        gridColor: '#f0f0ff',
        lineWidth: 1.1,
        markerSize: 3.8,
        density: 'balanced',
        confidence: { overall: 0.88, palette: 0.73, layout: 0.72, axes: 0.62, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'bar',
        confidence: 0.36,
        detectedTraits: {
          aspect: 'tall',
          background: 'light',
          axes: 'measured',
          grid: 'light',
          markDensity: 'balanced',
          colorMode: 'multi-hue',
          panelGrid: '1x1',
          textSignals: []
        },
        reasons: [
          'Tall chart with visible grid is compatible with categorical comparison panels.',
          'Visible axes and grid indicate a measured chart rather than a freeform schematic.'
        ],
        risks: ['Typography was inferred conservatively; exact font matching should be reviewed visually.']
      },
      cautions: [
        'Use for measured charts, not freeform illustrations.',
        'Legend and grid may need visual review for dense categorical panels.'
      ]
    },
    {
      id: 'nature-2020-numpy-fig1',
      name: 'Nature 2020 NumPy Fig. 1',
      venue: 'Nature',
      sourceLabel: 'NumPy paper schematic smoke reference',
      description: 'Clean explanatory schematic style with white background, minimal axes, muted blues/yellows, and compact labels.',
      recommendedTemplates: ['schematic-grid', 'flowchart', 'multi-panel', 'bar'],
      tags: ['nature', 'numpy', 'schematic', 'software', 'light', 'minimal'],
      styleSpec: profileStyleSpec({
        id: 'nature-2020-numpy-fig1',
        width: 900,
        height: 520,
        background: '#ffffff',
        colors: ['#4c78a8', '#f2cf5b', '#72b7b2', '#d9d9d9', '#333333'],
        ink: '#222222',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'unknown',
        margin: { left: 0.08, right: 0.08, top: 0.07, bottom: 0.12 },
        grid: false,
        gridTone: 'none',
        gridColor: '#ffffff',
        lineWidth: 0.9,
        markerSize: 3.2,
        density: 'balanced',
        confidence: { overall: 0.72, palette: 0.68, layout: 0.7, axes: 0.45, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'schematic',
        recommendedTemplate: 'schematic-grid',
        confidence: 0.66,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'minimal',
          grid: 'none',
          markDensity: 'balanced',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['schematic-grid']
        },
        reasons: ['Schematic reference emphasizes labeled regions and relationships rather than measured axes.'],
        risks: ['Semantic layout still needs human review because schematic matching is not a pixel-only problem.']
      },
      cautions: [
        'Use for conceptual diagrams and software architecture figures.',
        'Pixel similarity can under-score semantically correct schematics.'
      ]
    },
    {
      id: 'neurips-2017-attention',
      name: 'NeurIPS 2017 Attention Visualization',
      venue: 'NeurIPS',
      sourceLabel: 'Attention is All You Need style smoke reference',
      description: 'Dark matrix/attention-map profile with warm sequential colors, compact typography, and sparse axes.',
      recommendedTemplates: ['attention-map', 'heatmap'],
      tags: ['neurips', 'attention', 'machine-learning', 'heatmap', 'dark', 'matrix'],
      styleSpec: profileStyleSpec({
        id: 'neurips-2017-attention',
        width: 900,
        height: 420,
        background: '#000000',
        colors: ['#000000', '#2a1234', '#5f2c45', '#b05a3c', '#f2c66d'],
        ink: '#f5f5f5',
        colorMode: 'multi-hue',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'unknown',
        margin: { left: 0.18, right: 0.08, top: 0.06, bottom: 0.18 },
        grid: false,
        gridTone: 'none',
        gridColor: '#000000',
        lineWidth: 0.8,
        markerSize: 2.8,
        density: 'sparse',
        confidence: { overall: 0.78, palette: 0.8, layout: 0.64, axes: 0.5, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'matrix',
        recommendedTemplate: 'attention-map',
        confidence: 0.78,
        detectedTraits: {
          aspect: 'wide',
          background: 'dark',
          axes: 'measured',
          grid: 'none',
          markDensity: 'sparse',
          colorMode: 'multi-hue',
          panelGrid: '1x1',
          textSignals: ['attention-map']
        },
        reasons: ['Dark matrix with token labels and warm sequential palette fits attention-map rendering.'],
        risks: ['Typography and tick-label density should be checked visually for long token labels.']
      },
      cautions: [
        'Use only for matrix-like attention or alignment data.',
        'Axes/spine scoring can be harsh for dark heatmap references.'
      ]
    },
    {
      id: 'nature-publication-light',
      name: 'Nature Publication Light',
      venue: 'Nature-style generic',
      sourceLabel: 'SciForge first-party publication profile',
      description: 'General light-background publication chart style with colorblind-safe accents, compact typography, and restrained grid.',
      recommendedTemplates: ['line', 'scatter', 'bar', 'errorbar-bar', 'box-violin', 'histogram-density'],
      tags: ['nature', 'publication', 'generic', 'light', 'colorblind-safe'],
      styleSpec: profileStyleSpec({
        id: 'nature-publication-light',
        width: 900,
        height: 620,
        background: '#ffffff',
        colors: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000'],
        ink: '#222222',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'none',
        margin: { left: 0.13, right: 0.06, top: 0.08, bottom: 0.14 },
        grid: true,
        gridTone: 'light',
        gridColor: '#e8e8e8',
        lineWidth: 1,
        markerSize: 3,
        density: 'balanced',
        confidence: { overall: 0.7, palette: 0.75, layout: 0.7, axes: 0.7, typography: 0.65 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'line',
        confidence: 0.54,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'measured',
          grid: 'light',
          markDensity: 'balanced',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['line']
        },
        reasons: ['Generic publication profile supports measured charts with compact text and restrained colors.'],
        risks: ['This is a generic profile; use paper-specific profiles when a reference figure is available.']
      },
      cautions: ['Prefer extracted StyleSpec for exact journal figure matching.']
    },
    {
      id: 'cell-systems-statistical',
      name: 'Cell Systems Statistical',
      venue: 'Cell-style generic',
      sourceLabel: 'SciForge first-party statistical profile',
      description: 'Dense but readable statistical profile for distributions, summary bars, and multi-panel biomedical comparisons.',
      recommendedTemplates: ['box-violin', 'errorbar-bar', 'bar', 'multi-panel'],
      tags: ['cell', 'systems', 'biology', 'statistical', 'distribution', 'multi-panel'],
      styleSpec: profileStyleSpec({
        id: 'cell-systems-statistical',
        width: 900,
        height: 700,
        background: '#ffffff',
        colors: ['#3b6ea8', '#e07a5f', '#57a773', '#b56576', '#404040'],
        ink: '#1f1f1f',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'A/B/C',
        margin: { left: 0.14, right: 0.08, top: 0.08, bottom: 0.15 },
        grid: false,
        gridTone: 'none',
        gridColor: '#ffffff',
        lineWidth: 1.05,
        markerSize: 2.8,
        density: 'dense',
        confidence: { overall: 0.68, palette: 0.72, layout: 0.68, axes: 0.72, typography: 0.65 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'box-violin',
        confidence: 0.62,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'measured',
          grid: 'none',
          markDensity: 'dense',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['box-violin']
        },
        reasons: ['Dense statistical comparisons benefit from individual points, compact typography, and minimal grid.'],
        risks: ['Statistical annotations and sample sizes still need explicit user-provided semantics.']
      },
      cautions: ['Does not infer significance testing or sample-size labels.']
    }
  ]
}

function profileStyleSpec(input: {
  id: string
  width: number
  height: number
  background: string
  colors: string[]
  ink: string
  colorMode: FigureStyleSpec['palette']['colorMode']
  axisSize: number
  labelSize: number
  titleSize: number
  panelLabels: FigureStyleSpec['layout']['panelLabels']
  margin: FigureStyleSpec['layout']['margin']
  grid: boolean
  gridTone: FigureStyleSpec['axes']['gridTone']
  gridColor: string
  lineWidth: number
  markerSize: number
  density: FigureStyleSpec['marks']['density']
  confidence: FigureStyleSpec['confidence']
}): FigureStyleSpec {
  return {
    version: 1,
    source: {
      path: `builtin:${input.id}`,
      type: 'image',
      figureId: input.id,
      notes: `SciForge built-in style profile registry v${STYLE_PROFILE_REGISTRY_VERSION}`
    },
    canvas: {
      width: input.width,
      height: input.height,
      aspectRatio: Number((input.width / input.height).toFixed(3)),
      background: input.background
    },
    palette: {
      colors: input.colors,
      background: input.background,
      ink: input.ink,
      accent: input.colors.filter((color) => color.toLowerCase() !== input.background.toLowerCase()).slice(0, 6),
      colorMode: input.colorMode
    },
    typography: {
      fontFamily: 'Arial',
      axisSize: input.axisSize,
      labelSize: input.labelSize,
      titleSize: input.titleSize,
      weight: 'regular'
    },
    layout: {
      panelGrid: '1x1',
      panelLabels: input.panelLabels,
      margin: input.margin,
      gutter: 'balanced'
    },
    axes: {
      spine: input.grid ? 'left-bottom' : 'minimal',
      tickDirection: 'out',
      grid: input.grid,
      gridTone: input.gridTone,
      gridColor: input.gridColor,
      gridAlpha: input.grid ? 0.42 : 0,
      gridLineWidth: input.grid ? 0.35 : 0
    },
    marks: {
      lineWidth: input.lineWidth,
      markerSize: input.markerSize,
      errorBarStyle: 'unknown',
      density: input.density
    },
    annotations: {
      significance: 'unknown',
      legend: 'frameless'
    },
    export: {
      formats: ['png'],
      dpi: 300,
      transparent: false
    },
    confidence: input.confidence
  }
}

function shapeStyleProfileForResult(
  profile: ScientificPlottingStyleProfile,
  includeStyleSpec: boolean
): ScientificPlottingStyleProfileSummary {
  const { styleSpec, ...summary } = profile
  return {
    ...summary,
    ...(includeStyleSpec ? { styleSpec } : {})
  }
}

function shapeStyleProfileMatchForResult(
  match: InternalStyleProfileMatch,
  includeStyleSpec: boolean
): ScientificPlottingStyleProfileMatch {
  return {
    profileId: match.profile.id,
    profile: shapeStyleProfileForResult(match.profile, includeStyleSpec),
    score: match.score,
    reasons: match.reasons,
    cautions: match.cautions
  }
}

async function selectStyleProfilesForTransfer(input: {
  workspaceRoot: string
  referenceImagePath?: string
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  explicitStyleProfileId?: string
  warnings: string[]
}): Promise<ScientificPlottingStyleProfilesResult | undefined> {
  if (input.explicitStyleProfileId?.trim()) {
    const result = await listScientificPlottingStyleProfiles({
      workspaceRoot: input.workspaceRoot,
      profileId: input.explicitStyleProfileId
    })
    if (!result.ok) input.warnings.push(result.message)
    return result
  }
  if (input.styleSpec) {
    const result = await listScientificPlottingStyleProfiles({
      workspaceRoot: input.workspaceRoot,
      styleSpec: input.styleSpec,
      topK: 3
    })
    if (!result.ok) input.warnings.push(result.message)
    return result
  }
  if (input.styleSpecPath?.trim()) {
    const result = await listScientificPlottingStyleProfiles({
      workspaceRoot: input.workspaceRoot,
      styleSpecPath: input.styleSpecPath,
      topK: 3
    })
    if (!result.ok) input.warnings.push(result.message)
    return result
  }
  if (input.referenceImagePath?.trim()) {
    const result = await listScientificPlottingStyleProfiles({
      workspaceRoot: input.workspaceRoot,
      referencePath: input.referenceImagePath,
      topK: 3
    })
    if (!result.ok) input.warnings.push(result.message)
    return result
  }
  return undefined
}

async function resolveStyleSpecForProfileSelection(
  request: ScientificPlottingStyleProfilesRequest,
  workspaceRoot: string | undefined,
  warnings: string[]
): Promise<FigureStyleSpec | undefined> {
  if (request.styleSpec) {
    const spec = unwrapFigureStyleSpec(request.styleSpec)
    if (!spec) warnings.push('styleSpec did not contain a FigureStyleSpec v1 object.')
    return spec ?? undefined
  }
  if (request.styleSpecPath?.trim()) {
    if (!workspaceRoot) {
      warnings.push('workspaceRoot is required to read styleSpecPath for profile matching.')
      return undefined
    }
    try {
      const stylePath = await resolveOpenTargetPath(request.styleSpecPath, workspaceRoot, {
        allowBasenameFallback: true
      })
      const spec = unwrapFigureStyleSpec(JSON.parse(await readFile(stylePath, 'utf8')) as unknown)
      if (!spec) warnings.push('styleSpecPath did not contain a FigureStyleSpec v1 object.')
      return spec ?? undefined
    } catch (error) {
      warnings.push(`Could not read styleSpecPath for profile matching: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  if (request.referencePath?.trim()) {
    if (!workspaceRoot) {
      warnings.push('workspaceRoot is required to inspect referencePath for profile matching.')
      return undefined
    }
    const extracted = await extractFigureStyle({
      workspaceRoot,
      sourcePath: request.referencePath,
      sourceType: 'image',
      figureId: 'scientific-plotting-style-profile-reference'
    })
    if (!extracted.ok) {
      warnings.push(`Could not inspect referencePath for profile matching: ${extracted.message}`)
      return undefined
    }
    return extracted.spec
  }
  return undefined
}

function rankStyleProfilesForStyleSpec(
  styleSpec: FigureStyleSpec,
  referenceProfile: ScientificPlottingReferenceProfile,
  query?: string
): InternalStyleProfileMatch[] {
  const sourceProfileId = styleSpec.source.path.startsWith('builtin:')
    ? styleSpec.source.path.slice('builtin:'.length)
    : undefined
  return builtInStyleProfiles()
    .map((profile) => scoreStyleProfileAgainstReference(profile, styleSpec, referenceProfile, sourceProfileId, query))
    .filter((match) => !query || scoreStyleProfileMatch(match.profile, query) > 0 || match.score >= 0.46)
    .sort((left, right) => right.score - left.score)
}

function scoreStyleProfileAgainstReference(
  profile: ScientificPlottingStyleProfile,
  styleSpec: FigureStyleSpec,
  referenceProfile: ScientificPlottingReferenceProfile,
  sourceProfileId?: string,
  query?: string
): InternalStyleProfileMatch {
  let score = 0.12
  const reasons: string[] = []
  const cautions = [...profile.cautions]
  const profileTraits = profile.referenceProfile.detectedTraits
  const referenceTraits = referenceProfile.detectedTraits
  const add = (amount: number, reason: string): void => {
    score += amount
    reasons.push(reason)
  }

  if (sourceProfileId === profile.id) {
    add(0.45, 'Reference StyleSpec was generated from this built-in profile.')
  }
  if (profile.referenceProfile.recommendedTemplate === referenceProfile.recommendedTemplate) {
    add(0.16, `Both reference and profile suggest ${referenceProfile.recommendedTemplate}.`)
  } else if (profile.recommendedTemplates.includes(referenceProfile.recommendedTemplate)) {
    add(0.12, `Profile supports the reference-recommended ${referenceProfile.recommendedTemplate} template.`)
  }
  if (profile.referenceProfile.kind === referenceProfile.kind && referenceProfile.kind !== 'unknown') {
    add(0.1, `Both are ${referenceProfile.kind} style references.`)
  }
  if (profileTraits && referenceTraits) {
    if (profileTraits.background === referenceTraits.background) add(0.09, `Background tone matches: ${referenceTraits.background}.`)
    if (profileTraits.grid === referenceTraits.grid) add(0.08, `Grid tone matches: ${referenceTraits.grid}.`)
    if (profileTraits.axes === referenceTraits.axes) add(0.08, `Axis treatment matches: ${referenceTraits.axes}.`)
    if (profileTraits.aspect === referenceTraits.aspect) add(0.06, `Aspect category matches: ${referenceTraits.aspect}.`)
    if (profileTraits.colorMode === referenceTraits.colorMode) add(0.05, `Color mode matches: ${referenceTraits.colorMode}.`)
    if (profileTraits.panelGrid === referenceTraits.panelGrid) add(0.04, `Panel grid matches: ${referenceTraits.panelGrid}.`)
    if (profileTraits.markDensity === referenceTraits.markDensity) add(0.04, `Mark density matches: ${referenceTraits.markDensity}.`)
  }

  const backgroundSimilarity = hexSimilarity(styleSpec.canvas.background, profile.styleSpec.canvas.background, 140)
  score += backgroundSimilarity * 0.1
  if (backgroundSimilarity >= 0.88) reasons.push('Canvas/background color is close.')

  const paletteScore = paletteHexSimilarity(
    styleSpec.palette.accent.length > 0 ? styleSpec.palette.accent : styleSpec.palette.colors,
    profile.styleSpec.palette.accent.length > 0 ? profile.styleSpec.palette.accent : profile.styleSpec.palette.colors
  )
  score += paletteScore * 0.12
  if (paletteScore >= 0.62) reasons.push('Accent palette is reasonably close.')

  const layoutDelta = Math.abs(styleSpec.canvas.aspectRatio - profile.styleSpec.canvas.aspectRatio)
  const layoutScore = clampNumber(1 - layoutDelta / 1.4, 0, 1)
  score += layoutScore * 0.06

  if (query) {
    const queryScore = scoreStyleProfileMatch(profile, query)
    if (queryScore > 0) add(Math.min(0.08, queryScore * 0.02), 'Query text matches profile metadata.')
  }

  if (referenceProfile.risks.length > 0) cautions.push(...referenceProfile.risks)
  if (reasons.length === 0) reasons.push('No strong profile match was detected; this profile is a fallback candidate.')
  return {
    profile,
    score: Number(clampNumber(score, 0, 0.98).toFixed(3)),
    reasons: uniqueReviewStrings(reasons).slice(0, 6),
    cautions: uniqueReviewStrings(cautions).slice(0, 6)
  }
}

function paletteHexSimilarity(referenceColors: string[], profileColors: string[]): number {
  const reference = uniqueHexStrings(referenceColors).slice(0, 5)
  const profile = uniqueHexStrings(profileColors).slice(0, 5)
  if (reference.length === 0 || profile.length === 0) return 0
  const scores = reference.map((color) =>
    Math.max(...profile.map((candidate) => hexSimilarity(color, candidate, 185)))
  )
  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

function hexSimilarity(left: string, right: string, tolerance: number): number {
  return Number(clampNumber(1 - hexDistance(left, right) / tolerance, 0, 1).toFixed(3))
}

function findStyleProfile(profileId: string): ScientificPlottingStyleProfile | undefined {
  return builtInStyleProfiles().find((profile) => profile.id === profileId.trim())
}

function scoreStyleProfileMatch(profile: ScientificPlottingStyleProfile, query: string): number {
  const haystack = [
    profile.id,
    profile.name,
    profile.venue,
    profile.sourceLabel,
    profile.description,
    ...profile.recommendedTemplates,
    ...profile.tags
  ].join(' ').toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean)
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function styleProfileForPlanning(profileId: string | undefined, warnings: string[]): ScientificPlottingStyleProfile | undefined {
  const id = profileId?.trim()
  if (!id) return undefined
  const profile = findStyleProfile(id)
  if (!profile) warnings.push(`Unknown styleProfileId: ${id}.`)
  return profile
}

function styleProfileForRender(request: ScientificPlottingRenderRequest): ScientificPlottingStyleProfile | undefined {
  if (request.styleSpec || request.styleSpecPath?.trim()) return undefined
  const id = request.styleProfileId?.trim()
  if (!id) return undefined
  const profile = findStyleProfile(id)
  if (!profile) {
    throw new Error(`Unknown styleProfileId: ${id}.`)
  }
  return profile
}

function defaultFigureStyleSpec(request: ScientificPlottingRenderRequest): FigureStyleSpec {
  return {
    version: 1,
    source: {
      path: 'sciforge-default',
      type: 'image',
      ...(request.figureId ? { figureId: request.figureId } : {})
    },
    canvas: {
      width: 900,
      height: 620,
      aspectRatio: 1.452,
      background: '#ffffff'
    },
    palette: {
      colors: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000'],
      background: '#ffffff',
      ink: '#222222',
      accent: ['#0072b2', '#d55e00', '#009e73', '#cc79a7'],
      colorMode: 'limited'
    },
    typography: {
      fontFamily: 'Arial',
      axisSize: 7,
      labelSize: 8,
      titleSize: 10,
      weight: 'regular'
    },
    layout: {
      panelGrid: '1x1',
      panelLabels: 'none',
      margin: { left: 0.13, right: 0.05, top: 0.08, bottom: 0.14 },
      gutter: 'balanced'
    },
    axes: {
      spine: 'left-bottom',
      tickDirection: 'out',
      grid: false,
      gridTone: 'none',
      gridColor: '#e5e5e5',
      gridAlpha: 0,
      gridLineWidth: 0
    },
    marks: {
      lineWidth: 1,
      markerSize: 3,
      errorBarStyle: 'none',
      density: 'balanced'
    },
    annotations: {
      significance: 'none',
      legend: 'frameless'
    },
    export: {
      formats: ['png'],
      dpi: 300,
      transparent: false
    },
    confidence: {
      overall: 0.6,
      palette: 0.6,
      layout: 0.6,
      axes: 0.6,
      typography: 0.6
    }
  }
}

function isFigureStyleSpec(value: unknown): value is FigureStyleSpec {
  return isRecord(value) && value.version === 1 && isRecord(value.canvas) && isRecord(value.palette)
}

function unwrapFigureStyleSpec(value: unknown): FigureStyleSpec | null {
  if (isFigureStyleSpec(value)) return value
  if (isRecord(value) && isFigureStyleSpec(value.spec)) return value.spec
  if (isRecord(value) && isRecord(value.result) && isFigureStyleSpec(value.result.spec)) return value.result.spec
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumberArray(value: unknown, minLength: number, maxLength: number): value is number[] {
  return Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isStringArray(value: unknown, minLength: number, maxLength: number): value is string[] {
  return Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

function isAxisArray(value: unknown, expectedLength: number): value is Array<number | string> {
  return Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((item) =>
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= 200)
    )
}

function isWithinWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function slugForFigureId(raw: string): string {
  const slug = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || randomUUID()
}

function hashRequest(request: ScientificPlottingRenderRequest): string {
  return hashStableJson({
    template: request.template,
    data: request.data,
    labels: request.labels,
    figureId: request.figureId,
    styleSpec: request.styleSpec,
    styleSpecPath: request.styleSpecPath,
    styleProfileId: request.styleProfileId,
    referencePath: request.referencePath ?? request.reviewReferencePath,
    outputScale: request.outputScale,
    autoRepair: request.autoRepair
  })
}

function hashPrepareReferenceRequest(request: ScientificPlottingPrepareReferenceRequest): string {
  return hashStableJson({
    sourcePath: request.sourcePath,
    sourceType: request.sourceType,
    page: request.page,
    cropBox: request.cropBox,
    figureId: request.figureId,
    outputDir: request.outputDir,
    dpi: request.dpi,
    extractStyle: request.extractStyle
  })
}

function hashStyleTransferRequest(request: ScientificPlottingStyleTransferRequest): string {
  return hashStableJson({
    task: request.task,
    labels: request.labels,
    templateHint: request.templateHint,
    reference: request.reference,
    styleSpec: request.styleSpec,
    styleSpecPath: request.styleSpecPath,
    styleProfileId: request.styleProfileId,
    figureId: request.figureId,
    outputDir: request.outputDir,
    outputScale: request.outputScale,
    autoRepair: request.autoRepair,
    createReviewPacket: request.createReviewPacket,
    dataDigest: hashStableJson(request.data)
  })
}

function hashStableJson(value: unknown): string {
  const stable = JSON.stringify(value)
  return createHash('sha256').update(stable).digest('hex')
}

function enforceReadableTextColors(
  rcParams: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const background = typeof rcParams['axes.facecolor'] === 'string'
    ? rcParams['axes.facecolor']
    : typeof rcParams['figure.facecolor'] === 'string'
      ? rcParams['figure.facecolor']
      : '#ffffff'
  const text = typeof rcParams['text.color'] === 'string' ? rcParams['text.color'] : '#222222'
  const backgroundLum = hexLuminance(background)
  const textLum = hexLuminance(text)
  if (backgroundLum < 60 && textLum < 120) {
    return {
      ...rcParams,
      'text.color': '#f5f5f5',
      'axes.labelcolor': '#f5f5f5',
      'xtick.color': '#f5f5f5',
      'ytick.color': '#f5f5f5',
      'legend.edgecolor': '#f5f5f5'
    }
  }
  if (backgroundLum > 220 && textLum > 205) {
    return {
      ...rcParams,
      'text.color': '#222222',
      'axes.labelcolor': '#222222',
      'xtick.color': '#222222',
      'ytick.color': '#222222',
      'legend.edgecolor': '#222222'
    }
  }
  return rcParams
}

function enforcePublicationTypography(
  rcParams: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const next = {
    'font.size': clampRcNumber(rcParams['font.size'], 6.8, 6.2, 7.2),
    'axes.labelsize': clampRcNumber(rcParams['axes.labelsize'], 7, 6.5, 7.2),
    'axes.titlesize': clampRcNumber(rcParams['axes.titlesize'], 7.6, 6.8, 8.2),
    'xtick.labelsize': clampRcNumber(rcParams['xtick.labelsize'], 6, 5.6, 6.2),
    'ytick.labelsize': clampRcNumber(rcParams['ytick.labelsize'], 6, 5.6, 6.2),
    'legend.fontsize': clampRcNumber(rcParams['legend.fontsize'], 6, 5.6, 6.2)
  }
  const clampApplied = Object.entries(next).some(([key, value]) =>
    Math.abs(clampRcNumber(rcParams[key], value, -1000, 1000) - value) > 0.05
  )
  return {
    ...rcParams,
    ...next,
    '__sciforge.typographyClampApplied': clampApplied
  }
}

function clampRcNumber(value: string | number | boolean | undefined, fallback: number, low: number, high: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  return Number(clampNumber(Number.isFinite(numeric) ? numeric : fallback, low, high).toFixed(2))
}

function hexLuminance(hex: string): number {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return 255
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexDistance(left: string, right: string): number {
  const leftRgb = hexToRgb(left)
  const rightRgb = hexToRgb(right)
  if (!leftRgb || !rightRgb) return 0
  return Math.sqrt(
    (leftRgb.red - rightRgb.red) ** 2 +
    (leftRgb.green - rightRgb.green) ** 2 +
    (leftRgb.blue - rightRgb.blue) ** 2
  )
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

function uniqueHexStrings(colors: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const color of colors) {
    const normalized = color.trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function tail(value: string, max = 4000): string {
  return value.length <= max ? value : value.slice(value.length - max)
}

const PYTHON_RENDERER_SOURCE = String.raw`
import json
import math
import os
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap, to_rgb
from matplotlib.patches import Rectangle, FancyArrowPatch

payload = json.load(sys.stdin)

def as_float(value, fallback):
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except Exception:
        pass
    return fallback

def clamp(value, low, high):
    return max(low, min(high, value))

def rc_value(value):
    return value

style = payload.get("styleSpec") or {}
layout_style = style.get("layout") or {}
plan_rc = {}
palette = []
try:
    # The TypeScript side mirrors buildFigureStyleApplyPlan; this Python side
    # receives only concrete values and never evaluates user code.
    canvas = style.get("canvas") or {}
    palette_spec = style.get("palette") or {}
    typo = style.get("typography") or {}
    axes = style.get("axes") or {}
    marks = style.get("marks") or {}
    annotations = style.get("annotations") or {}
    export = style.get("export") or {}
    background = canvas.get("background") or palette_spec.get("background") or "#ffffff"
    ink = palette_spec.get("ink") or "#222222"
    plan_rc = {
        "figure.facecolor": background,
        "axes.facecolor": background,
        "axes.edgecolor": ink,
        "axes.linewidth": max(0.6, as_float(marks.get("lineWidth"), 1.0) * 0.9),
        "axes.axisbelow": True,
        "axes.grid": bool(axes.get("grid")),
        "grid.color": axes.get("gridColor") or "#e5e5e5",
        "grid.alpha": as_float(axes.get("gridAlpha"), 0.0),
        "grid.linewidth": as_float(axes.get("gridLineWidth"), 0.4),
        "grid.linestyle": "-",
        "axes.spines.left": axes.get("spine") != "none",
        "axes.spines.bottom": axes.get("spine") != "none",
        "axes.spines.top": axes.get("spine") == "box",
        "axes.spines.right": axes.get("spine") == "box",
        "font.family": typo.get("fontFamily") or "Arial",
        "font.size": as_float(typo.get("labelSize"), 8),
        "text.color": ink,
        "axes.labelcolor": ink,
        "axes.labelsize": as_float(typo.get("labelSize"), 8),
        "axes.titlesize": as_float(typo.get("titleSize"), 10),
        "xtick.color": ink,
        "ytick.color": ink,
        "xtick.labelsize": as_float(typo.get("axisSize"), 7),
        "ytick.labelsize": as_float(typo.get("axisSize"), 7),
        "xtick.direction": "out",
        "ytick.direction": "out",
        "xtick.major.width": clamp(as_float(marks.get("lineWidth"), 1.0) * 0.65, 0.45, 0.9),
        "ytick.major.width": clamp(as_float(marks.get("lineWidth"), 1.0) * 0.65, 0.45, 0.9),
        "xtick.major.size": 2.5,
        "ytick.major.size": 2.5,
        "lines.linewidth": as_float(marks.get("lineWidth"), 1.0),
        "lines.markersize": as_float(marks.get("markerSize"), 3.0),
        "legend.frameon": annotations.get("legend") == "boxed",
        "legend.fontsize": as_float(typo.get("axisSize"), 7),
        "legend.facecolor": background,
        "legend.edgecolor": ink,
        "savefig.dpi": int(as_float(export.get("dpi"), 300)),
        "savefig.facecolor": background,
        "savefig.transparent": bool(export.get("transparent", False)),
    }
    palette = palette_spec.get("accent") or palette_spec.get("colors") or []
except Exception:
    plan_rc = {}
    palette = []

if isinstance(payload.get("rcParams"), dict):
    plan_rc = payload.get("rcParams") or {}
if isinstance(payload.get("palette"), list) and payload.get("palette"):
    palette = payload.get("palette")
rc_patch = payload.get("rcParamsPatch") or {}
plan_rc.update(rc_patch)
for key, value in plan_rc.items():
    try:
        mpl.rcParams[key] = rc_value(value)
    except Exception:
        pass

palette_override = payload.get("paletteOverride")
if isinstance(palette_override, list) and palette_override:
    palette = palette_override
if not palette:
    palette = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#000000"]
def payload_contains_cjk(value):
    try:
        text = json.dumps(value, ensure_ascii=False)
    except Exception:
        text = str(value)
    for char in text:
        code = ord(char)
        if (0x3400 <= code <= 0x4DBF) or (0x4E00 <= code <= 0x9FFF) or (0xF900 <= code <= 0xFAFF) or (0x3040 <= code <= 0x30FF) or (0xAC00 <= code <= 0xD7AF):
            return True
    return False

def configure_cjk_font_if_needed():
    mpl.rcParams["axes.unicode_minus"] = False
    if not payload_contains_cjk(payload):
        return None
    candidates = [
        "PingFang SC",
        "Hiragino Sans GB",
        "Heiti SC",
        "STHeiti",
        "Songti SC",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "Microsoft YaHei",
        "SimHei",
        "Arial Unicode MS",
        "WenQuanYi Zen Hei",
    ]
    available = {font.name for font in font_manager.fontManager.ttflist}
    selected = next((name for name in candidates if name in available), None)
    if selected is None:
        return None
    existing = mpl.rcParams.get("font.sans-serif", [])
    if isinstance(existing, str):
        existing = [existing]
    requested = mpl.rcParams.get("font.family", [])
    if isinstance(requested, str):
        requested = [requested]
    mpl.rcParams["font.family"] = "sans-serif"
    mpl.rcParams["font.sans-serif"] = [selected] + [name for name in requested + list(existing) if name and name != selected]
    return selected

selected_cjk_font = configure_cjk_font_if_needed()

try:
    from cycler import cycler
    mpl.rcParams["axes.prop_cycle"] = cycler(color=palette)
except Exception:
    pass

template = payload["template"]
data = payload["data"]
labels = payload.get("labels") or {}
output_path = payload["outputPath"]
os.makedirs(os.path.dirname(output_path), exist_ok=True)

canvas = style.get("canvas") or {}
aspect = clamp(as_float(canvas.get("aspectRatio"), 1.45), 0.55, 2.4)
if aspect >= 1:
    fig_w = clamp(4.2, 2.6, 7.2)
    fig_h = clamp(fig_w / aspect, 2.2, 5.5)
else:
    fig_h = clamp(3.4, 2.2, 5.5)
    fig_w = clamp(fig_h * aspect, 2.6, 7.2)
fig, ax = plt.subplots(figsize=(fig_w, fig_h), constrained_layout=True)
raw_title = str(labels.get("title") or "")
requested_title_size = as_float(mpl.rcParams.get("axes.titlesize", 7.6), 7.6)
requested_label_size = as_float(mpl.rcParams.get("axes.labelsize", 7.0), 7.0)
requested_tick_size = as_float(mpl.rcParams.get("xtick.labelsize", 6.0), 6.0)
requested_legend_size = as_float(mpl.rcParams.get("legend.fontsize", 6.0), 6.0)
title_size = clamp(requested_title_size, 6.8, 8.2)
if len(raw_title) > 30:
    title_size = min(title_size, 6.9)
elif len(raw_title) > 22:
    title_size = min(title_size, 7.3)
label_size = clamp(requested_label_size, 6.5, 7.2)
tick_size = clamp(requested_tick_size, 5.6, 6.2)
legend_size = clamp(requested_legend_size, 5.6, 6.2)
panel_size = clamp(title_size + 0.4, 7.8, 8.4)
publication_clamp_applied = any([
    abs(title_size - requested_title_size) > 0.05,
    abs(label_size - requested_label_size) > 0.05,
    abs(tick_size - requested_tick_size) > 0.05,
    abs(legend_size - requested_legend_size) > 0.05,
]) or bool(plan_rc.get("__sciforge.typographyClampApplied", False))
renderer_diagnostics = {
    "layoutNotes": [],
    "fontFallback": {
        "cjk": selected_cjk_font,
    },
    "typography": {
        "titleSize": round(title_size, 2),
        "labelSize": round(label_size, 2),
        "tickSize": round(tick_size, 2),
        "legendSize": round(legend_size, 2),
        "panelSize": round(panel_size, 2),
        "publicationClampApplied": bool(publication_clamp_applied),
    },
    "layoutQuality": {
        "legendItemCount": 0,
        "legendColumnCount": 0,
        "legendOutsidePlot": False,
        "legendOverlapRisk": "none",
        "textOverflowRisk": "none",
        "panelLabelAdjusted": False,
        "warnings": [],
    }
}
savefig_pad_inches = 0.035
legend_artists = []
panel_label_artist = None

def add_layout_note(note):
    if note not in renderer_diagnostics["layoutNotes"]:
        renderer_diagnostics["layoutNotes"].append(note)

def add_layout_warning(message):
    warnings = renderer_diagnostics["layoutQuality"]["warnings"]
    if message not in warnings:
        warnings.append(message)

def risk_max(left, right):
    order = {"none": 0, "low": 1, "medium": 2, "high": 3}
    return left if order.get(left, 0) >= order.get(right, 0) else right

if publication_clamp_applied:
    add_layout_note("Clamped typography to conservative publication-size ranges.")

def set_common_labels(axis):
    if labels.get("title"):
        axis.set_title(labels.get("title"), pad=3, fontsize=title_size)
    if labels.get("x"):
        axis.set_xlabel(labels.get("x"), fontsize=label_size)
    if labels.get("y"):
        axis.set_ylabel(labels.get("y"), fontsize=label_size)

def maybe_legend(axis):
    if labels.get("legend", True):
        handles, legend_labels = axis.get_legend_handles_labels()
        if handles:
            legend_font = legend_size
            visible_labels = [str(label) for label in legend_labels if label and not str(label).startswith("_")]
            longest_label = max([len(label) for label in visible_labels] or [0])
            force_outside = bool(plan_rc.get("__sciforge.forceOutsideLegend", False))
            should_place_outside = (
                force_outside or
                template in ("bar", "errorbar-bar", "histogram-density") or
                len(handles) >= 3 or
                longest_label > 14
            )
            if should_place_outside:
                columns = 1 if len(handles) <= 3 or longest_label > 14 else 2
                legend = axis.legend(
                    loc="upper left",
                    bbox_to_anchor=(1.01, 1.0),
                    borderaxespad=0.0,
                    frameon=False,
                    fontsize=legend_font,
                    ncol=columns,
                    handlelength=1.1,
                    handletextpad=0.35,
                    columnspacing=0.75,
                    labelspacing=0.32,
                )
                legend.set_in_layout(True)
                legend_artists.append(legend)
                renderer_diagnostics["legendPlacement"] = "outside-right"
                renderer_diagnostics["layoutQuality"]["legendItemCount"] = len(handles)
                renderer_diagnostics["layoutQuality"]["legendColumnCount"] = columns
                renderer_diagnostics["layoutQuality"]["legendOutsidePlot"] = True
                if template == "histogram-density":
                    add_layout_note("Placed distribution legend outside the right edge to avoid covering density marks.")
                elif template in ("bar", "errorbar-bar"):
                    add_layout_note("Placed grouped bar legend outside the right edge to avoid covering data.")
                else:
                    add_layout_note("Moved long or dense legend outside the plot area to avoid covering data.")
            else:
                legend = axis.legend(loc="best", fontsize=legend_font, frameon=bool(mpl.rcParams.get("legend.frameon", False)))
                legend_artists.append(legend)
                renderer_diagnostics["legendPlacement"] = "inside"
                renderer_diagnostics["layoutQuality"]["legendItemCount"] = len(handles)
                renderer_diagnostics["layoutQuality"]["legendColumnCount"] = 1
                if len(handles) >= 3 or longest_label > 12:
                    renderer_diagnostics["layoutQuality"]["legendOverlapRisk"] = "medium"
                    add_layout_warning("Legend may overlap plotted data; consider outside-right placement.")
    else:
        renderer_diagnostics["legendPlacement"] = "none"

def x_values(series):
    y = series.get("y") or []
    return series.get("x") or list(range(1, len(y) + 1))

def optional_error_values(series, key):
    values = series.get(key)
    if isinstance(values, list):
        return [abs(as_float(value, 0)) for value in values]
    value = as_float(values, None)
    return value if value is not None else None

def apply_axis_limits(axis, data_source):
    data_source = data_source or {}
    xlim = data_source.get("xlim") or data_source.get("xLim") or data_source.get("xRange")
    ylim = data_source.get("ylim") or data_source.get("yLim") or data_source.get("yRange")
    if isinstance(xlim, list) and len(xlim) == 2:
        left = as_float(xlim[0], None)
        right = as_float(xlim[1], None)
        if left is not None and right is not None and left != right:
            axis.set_xlim(left, right)
    if isinstance(ylim, list) and len(ylim) == 2:
        bottom = as_float(ylim[0], None)
        top = as_float(ylim[1], None)
        if bottom is not None and top is not None and bottom != top:
            axis.set_ylim(bottom, top)

def finite_list(values):
    result = []
    for value in values or []:
        number = as_float(value, None)
        if number is not None and math.isfinite(number):
            result.append(number)
    return result

def resolve_group_position(reference, names, positions):
    if reference is None:
        return None
    if isinstance(reference, bool):
        return None
    if isinstance(reference, (int, float)) and math.isfinite(reference):
        number = int(reference)
        if abs(float(reference) - number) > 1e-9:
            return None
        if 0 <= number < len(positions):
            return positions[number]
        if number in positions:
            return number
        return None
    text = str(reference).strip()
    if not text:
        return None
    lowered = text.lower()
    for index, name in enumerate(names):
        if lowered == str(name).strip().lower():
            return positions[index]
    try:
        return resolve_group_position(int(text), names, positions)
    except Exception:
        return None

def draw_group_comparisons(axis, comparisons, names, positions, grouped_values, font_scale=1.0):
    if not isinstance(comparisons, list) or not comparisons:
        return 0
    resolved = []
    for comparison in comparisons[:8]:
        if not isinstance(comparison, dict):
            continue
        start = resolve_group_position(
            comparison.get("from", comparison.get("a", comparison.get("left", comparison.get("groupA")))),
            names,
            positions,
        )
        end = resolve_group_position(
            comparison.get("to", comparison.get("b", comparison.get("right", comparison.get("groupB")))),
            names,
            positions,
        )
        if start is None or end is None or start == end:
            continue
        label = str(comparison.get("label", comparison.get("text", comparison.get("p", "")))).strip()
        resolved.append((min(start, end), max(start, end), label))
    if not resolved:
        return 0
    all_values = [value for values_for_group in grouped_values for value in values_for_group]
    if not all_values:
        return 0
    y_min, y_max = axis.get_ylim()
    data_min = min(all_values)
    data_max = max(all_values)
    y_min = min(y_min, data_min)
    y_max = max(y_max, data_max)
    y_range = y_max - y_min
    if not math.isfinite(y_range) or y_range <= 0:
        y_range = 1.0
    base = y_max + y_range * 0.06
    step = y_range * 0.085
    height = y_range * 0.025
    top = base + step * max(0, len(resolved) - 1) + y_range * 0.08
    axis.set_ylim(y_min - y_range * 0.04, top)
    color = mpl.rcParams.get("text.color", "#222222")
    for index, (start, end, label) in enumerate(resolved):
        y = base + index * step
        axis.plot([start, start, end, end], [y, y + height, y + height, y], color=color, linewidth=0.72, clip_on=False)
        if label:
            axis.text((start + end) / 2, y + height + y_range * 0.01, label, ha="center", va="bottom", fontsize=max(5.2, tick_size * font_scale), color=color, clip_on=False)
    add_layout_note("Rendered compact group-comparison brackets for distribution panels.")
    return len(resolved)

def set_labels_from(axis, label_source):
    label_source = label_source or {}
    if label_source.get("title"):
        axis.set_title(label_source.get("title"), pad=3, fontsize=title_size)
    if label_source.get("x"):
        axis.set_xlabel(label_source.get("x"), fontsize=label_size)
    if label_source.get("y"):
        axis.set_ylabel(label_source.get("y"), fontsize=label_size)

def gaussian_density(values, points):
    values = finite_list(values)
    if len(values) < 2 or not points:
        return []
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / max(1, len(values) - 1)
    std = math.sqrt(max(variance, 1e-9))
    bandwidth = max(1.06 * std * (len(values) ** -0.2), 1e-6)
    scale = 1 / (len(values) * bandwidth * math.sqrt(2 * math.pi))
    density = []
    for point in points:
        total = sum(math.exp(-0.5 * ((point - value) / bandwidth) ** 2) for value in values)
        density.append(total * scale)
    return density

if template == "line":
    for index, series in enumerate(data.get("series", [])):
        name = series.get("name") or f"Series {index + 1}"
        y = series.get("y") or []
        x = x_values(series)
        error = series.get("error")
        marker = "o" if len(y) <= 80 else None
        if error:
            ax.errorbar(x, y, yerr=error, marker=marker, label=name, capsize=2)
        else:
            ax.plot(x, y, marker=marker, label=name)
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "scatter":
    for index, series in enumerate(data.get("series", [])):
        name = series.get("name") or f"Series {index + 1}"
        y = series.get("y") or []
        x = x_values(series)
        xerr = optional_error_values(series, "xerr")
        yerr = optional_error_values(series, "yerr")
        if xerr is not None or yerr is not None:
            ax.errorbar(
                x,
                y,
                xerr=xerr,
                yerr=yerr,
                fmt="o",
                label=name,
                markersize=max(2.2, mpl.rcParams.get("lines.markersize", 3)),
                capsize=2,
                elinewidth=max(0.45, mpl.rcParams.get("lines.linewidth", 1) * 0.7),
                capthick=max(0.45, mpl.rcParams.get("lines.linewidth", 1) * 0.7),
                alpha=0.9,
            )
        else:
            ax.scatter(x, y, label=name, s=max(10, mpl.rcParams.get("lines.markersize", 3) ** 2), alpha=0.86, linewidths=0.3)
    apply_axis_limits(ax, data)
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "bar" or template == "errorbar-bar":
    categories = data.get("categories") or []
    series = data.get("series") or []
    orientation = str(data.get("orientation") or payload.get("orientation") or "").strip().lower()
    horizontal = orientation in ("horizontal", "barh", "h")
    show_values = bool(data.get("showValues") or payload.get("showValues"))
    x = list(range(len(categories)))
    group_width = 0.68 if len(categories) >= 4 else 0.72
    width = clamp(group_width / max(1, len(series)), 0.08, 0.34)
    positive_baseline = True
    bar_tops = []
    bar_label_artists = []
    for index, item in enumerate(series):
        offset = (index - (len(series) - 1) / 2) * width
        values = item.get("values") or []
        errors = item.get("error") if template == "errorbar-bar" else None
        name = item.get("name") or f"Series {index + 1}"
        colors = item.get("colors") or item.get("color")
        if isinstance(colors, list):
            renderer_diagnostics["barColorMode"] = "per-bar"
        elif colors:
            renderer_diagnostics["barColorMode"] = "series"
        positive_baseline = positive_baseline and all(as_float(value, 0) >= 0 for value in values)
        if values:
            for value_index, value in enumerate(values):
                error_value = 0
                if isinstance(errors, list) and value_index < len(errors):
                    error_value = abs(as_float(errors[value_index], 0))
                bar_tops.append(as_float(value, 0) + error_value)
        if horizontal:
            bars = ax.barh(
                [v + offset for v in x],
                values,
                xerr=errors,
                height=width,
                label=name,
                color=colors,
                linewidth=0,
                capsize=clamp(1.6 + width * 3.0, 1.7, 2.6) if errors else 0,
                error_kw={
                    "elinewidth": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "capthick": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "ecolor": mpl.rcParams.get("text.color", "#222222"),
                } if errors else None,
            )
            if show_values:
                bar_label_artists.extend([(bar, as_float(value, 0)) for bar, value in zip(bars, values)])
        else:
            bars = ax.bar(
                [v + offset for v in x],
                values,
                yerr=errors,
                width=width,
                label=name,
                color=colors,
                linewidth=0,
                capsize=clamp(1.6 + width * 3.0, 1.7, 2.6) if errors else 0,
                error_kw={
                    "elinewidth": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "capthick": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "ecolor": mpl.rcParams.get("text.color", "#222222"),
                } if errors else None,
            )
            if show_values:
                bar_label_artists.extend([(bar, as_float(value, 0)) for bar, value in zip(bars, values)])
    if horizontal:
        ax.set_yticks(x, categories)
        ax.invert_yaxis()
        ax.tick_params(axis="x", pad=1.5)
        ax.tick_params(axis="y", pad=1.5)
        renderer_diagnostics["barOrientation"] = "horizontal"
        renderer_diagnostics["categoryLabelRotation"] = 0
    else:
        max_category_len = max([len(str(value)) for value in categories] or [0])
        rotation = 28 if max_category_len > 12 else 18 if max_category_len > 8 or len(categories) > 4 else 0
        ax.set_xticks(x, categories, rotation=rotation, ha="right" if rotation else "center")
        ax.tick_params(axis="x", pad=1.5)
        ax.tick_params(axis="y", pad=1.5)
        renderer_diagnostics["barOrientation"] = "vertical"
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if positive_baseline:
        if horizontal:
            ax.set_xlim(left=0)
        else:
            ax.set_ylim(bottom=0)
    if bar_tops:
        top = max(bar_tops)
        if top > 0:
            if horizontal:
                ax.set_xlim(right=top * (1.22 if show_values else 1.16))
            else:
                ax.set_ylim(top=top * (1.22 if show_values else 1.16))
            add_layout_note("Reserved extra y-axis headroom for error bars and panel labels.")
    if show_values and bar_label_artists:
        label_offset = max(bar_tops or [1]) * 0.02
        for bar, value in bar_label_artists:
            if horizontal:
                ax.text(
                    bar.get_width() + label_offset,
                    bar.get_y() + bar.get_height() / 2,
                    f"{value:g}",
                    va="center",
                    ha="left",
                    fontsize=tick_size,
                    color=mpl.rcParams.get("text.color", "#222222"),
                )
            else:
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + label_offset,
                    f"{value:g}",
                    va="bottom",
                    ha="center",
                    fontsize=tick_size,
                    color=mpl.rcParams.get("text.color", "#222222"),
                )
        add_layout_note("Added compact value labels to categorical bars.")
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "heatmap":
    matrix = data.get("matrix") or []
    heatmap_colors = payload.get("heatmapCmapColors")
    if isinstance(heatmap_colors, list) and len(heatmap_colors) >= 2:
        cmap = LinearSegmentedColormap.from_list("sciforge_style_heatmap", heatmap_colors)
    else:
        cmap = data.get("cmap") or "cividis"
    im = ax.imshow(matrix, aspect="auto", cmap=cmap)
    x_labels = data.get("xLabels") or data.get("colLabels") or data.get("columnLabels") or data.get("columns") or data.get("x")
    y_labels = data.get("yLabels") or data.get("rowLabels") or data.get("row_labels") or data.get("targets") or data.get("y")
    if x_labels:
        x_labels = [str(value) for value in x_labels]
        rotation = 36 if max([len(value) for value in x_labels] or [0]) > 6 or len(x_labels) > 4 else 0
        ax.set_xticks(list(range(len(x_labels))), x_labels, rotation=rotation, ha="right" if rotation else "center")
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if y_labels:
        y_labels = [str(value) for value in y_labels]
        ax.set_yticks(list(range(len(y_labels))), y_labels)
    set_common_labels(ax)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.ax.tick_params(labelsize=mpl.rcParams.get("xtick.labelsize", 7))
elif template == "attention-map":
    matrix = data.get("matrix") or []
    heatmap_colors = payload.get("heatmapCmapColors")
    if isinstance(heatmap_colors, list) and len(heatmap_colors) >= 2:
        cmap = LinearSegmentedColormap.from_list("sciforge_attention_map", heatmap_colors)
    else:
        cmap = data.get("cmap") or "magma"
    im = ax.imshow(matrix, aspect="auto", cmap=cmap, interpolation="nearest")
    x_labels = data.get("xLabels") or data.get("colLabels") or data.get("columnLabels") or data.get("columns") or data.get("x")
    y_labels = data.get("yLabels") or data.get("rowLabels") or data.get("row_labels") or data.get("targets") or data.get("y")
    if x_labels:
        x_labels = [str(value) for value in x_labels]
        rotation = 36 if max([len(value) for value in x_labels] or [0]) > 6 or len(x_labels) > 4 else 0
        ax.set_xticks(list(range(len(x_labels))), x_labels, rotation=rotation, ha="right" if rotation else "center")
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if y_labels:
        y_labels = [str(value) for value in y_labels]
        ax.set_yticks(list(range(len(y_labels))), y_labels)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(length=2.5, width=0.7)
    set_common_labels(ax)
    if data.get("colorbar", False):
        cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.025)
        cbar.outline.set_visible(False)
        cbar.ax.tick_params(labelsize=mpl.rcParams.get("xtick.labelsize", 7))
elif template == "box-violin":
    groups = data.get("groups") or []
    values = [finite_list(group.get("values") or []) for group in groups]
    names = [str(group.get("name") or f"Group {index + 1}") for index, group in enumerate(groups)]
    positions = list(range(1, len(values) + 1))
    mode = str(data.get("mode") or "box+violin").lower()
    if "violin" in mode:
        violins = ax.violinplot(values, positions=positions, widths=0.74, showmeans=False, showmedians=False, showextrema=False)
        for index, body in enumerate(violins.get("bodies", [])):
            body.set_facecolor(palette[index % len(palette)])
            body.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
            body.set_alpha(0.22)
            body.set_linewidth(0.7)
    if "box" in mode:
        box = ax.boxplot(
            values,
            positions=positions,
            widths=0.28,
            patch_artist=True,
            showfliers=False,
            medianprops={"color": mpl.rcParams.get("text.color", "#222222"), "linewidth": 0.95},
            whiskerprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.75},
            capprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.75},
        )
        for index, patch in enumerate(box.get("boxes", [])):
            patch.set_facecolor(palette[index % len(palette)])
            patch.set_alpha(0.34)
            patch.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
            patch.set_linewidth(0.75)
    if data.get("showPoints", True):
        for index, group_values in enumerate(values):
            color = palette[index % len(palette)]
            jittered = [positions[index] + math.sin((point_index + 1) * 12.9898) * 0.055 for point_index in range(len(group_values))]
            ax.scatter(jittered, group_values, s=7, color=color, alpha=0.42, linewidths=0, zorder=3)
        add_layout_note("Overlayed deterministic jitter points for distribution transparency.")
    max_name_len = max([len(name) for name in names] or [0])
    rotation = 28 if max_name_len > 10 or len(names) > 4 else 0
    ax.set_xticks(positions, names, rotation=rotation, ha="right" if rotation else "center")
    renderer_diagnostics["categoryLabelRotation"] = rotation
    ax.margins(x=0.04)
    comparison_count = draw_group_comparisons(ax, data.get("comparisons"), names, positions, values)
    if comparison_count:
        renderer_diagnostics["distributionComparisonCount"] = comparison_count
    set_common_labels(ax)
elif template == "histogram-density":
    series = data.get("series") or []
    bins = int(data.get("bins") or 24)
    density = bool(data.get("density", True))
    all_values = []
    for item in series:
        all_values.extend(finite_list(item.get("values") or []))
    if all_values:
        minimum = min(all_values)
        maximum = max(all_values)
        if minimum == maximum:
            minimum -= 0.5
            maximum += 0.5
        density_points = [minimum + (maximum - minimum) * index / 79 for index in range(80)]
    else:
        density_points = []
    for index, item in enumerate(series):
        values = finite_list(item.get("values") or [])
        name = item.get("name") or f"Series {index + 1}"
        color = palette[index % len(palette)]
        ax.hist(values, bins=bins, density=density, alpha=0.22, color=color, edgecolor=color, linewidth=0.45, label=name)
        if density and data.get("densityLine", True) and density_points:
            smooth = gaussian_density(values, density_points)
            if smooth:
                ax.plot(density_points, smooth, color=color, linewidth=max(0.85, mpl.rcParams.get("lines.linewidth", 1.0)), label="_nolegend_")
    add_layout_note("Rendered histogram with optional first-party Gaussian KDE overlay.")
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "multi-panel":
    panels = data.get("panels") or []
    columns = int(data.get("columns") or min(2, max(1, len(panels))))
    columns = int(clamp(columns, 1, 3))
    rows = int(math.ceil(len(panels) / columns))
    fig.clear()
    fig.set_size_inches(clamp(3.15 * columns, 3.2, 7.2), clamp(2.35 * rows, 2.4, 6.8), forward=True)
    axes_grid = fig.subplots(rows, columns, squeeze=False)
    panel_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    default_panel_labels = str(layout_style.get("panelLabels") or "unknown")
    def draw_small_panel(axis, panel, panel_index):
        panel_template = panel.get("template")
        panel_data = panel.get("data") or {}
        panel_labels = panel.get("labels") or {}
        if panel_template == "line":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or panel_data.get("x") or list(range(1, len(y) + 1))
                axis.plot(x, y, marker="o" if len(y) <= 24 else None, linewidth=mpl.rcParams.get("lines.linewidth", 1.0), markersize=2.4, label=name)
        elif panel_template == "scatter":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or list(range(1, len(y) + 1))
                xerr = optional_error_values(series, "xerr")
                yerr = optional_error_values(series, "yerr")
                if xerr is not None or yerr is not None:
                    axis.errorbar(
                        x,
                        y,
                        xerr=xerr,
                        yerr=yerr,
                        fmt="o",
                        label=name,
                        markersize=2.8,
                        capsize=2,
                        elinewidth=0.62,
                        capthick=0.62,
                        alpha=0.9,
                    )
                else:
                    axis.scatter(x, y, s=10, alpha=0.82, linewidths=0.25, label=name)
            apply_axis_limits(axis, panel_data)
        elif panel_template == "bar" or panel_template == "errorbar-bar":
            categories = panel_data.get("categories") or []
            series = panel_data.get("series") or []
            x = list(range(len(categories)))
            width = clamp(0.68 / max(1, len(series)), 0.08, 0.34)
            for series_index, item in enumerate(series):
                offset = (series_index - (len(series) - 1) / 2) * width
                errors = item.get("error") if panel_template == "errorbar-bar" else None
                axis.bar([value + offset for value in x], item.get("values") or [], yerr=errors, width=width, label=item.get("name") or f"Series {series_index + 1}", linewidth=0, capsize=1.8 if errors else 0)
            axis.set_xticks(x, categories, rotation=24 if len(categories) > 3 else 0, ha="right" if len(categories) > 3 else "center")
        elif panel_template == "heatmap" or panel_template == "attention-map":
            cmap = panel_data.get("cmap") or ("magma" if panel_template == "attention-map" else "cividis")
            image = axis.imshow(panel_data.get("matrix") or [], aspect="auto", cmap=cmap, interpolation="nearest")
            if panel_template == "heatmap" and panel_data.get("colorbar", False):
                fig.colorbar(image, ax=axis, fraction=0.046, pad=0.035)
            panel_x_labels = panel_data.get("xLabels") or panel_data.get("colLabels") or panel_data.get("columnLabels") or panel_data.get("columns") or panel_data.get("x")
            panel_y_labels = panel_data.get("yLabels") or panel_data.get("rowLabels") or panel_data.get("row_labels") or panel_data.get("targets") or panel_data.get("y")
            if panel_x_labels:
                panel_x_labels = [str(value) for value in panel_x_labels]
                rotation = 36 if max([len(value) for value in panel_x_labels] or [0]) > 6 or len(panel_x_labels) > 4 else 0
                axis.set_xticks(list(range(len(panel_x_labels))), panel_x_labels, rotation=rotation, ha="right" if rotation else "center")
            else:
                axis.set_xticks([])
            if panel_y_labels:
                panel_y_labels = [str(value) for value in panel_y_labels]
                axis.set_yticks(list(range(len(panel_y_labels))), panel_y_labels)
            else:
                axis.set_yticks([])
            axis.grid(False)
            if panel_template == "attention-map":
                for spine in axis.spines.values():
                    spine.set_visible(False)
        elif panel_template == "box-violin":
            groups = panel_data.get("groups") or []
            group_values = [finite_list(group.get("values") or []) for group in groups]
            names = [str(group.get("name") or f"G{index + 1}") for index, group in enumerate(groups)]
            positions = list(range(1, len(group_values) + 1))
            mode = str(panel_data.get("mode") or "box+violin").lower()
            if "violin" in mode:
                violins = axis.violinplot(group_values, positions=positions, widths=0.65, showmeans=False, showmedians=False, showextrema=False)
                for group_index, body in enumerate(violins.get("bodies", [])):
                    body.set_facecolor(palette[group_index % len(palette)])
                    body.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
                    body.set_alpha(0.18)
                    body.set_linewidth(0.55)
            if "box" in mode:
                box = axis.boxplot(
                    group_values,
                    positions=positions,
                    widths=0.24,
                    patch_artist=True,
                    showfliers=False,
                    medianprops={"color": mpl.rcParams.get("text.color", "#222222"), "linewidth": 0.72},
                    whiskerprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.58},
                    capprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.58},
                )
                for group_index, patch in enumerate(box.get("boxes", [])):
                    patch.set_facecolor(palette[group_index % len(palette)])
                    patch.set_alpha(0.3)
                    patch.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
                    patch.set_linewidth(0.58)
            if panel_data.get("showPoints", True):
                for group_index, values_for_group in enumerate(group_values):
                    color = palette[group_index % len(palette)]
                    jittered = [positions[group_index] + math.sin((point_index + 1) * 12.9898) * 0.052 for point_index in range(len(values_for_group))]
                    axis.scatter(jittered, values_for_group, s=5.5, color=color, alpha=0.48, linewidths=0, zorder=3)
            comparison_count = draw_group_comparisons(axis, panel_data.get("comparisons"), names, positions, group_values, font_scale=0.9)
            if comparison_count:
                renderer_diagnostics["distributionComparisonCount"] = renderer_diagnostics.get("distributionComparisonCount", 0) + comparison_count
            axis.set_xticks(positions, names, rotation=24 if len(names) > 3 else 0, ha="right" if len(names) > 3 else "center")
        elif panel_template == "histogram-density":
            for series_index, item in enumerate(panel_data.get("series") or []):
                values = finite_list(item.get("values") or [])
                axis.hist(values, bins=int(panel_data.get("bins") or 18), density=bool(panel_data.get("density", True)), alpha=0.25, label=item.get("name") or f"Series {series_index + 1}")
        elif panel_template == "schematic-grid" or panel_template == "flowchart":
            axis.axis("off")
            nodes = panel_data.get("nodes") or []
            for node_index, node in enumerate(nodes[:4]):
                axis.text(0.5, 0.84 - node_index * 0.22, str(node.get("label") or ""), ha="center", va="center", fontsize=min(label_size, 7.5), bbox={"boxstyle": "round,pad=0.18", "facecolor": palette[node_index % len(palette)], "alpha": 0.12, "edgecolor": mpl.rcParams.get("axes.edgecolor", "#222222")})
                if panel_template == "flowchart" and node_index < min(len(nodes), 4) - 1:
                    axis.annotate("", xy=(0.5, 0.76 - node_index * 0.22), xytext=(0.5, 0.70 - node_index * 0.22), arrowprops={"arrowstyle": "-|>", "lw": 0.55, "color": mpl.rcParams.get("axes.edgecolor", "#222222"), "alpha": 0.65})
        set_labels_from(axis, panel_labels)
        if panel_labels.get("legend", False):
            handles, legend_labels = axis.get_legend_handles_labels()
            if handles:
                axis.legend(loc="best", fontsize=6.2, frameon=False)
        panel_label = panel.get("panel")
        if panel_label is None and default_panel_labels != "none":
            panel_label = panel_letters[panel_index]
        if panel_label:
            axis.text(-0.16, 1.08, panel_label, transform=axis.transAxes, fontweight="bold", va="top", fontsize=9.2, clip_on=False)
    for panel_index, panel in enumerate(panels):
        row = panel_index // columns
        col = panel_index % columns
        draw_small_panel(axes_grid[row][col], panel, panel_index)
    for empty_index in range(len(panels), rows * columns):
        row = empty_index // columns
        col = empty_index % columns
        axes_grid[row][col].axis("off")
    if labels.get("title"):
        fig.suptitle(labels.get("title"), fontsize=title_size)
        add_layout_note("Reserved constrained-layout space for the multi-panel title.")
    renderer_diagnostics["multiPanelCount"] = len(panels)
    add_layout_note(f"Rendered {len(panels)} controlled subpanels in a {rows}x{columns} layout.")
elif template == "flowchart":
    nodes = data.get("nodes") or []
    raw_edges = data.get("edges") or []
    node_ids = []
    for index, node in enumerate(nodes):
        node_ids.append(str(node.get("id") or node.get("key") or index))
    node_id_set = set(node_ids)
    auto_edges = False
    if not raw_edges and len(node_ids) > 1:
        auto_edges = True
        raw_edges = [{"from": node_ids[index], "to": node_ids[index + 1]} for index in range(len(node_ids) - 1)]
    edges = []
    for edge in raw_edges:
        start_id = str(edge.get("from"))
        end_id = str(edge.get("to"))
        if start_id in node_id_set and end_id in node_id_set:
            edges.append({"from": start_id, "to": end_id, "label": edge.get("label")})
    positions = {}
    box_width = 1.18
    box_height = 0.42
    if auto_edges and len(nodes) > 6:
        columns = int(math.ceil(math.sqrt(len(nodes) * 1.6)))
        rows = int(math.ceil(len(nodes) / max(1, columns)))
        for index, node_id in enumerate(node_ids):
            row_index = index // columns
            col_index = index % columns
            col = col_index if row_index % 2 == 0 else columns - 1 - col_index
            row = rows - 1 - row_index
            positions[node_id] = (col * 1.65 + 0.85, row * 0.92 + 0.62)
        ax.set_xlim(0, columns * 1.65)
        ax.set_ylim(0, rows * 0.92 + 0.45)
    else:
        levels = {node_id: 0 for node_id in node_ids}
        for _ in range(max(1, len(node_ids))):
            changed = False
            for edge in edges:
                start_level = levels.get(edge["from"], 0)
                next_level = min(len(node_ids) - 1, start_level + 1)
                if levels.get(edge["to"], 0) < next_level:
                    levels[edge["to"]] = next_level
                    changed = True
            if not changed:
                break
        grouped = {}
        for node_id in node_ids:
            grouped.setdefault(levels.get(node_id, 0), []).append(node_id)
        columns = max(grouped.keys(), default=0) + 1
        rows = max([len(items) for items in grouped.values()] or [1])
        for level, items in grouped.items():
            for item_index, node_id in enumerate(items):
                y_offset = (rows - len(items)) * 0.5
                positions[node_id] = (level * 1.75 + 0.85, (rows - 1 - item_index - y_offset) * 0.92 + 0.62)
        ax.set_xlim(0, max(1, columns) * 1.75)
        ax.set_ylim(0, max(1, rows) * 0.92 + 0.45)
    ax.axis("off")
    def wrap_flow_label(value):
        text = str(value or "")
        if len(text) <= 13 or " " not in text:
            return text
        words = text.split()
        lines = []
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if len(candidate) <= 12:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return "\n".join(lines[:3])
    def flow_font_size(label):
        base = as_float(mpl.rcParams.get("font.size", 8), 8)
        longest = max([len(part) for part in str(label).split("\n")] or [0])
        if longest > 15:
            return min(base, 6.4)
        if longest > 11:
            return min(base, 7.0)
        return min(base, 8.0)
    def boundary_points(start, end):
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        if abs(dx) >= abs(dy):
            start_offset = (box_width / 2 + 0.04 if dx >= 0 else -box_width / 2 - 0.04, 0)
            end_offset = (-box_width / 2 - 0.04 if dx >= 0 else box_width / 2 + 0.04, 0)
        else:
            start_offset = (0, box_height / 2 + 0.04 if dy >= 0 else -box_height / 2 - 0.04)
            end_offset = (0, -box_height / 2 - 0.04 if dy >= 0 else box_height / 2 + 0.04)
        return (sx + start_offset[0], sy + start_offset[1]), (ex + end_offset[0], ey + end_offset[1])
    for edge in edges:
        start = positions.get(edge["from"])
        end = positions.get(edge["to"])
        if not start or not end:
            continue
        start_edge, end_edge = boundary_points(start, end)
        arrow = FancyArrowPatch(
            start_edge,
            end_edge,
            arrowstyle="-|>",
            mutation_scale=11,
            linewidth=0.85,
            color=mpl.rcParams.get("axes.edgecolor", "#222222"),
            alpha=0.76,
            connectionstyle="arc3,rad=0.04",
            zorder=1,
        )
        ax.add_patch(arrow)
        if edge.get("label"):
            ax.text((start_edge[0] + end_edge[0]) / 2, (start_edge[1] + end_edge[1]) / 2 + 0.08, str(edge.get("label")), ha="center", va="center", fontsize=min(label_size, 6.4), color=mpl.rcParams.get("text.color", "#222222"), zorder=4)
    for index, node in enumerate(nodes):
        node_id = node_ids[index]
        x, y = positions.get(node_id, (0, 0))
        color = node.get("color") or palette[index % len(palette)]
        rect = Rectangle((x - box_width / 2, y - box_height / 2), box_width, box_height, facecolor=color, edgecolor=mpl.rcParams.get("axes.edgecolor", "#222222"), linewidth=0.85, alpha=0.16, zorder=2)
        ax.add_patch(rect)
        label = wrap_flow_label(node.get("label", ""))
        ax.text(x, y, label, ha="center", va="center", fontsize=flow_font_size(label), color=mpl.rcParams.get("text.color", "#222222"), wrap=True, linespacing=0.94, zorder=3)
    renderer_diagnostics["flowchartNodeCount"] = len(nodes)
    renderer_diagnostics["flowchartEdgeCount"] = len(edges)
    if auto_edges:
        add_layout_note("Rendered directed flowchart with inferred sequential arrows because no edges were provided.")
    else:
        add_layout_note("Rendered directed flowchart with explicit arrows.")
    if labels.get("title"):
        ax.set_title(labels.get("title"), pad=4, fontsize=title_size)
elif template == "schematic-grid":
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    columns = int(math.ceil(math.sqrt(len(nodes))))
    rows = int(math.ceil(len(nodes) / max(1, columns)))
    positions = {}
    node_sizes = {}
    explicit_positions = all(isinstance(node.get("x"), (int, float)) and isinstance(node.get("y"), (int, float)) for node in nodes)
    if explicit_positions:
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        add_layout_note("Used explicit schematic node coordinates.")
    else:
        ax.set_xlim(0, columns)
        ax.set_ylim(0, rows)
    ax.axis("off")
    def first_present(mapping, *keys):
        for key in keys:
            value = mapping.get(key)
            if value is not None:
                return value
        return None
    def wrap_node_label(value, max_line_length=None, max_lines=None, target_width=None):
        text = str(value or "")
        paragraphs = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        width_limit = int(clamp(round(as_float(target_width, 0.24) * 56), 8, 24))
        requested_limit = int(clamp(as_float(max_line_length, width_limit), 8, 24))
        line_limit = min(requested_limit, width_limit)
        default_line_count = max(3, min(5, len(paragraphs)))
        line_count_limit = int(clamp(as_float(max_lines, default_line_count), 1, 5))
        lines = []
        for paragraph in paragraphs:
            paragraph = str(paragraph).strip()
            if not paragraph:
                continue
            wrapped = textwrap.wrap(
                paragraph,
                width=line_limit,
                break_long_words=False,
                break_on_hyphens=False,
            )
            if not wrapped and paragraph:
                wrapped = [paragraph]
            if len(wrapped) == 1 and len(wrapped[0]) > line_limit * 1.35:
                wrapped = textwrap.wrap(
                    wrapped[0],
                    width=line_limit,
                    break_long_words=True,
                    break_on_hyphens=False,
                )
            lines.extend(wrapped)
        if not lines:
            return text
        truncated = len(lines) > line_count_limit
        lines = lines[:line_count_limit]
        if truncated and lines:
            lines[-1] = (lines[-1][:max(1, line_limit - 3)] + "...") if len(lines[-1]) > line_limit - 3 else lines[-1] + "..."
        return "\n".join(lines)
    def contrast_text_color(facecolor, alpha=0.18, fallback=None):
        fallback = fallback or mpl.rcParams.get("text.color", "#222222")
        try:
            face_rgb = to_rgb(facecolor)
            bg_rgb = to_rgb(mpl.rcParams.get("axes.facecolor", "#ffffff"))
            effective = tuple(alpha * face_rgb[i] + (1 - alpha) * bg_rgb[i] for i in range(3))
            def channel(value):
                return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4
            luminance = 0.2126 * channel(effective[0]) + 0.7152 * channel(effective[1]) + 0.0722 * channel(effective[2])
            return fallback if luminance >= 0.48 else "#ffffff"
        except Exception:
            return fallback
    def has_wrapped_label(original, wrapped):
        original_text = str(original or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        wrapped_text = str(wrapped or "").strip()
        return "\n" in original_text or wrapped_text.replace("\n", " ") != " ".join(original_text.split())
    def node_font_size(label):
        base = as_float(mpl.rcParams.get("font.size", 8), 8)
        parts = str(label).split("\n")
        longest = max([len(part) for part in parts] or [0])
        if len(parts) >= 4:
            return min(base, 5.6)
        if len(parts) >= 3:
            return min(base, 6.2)
        if longest > 13:
            return min(base, 6.8)
        if longest > 10:
            return min(base, 7.4)
        return min(base, 8.4)
    wrapped_node_labels = 0
    for index, node in enumerate(nodes):
        requested_width = first_present(node, "width", "w")
        requested_height = first_present(node, "height", "h")
        raw_label = node.get("label", "")
        label = wrap_node_label(raw_label, node.get("maxLineLength"), node.get("maxLines"), requested_width)
        if has_wrapped_label(raw_label, label):
            wrapped_node_labels += 1
        if explicit_positions:
            center_x = clamp(float(node.get("x")), 0.08, 0.92)
            center_y = clamp(float(node.get("y")), 0.10, 0.90)
            longest = max([len(part) for part in str(label).split("\n")] or [0])
            width = clamp(as_float(requested_width, 0.13 + longest * 0.0055), 0.12, 0.42)
            height = clamp(as_float(requested_height, 0.14 if "\n" not in str(label) else 0.10 + 0.038 * len(str(label).split("\n"))), 0.10, 0.34)
            x = center_x - width / 2
            y = center_y - height / 2
        else:
            row_index = index // columns
            col_index = index % columns
            col = col_index if row_index % 2 == 0 else columns - 1 - col_index
            row = rows - 1 - row_index
            x = col + 0.12
            y = row + 0.25
            width = 0.76
            height = 0.5
            center_x = x + width / 2
            center_y = y + height / 2
        color = node.get("color") or node.get("fill") or palette[index % len(palette)]
        alpha = clamp(as_float(first_present(node, "alpha", "opacity"), 0.18), 0.08, 1.0)
        text_color = first_present(node, "textColor", "labelColor", "fontColor") or contrast_text_color(color, alpha)
        rect = Rectangle((x, y), width, height, facecolor=color, edgecolor=mpl.rcParams.get("axes.edgecolor", "#222222"), linewidth=0.9, alpha=alpha, zorder=2)
        ax.add_patch(rect)
        ax.text(center_x, center_y, label, ha="center", va="center", fontsize=node_font_size(label), color=text_color, wrap=True, linespacing=0.95, zorder=3)
        node_id = str(node.get("id") or str(index))
        positions[node_id] = (center_x, center_y)
        node_sizes[node_id] = (width, height)
    if wrapped_node_labels:
        add_layout_note("Preserved and wrapped schematic node labels within node bounds.")
    def edge_points(start_id, end_id):
        start = positions[start_id]
        end = positions[end_id]
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        start_w, start_h = node_sizes.get(start_id, (0.76, 0.5))
        end_w, end_h = node_sizes.get(end_id, (0.76, 0.5))
        if abs(dx) >= abs(dy):
            start_offset = ((start_w / 2 + 0.012) if dx > 0 else -(start_w / 2 + 0.012), 0)
            end_offset = (-(end_w / 2 + 0.012) if dx > 0 else (end_w / 2 + 0.012), 0)
        else:
            start_offset = (0, (start_h / 2 + 0.012) if dy > 0 else -(start_h / 2 + 0.012))
            end_offset = (0, -(end_h / 2 + 0.012) if dy > 0 else (end_h / 2 + 0.012))
        return (sx + start_offset[0], sy + start_offset[1]), (ex + end_offset[0], ey + end_offset[1])
    drawn_edges = 0
    for edge in edges:
        start_id = first_present(edge, "from", "source", "start")
        end_id = first_present(edge, "to", "target", "end")
        if start_id is None or end_id is None:
            continue
        start_key = str(start_id)
        end_key = str(end_id)
        if start_key in positions and end_key in positions:
            start_edge, end_edge = edge_points(start_key, end_key)
            edge_style = str(edge.get("style") or edge.get("type") or "").lower()
            linestyle = "--" if "dash" in edge_style or "inhibit" in edge_style else "-"
            edge_color = edge.get("color") or mpl.rcParams.get("axes.edgecolor", "#222222")
            arrow = FancyArrowPatch(
                start_edge,
                end_edge,
                arrowstyle="-|>",
                mutation_scale=14,
                linewidth=1.15,
                color=edge_color,
                alpha=0.9,
                linestyle=linestyle,
                connectionstyle="arc3,rad=0.0" if explicit_positions else "angle3,angleA=0,angleB=90",
                shrinkA=2,
                shrinkB=2,
                zorder=2.6,
            )
            ax.add_patch(arrow)
            edge_label = edge.get("label")
            if edge_label:
                label_x = (start_edge[0] + end_edge[0]) / 2
                label_y = (start_edge[1] + end_edge[1]) / 2
                ax.text(label_x, label_y, str(edge_label).replace("\n", " "), ha="center", va="center", fontsize=min(label_size, 5.8), color=mpl.rcParams.get("text.color", "#222222"), bbox={"boxstyle": "round,pad=0.16", "facecolor": "white", "alpha": 0.82, "edgecolor": "none"}, zorder=4)
            drawn_edges += 1
    add_layout_note(f"Rendered {drawn_edges} of {len(edges)} schematic edges.")
    renderer_diagnostics["schematicNodeCount"] = len(nodes)
    renderer_diagnostics["schematicEdgeCount"] = drawn_edges
    renderer_diagnostics["schematicExplicitPositions"] = bool(explicit_positions)
    if drawn_edges < len(edges):
        add_layout_note("Skipped schematic edges with missing source or target ids.")
    if labels.get("title"):
        ax.set_title(labels.get("title"), pad=4, fontsize=title_size)
else:
    raise ValueError(f"Unsupported template: {template}")

for figure_axis in fig.axes:
    try:
        figure_axis.tick_params(axis="both", labelsize=tick_size, pad=1.2)
        for tick_label in figure_axis.get_xticklabels() + figure_axis.get_yticklabels():
            tick_label.set_fontsize(tick_size)
    except Exception:
        pass

if template not in ("schematic-grid", "flowchart", "heatmap", "attention-map", "multi-panel"):
    if mpl.rcParams.get("axes.grid"):
        ax.grid(True)
    for spine in ("top", "right"):
        try:
            ax.spines[spine].set_visible(bool(mpl.rcParams.get(f"axes.spines.{spine}", False)))
        except Exception:
            pass

if labels.get("panel") and template != "multi-panel":
    panel_x = -0.24 if labels.get("title") else -0.1
    panel_y = 1.075 if labels.get("title") else 1.06
    panel_label_artist = ax.text(panel_x, panel_y, labels.get("panel"), transform=ax.transAxes, fontweight="bold", va="top", fontsize=panel_size, clip_on=False)
    renderer_diagnostics["layoutQuality"]["panelLabelAdjusted"] = bool(labels.get("title"))
    if labels.get("title"):
        add_layout_note("Offset panel label away from title to avoid overlap.")

def bbox_area(bbox):
    return max(0, bbox.width) * max(0, bbox.height)

def bbox_intersection_area(first, second):
    x0 = max(first.x0, second.x0)
    x1 = min(first.x1, second.x1)
    y0 = max(first.y0, second.y0)
    y1 = min(first.y1, second.y1)
    return max(0, x1 - x0) * max(0, y1 - y0)

def finalize_layout_quality():
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
        axes_bboxes = [
            figure_axis.get_window_extent(renderer)
            for figure_axis in fig.axes
            if figure_axis.get_visible()
        ]
        legend_risk = renderer_diagnostics["layoutQuality"]["legendOverlapRisk"]
        for legend in legend_artists:
            legend_bbox = legend.get_window_extent(renderer)
            for axes_bbox in axes_bboxes:
                overlap = bbox_intersection_area(legend_bbox, axes_bbox)
                if overlap <= 0:
                    continue
                axes_fraction = overlap / max(1.0, bbox_area(axes_bbox))
                legend_fraction = overlap / max(1.0, bbox_area(legend_bbox))
                if axes_fraction > 0.2 or (legend_fraction > 0.95 and axes_fraction > 0.14):
                    legend_risk = risk_max(legend_risk, "high")
                elif axes_fraction > 0.09:
                    legend_risk = risk_max(legend_risk, "medium")
                elif axes_fraction > 0.035:
                    legend_risk = risk_max(legend_risk, "low")
        renderer_diagnostics["layoutQuality"]["legendOverlapRisk"] = legend_risk
        if legend_risk in ("medium", "high"):
            add_layout_warning("Legend overlaps the plotting region; rerender with outside-right legend placement.")

        text_risk = renderer_diagnostics["layoutQuality"]["textOverflowRisk"]
        if len(raw_title) > 52:
            text_risk = risk_max(text_risk, "medium")
            add_layout_warning("Title is long enough to require wrapping or a shorter caption-style title.")
        elif len(raw_title) > 38:
            text_risk = risk_max(text_risk, "low")
        if len(str(labels.get("x") or "")) > 30 or len(str(labels.get("y") or "")) > 30:
            text_risk = risk_max(text_risk, "low")
        if panel_label_artist is not None:
            panel_bbox = panel_label_artist.get_window_extent(renderer)
            fig_bbox = fig.bbox
            if panel_bbox.x0 < fig_bbox.x0 - 4 or panel_bbox.y1 > fig_bbox.y1 + 4:
                renderer_diagnostics["layoutQuality"]["panelLabelAdjusted"] = True
                text_risk = risk_max(text_risk, "low")
        renderer_diagnostics["layoutQuality"]["textOverflowRisk"] = text_risk
    except Exception:
        add_layout_warning("Layout QA could not inspect text and legend bounding boxes.")

dpi = int(mpl.rcParams.get("savefig.dpi", 300))
finalize_layout_quality()
renderer_diagnostics["savefigPadInches"] = savefig_pad_inches
fig.savefig(
    output_path,
    dpi=dpi,
    facecolor=mpl.rcParams.get("savefig.facecolor", "white"),
    transparent=bool(mpl.rcParams.get("savefig.transparent", False)),
    bbox_inches="tight",
    pad_inches=savefig_pad_inches,
)
plt.close(fig)
print(json.dumps({"ok": True, "outputPath": output_path, "rendererDiagnostics": renderer_diagnostics}))
`
