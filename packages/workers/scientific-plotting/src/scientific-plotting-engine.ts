import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { visualSceneToScientificData } from '@sciforge/image-generation/visual-scene'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  artifactVersionAccessPolicyV1Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionCommitResultV1Schema,
  artifactVersionReadResultV1Schema,
  artifactVersionRefV1Schema
} from '@sciforge/domain-artifact-versions/contract'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type {
  FigureStyleSpec,
  VisualStyleReviewResult,
  VisualStyleSimilarityMetric
} from './types'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES,
  type DataSourceRef,
  type DerivedTableReceipt,
  type ScientificExternalSkillCatalogItem,
  type ScientificExternalSkillSourceKind,
  type ScientificFigureNeed,
  type ScientificFigureNeedClassification,
  type ScientificPlotEnvironmentV1,
  type ScientificPlotEvidenceArtifactV1,
  type ScientificPlotEvidenceCommitRefsV1,
  type ScientificPlotEvidenceDeliveryV1,
  type ScientificPlotEvidenceEnqueueReceiptV1,
  type ScientificPlotEvidenceLineageV1,
  type ScientificPlotEvidenceOutboxReceiptV1,
  type ScientificPlotExecutionV1,
  type ScientificPlotMatplotlibParametersV1,
  type ScientificPlotRecipeV1,
  type ScientificPlotTransformationV1,
  type ScientificPlotVersionCommitReceipt,
  type ScientificPlottingCompareRequest,
  type ScientificPlottingCompareResult,
  type ScientificPlottingComparison,
  type ScientificPlottingEngineDependencies,
  type ScientificPlottingAttempt,
  type ScientificPlottingAutoRepairOptions,
  type ScientificPlottingCompositeLayer,
  type ScientificPlottingCompositeRequest,
  type ScientificPlottingCompositeResult,
  type ScientificPlottingCropBox,
  type ScientificPlottingDataMappingRequest,
  type ScientificPlottingDataMappingResult,
  type ScientificPlottingLabels,
  type ScientificPlottingManifest,
  type ScientificPlottingOperationReceiptV1,
  type ScientificPlottingPlanRequest,
  type ScientificPlottingPlanResult,
  type ScientificPlottingPrepareReferenceRequest,
  type ScientificPlottingPrepareReferenceResult,
  type ScientificPlottingReferenceManifest,
  type ScientificPlottingReferenceProfile,
  type ScientificPlottingRerunRequest,
  type ScientificPlottingRerunResult,
  type ScientificPlottingRenderRequest,
  type ScientificPlottingRenderResult,
  type ScientificPlottingReviewPacket,
  type ScientificPlottingReviewPacketItem,
  type ScientificPlottingReviewPacketRequest,
  type ScientificPlottingReviewPacketResult,
  type ScientificPlottingReviewRequest,
  type ScientificPlottingReviewResult,
  type ScientificPlottingStatusResult,
  type ScientificPlottingStyleProfile,
  type ScientificPlottingStyleProfileMatch,
  type ScientificPlottingStyleProfileSummary,
  type ScientificPlotProvenanceBreakpointV1,
  type ScientificPlottingStyleProfilesRequest,
  type ScientificPlottingStyleProfilesResult,
  type ScientificPlottingTemplate,
  type ScientificPlottingTemplateAdvice,
  type ScientificPlottingTemplateGuide,
  type ScientificPlottingTemplateSelection,
  type StatisticalDefinitionV1
} from './types'
import {
  scientificPlotEvidenceEnqueueReceiptV1Schema,
  scientificPlotEvidenceOutboxReceiptV1Schema,
  scientificPlottingOperationIdSchema,
  scientificPlottingOperationReceiptV1Schema
} from './contract'
import {
  EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES,
  buildScientificExternalSkillCatalog
} from './scientific-skills-index'
import {
  buildMatplotlibStyleAdapterFromFigureStyleSpec,
  extractVisualStyleProfile,
  figureStyleSpecFromVisualStyleProfile,
  reviewVisualStyleSimilarity
} from './visual-style-extractor'
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
  heatmapCmapName?: string
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
  aggregationApplied?: {
    method: 'mean'
    groupBy: string[]
  }
  inferredUncertainty?: {
    kind: 'sd' | 'sem' | 'ci' | 'ambiguous'
    sourceColumn: string
  }
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
const RENDER_TIMEOUT_MS = 45_000
const MATPLOTLIB_PROBE_TIMEOUT_MS = 30_000
const PYTHON_COMMAND = process.env.SCIFORGE_PYTHON?.trim() || 'python3'
const PDFTOPPM_COMMAND = process.env.SCIFORGE_PDFTOPPM?.trim() || 'pdftoppm'
const DEFAULT_OUTPUT_RELATIVE_DIR = '.sciforge/figures'
const PLOTTING_OPERATION_RECEIPT_RELATIVE_DIR = '.sciforge/scientific-plotting/operations'
const EVIDENCE_OUTBOX_RELATIVE_DIR = '.sciforge/evidence-dag/inbox/scientific-plotting'
const EVIDENCE_DELIVERY_RECEIPT_RELATIVE_DIR = '.sciforge/evidence-dag/delivery-receipts/scientific-plotting'
const DEFAULT_REFERENCE_RELATIVE_DIR = '.sciforge/figure-references'
const DEFAULT_REVIEW_PACKET_RELATIVE_DIR = '.sciforge/figure-reviews'
const PDF_RENDER_RELATIVE_DIR = '.sciforge/pdf-render-cache'
const MAX_SERIES = 12
const MAX_POINTS = 5000
const MAX_HEATMAP_CELLS = 40_000
const MAX_SCHEMATIC_NODES = 50
const MAX_SCHEMATIC_PRIMITIVES = 500
const MAX_FLOWCHART_NODES = 12
const MAX_FLOWCHART_LABEL_CHARS = 720
const MAX_DISTRIBUTION_GROUPS = 24
const MAX_DISTRIBUTION_POINTS = 6000
const MAX_MULTI_PANELS = 6
const MIN_COMPOSITE_SIZE = 128
const MAX_COMPOSITE_SIZE = 4096
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const MAX_REFERENCE_IMAGE_BYTES = 32 * 1024 * 1024
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
        'visual_generate',
        'sciforge_invoke',
        'image_generation_review_candidate'
      ],
      recommendedCapabilityIds: ['scientific-plotting.map-data', 'scientific-plotting.render'],
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
        'visual_generate',
        'sciforge_invoke',
        'image_generation_review_candidate'
      ],
      recommendedCapabilityIds: ['scientific-plotting.map-data', 'scientific-plotting.render'],
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
      'visual_generate',
      'sciforge_invoke',
      'image_generation_review_candidate'
    ],
    recommendedCapabilityIds: ['scientific-plotting.map-data', 'scientific-plotting.render'],
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
  const route = 'needs_clarification' as const
  const recommendedNextTool = 'visual_generate' as const
  const avoidTemplates: ScientificPlottingTemplate[] = looksLikeLongProse && !hasExplicitNodeEdges
    ? ['flowchart']
    : []
  const warnings = [
    ...(looksLikeLongProse && !hasExplicitNodeEdges
      ? ['Long prose should be converted into a figure brief or image/diagram prompt before rendering; avoid forcing it into compact flowchart nodes.']
      : []),
  ]

  return {
    primaryNeed,
    secondaryNeeds,
    confidence,
    route,
    routeReason: 'Figure-need classification does not select an executor. The calling model must submit a structured decision to visual_generate.',
    domain,
    recommendedNextTool,
    requiredInputs: requiredInputsForFigureNeed(primaryNeed),
    avoidTemplates,
    warnings
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
  const planSkillCatalog = buildScientificExternalSkillCatalog({
    figureNeeds: [figureNeed.primaryNeed, ...figureNeed.secondaryNeeds],
    domain: request.domain ?? figureNeed.domain
  })
  const recommendedSkillIds = recommendedSkillIdsForPlan(planSkillCatalog, figureNeed, {
    includeCns: false
  })
  const controlledTool = 'sciforge_invoke'
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
    controlledCapability: 'scientific-plotting.render',
    planningWarnings: [
      ...warnings,
      ...figureNeed.warnings,
      ...(templateAdvice?.messages ?? [])
    ],
    guardrails: [
      'Do not emit executable shell or Python commands.',
      'Use K-Dense skills only as read-only plotting guidance.',
      'Use CNS/domain skills only as read-only planning guidance; do not execute third-party scripts.',
      'Use the visual_generate context loop for any missing external context before rendering.',
      'Template planning cannot change the route locked by visual_generate.',
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
  if (!isControlledPlottingPlan(request.visualPlan)) {
    return {
      ok: false,
      status: 'invalid_request',
        message: 'scientific-plotting.map-data requires a route-locked code or hybrid handoff from visual_generate.',
      missingInputs: ['visualPlan'],
      warnings
    }
  }
  if (!task) {
    return {
      ok: false,
      status: 'invalid_request',
      message: 'Task is required.',
      missingInputs: ['task'],
      warnings
    }
  }
  if (!request.visualPlan.scene && isRecord(request.data) && Array.isArray(request.data.primitives)) {
    return {
      ok: false,
      status: 'invalid_request',
      message: 'Vector scenes must be declared once as requirements.scene in visual_generate; raw data.primitives is not a public scene input.',
      missingInputs: ['visualPlan.scene'],
      warnings
    }
  }
  try {
    scientificPlottingOperationIdSchema.parse(request.operationId)
    validateEvidenceRouting(request)
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
    const sceneData = request.visualPlan.scene
      ? visualSceneToScientificData(request.visualPlan.scene)
      : undefined
    const mappedInput = sceneData ?? request.data
    const taskSignals = inferTemplateSignalsFromText(task)
    const taskTemplate = taskSignals[0] ?? 'line'
    const candidates = buildDataMappingCandidates(mappedInput, {
      task,
      labels: request.labels,
      taskTemplate,
      templateHint: sceneData ? 'schematic-grid' : request.templateHint,
      referenceProfile,
      reproducibilityMode: request.reproducibilityMode ?? 'standard',
      statistics: request.statistics
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
      templateHint: sceneData ? 'schematic-grid' : request.templateHint,
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

    const reproducibilityMode = request.reproducibilityMode ?? 'standard'
    if (
      reproducibilityMode === 'reproducible'
      && selected.aggregationApplied
      && !declaresAggregation(request.statistics, selected.aggregationApplied)
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: 'Duplicate summary rows require an explicit matching statistics.aggregation declaration in reproducible mode.',
        missingInputs: ['statistics.aggregation.method=mean', `statistics.aggregation.groupBy=${selected.aggregationApplied.groupBy.join(',')}`],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      reproducibilityMode === 'reproducible'
      && selected.inferredUncertainty?.kind === 'ambiguous'
      && !request.statistics?.uncertainty
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: `Uncertainty column ${selected.inferredUncertainty.sourceColumn} is ambiguous; declare whether it is SD, SEM, or CI.`,
        missingInputs: ['statistics.uncertainty.kind'],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      reproducibilityMode === 'reproducible'
      && selected.inferredUncertainty?.kind === 'ci'
      && (
        !request.statistics?.uncertainty
        || (
          request.statistics.uncertainty.kind === 'ci'
          && request.statistics.uncertainty.confidenceLevel === undefined
        )
      )
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: `CI column ${selected.inferredUncertainty.sourceColumn} requires an explicit confidenceLevel in reproducible mode.`,
        missingInputs: ['statistics.uncertainty.confidenceLevel'],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      selected.inferredUncertainty
      && selected.inferredUncertainty.kind !== 'ambiguous'
      && request.statistics?.uncertainty
      && request.statistics.uncertainty.kind !== selected.inferredUncertainty.kind
    ) {
      return {
        ok: false,
        status: 'invalid_request',
        message: `Declared uncertainty kind ${request.statistics.uncertainty.kind} conflicts with column ${selected.inferredUncertainty.sourceColumn}.`,
        missingInputs: [],
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
    const sourceInputHash = hashStableJson(mappedInput)
    const mappedOutputHash = hashStableJson(selected.data)
    const dataSources = request.dataSources?.length
      ? request.dataSources
      : [inlineDataSourceRef(sourceInputHash, 'scientific-plotting.map-data.data')]
    const mappingTransformation = buildMappingTransformation({
      inputHash: sourceInputHash,
      outputHash: mappedOutputHash,
      selected,
      selectedBy
    })
    const transformations = [...(request.transformations ?? []), mappingTransformation]
    const derivedTableReceipt = buildDerivedTableReceipt({
      selected,
      sourceIds: dataSources.map((source) => source.sourceId),
      transformation: mappingTransformation
    })
    const statistics = request.statistics ?? inferredStatisticsForCandidate(selected)
    const provenanceWarnings = uniqueStrings([...warnings, ...selected.warnings])
    const renderRequest: ScientificPlottingRenderRequest = {
      workspaceRoot,
      operationId: request.operationId,
      visualPlan: request.visualPlan,
      template: selected.template,
      data: selected.data,
      reproducibilityMode,
      dataSources,
      derivedTableReceipts: [...(request.derivedTableReceipts ?? []), derivedTableReceipt],
      transformations,
      ...(statistics ? { statistics } : {}),
      provenanceWarnings,
      ...(request.versioning ? { versioning: request.versioning } : {}),
      reviewTask: task,
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
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.runtimeId ? { runtimeId: request.runtimeId } : {}),
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
        'Use sciforge_invoke with capability scientific-plotting.render for artifact creation, then image_generation_review_candidate for manifest-bound candidate release QA.'
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
  const baseReview = await reviewVisualStyleSimilarity({
    workspaceRoot: request.workspaceRoot,
    referencePath: request.referencePath,
    outputPath: request.outputPath
  })
  if (!baseReview.ok) return baseReview

  const referenceProfile = await inferReferenceProfileFromReferencePath(request)
  const templateAdvice = buildTemplateAdvice(request.template, referenceProfile, baseReview.metric)
  return {
    ...baseReview,
    ...(request.template ? { template: request.template } : {}),
    ...(referenceProfile ? { referenceProfile } : {}),
    ...(templateAdvice ? { templateAdvice } : {})
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
      const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
      if (outputHash !== manifest.outputHash) {
        throw new Error(`Scientific plotting render manifest output hash mismatch: ${rawManifestPath}`)
      }
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
      const extracted = await extractVisualStyleProfile({
        workspaceRoot,
        sourcePath: crop.outputPath,
        sourceType: 'image',
        figureId
      })
      if (extracted.ok) {
        styleSpec = figureStyleSpecFromVisualStyleProfile(extracted.profile)
        referenceProfile = inferReferenceProfileFromStyle(styleSpec, {
          task: request.figureId
        })
        styleProfileMatches = rankStyleProfilesForStyleSpec(styleSpec, referenceProfile)
          .slice(0, 3)
          .map((match) => shapeStyleProfileMatchForResult(match, false))
        recommendedStyleProfile = styleProfileMatches[0]?.profile
        styleSpecPath = join(outputDir, `${figureId}.style.json`)
        await writeFile(styleSpecPath, `${JSON.stringify({
          profile: extracted.profile,
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
        suggestedPlanTool: 'visual_generate',
        suggestedRenderTool: 'sciforge_invoke',
        suggestedRenderCapability: 'scientific-plotting.render',
        suggestedReviewTool: 'image_generation_review_candidate',
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

type ScientificPlotRerunContext = Readonly<{
  baselineFigureVersionRef: ArtifactVersionRefV1
  /** Immutable executable source pinned by the baseline Figure version. */
  codeSnapshot: Readonly<{
    ref: ArtifactVersionRefV1
    bytes: Uint8Array
  }>
}>

export async function renderScientificPlot(
  request: ScientificPlottingRenderRequest,
  dependencies: ScientificPlottingEngineDependencies = {},
  rerunContext?: ScientificPlotRerunContext
): Promise<ScientificPlottingRenderResult> {
  const warnings: string[] = uniqueStrings(request.provenanceWarnings ?? [])
  try {
    if (!isControlledPlottingPlan(request.visualPlan)) {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'scientific-plotting.render requires a route-locked code or hybrid handoff from visual_generate.',
        warnings
      }
    }
    validateRenderRequestShape(request)
    const operationId = scientificPlottingOperationIdSchema.parse(request.operationId)
    validateEvidenceRouting(request)
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const requestHash = hashRequest(request, rerunContext)
    const operationReceiptPath = scientificPlotOperationReceiptPath(workspaceRoot, operationId)
    await assertSafeWorkspaceWritePath(workspaceRoot, operationReceiptPath)
    const existingOperation = await readScientificPlotOperationReceipt(workspaceRoot, operationReceiptPath)
    if (existingOperation) {
      return await resumeScientificPlotOperation({
        request,
        workspaceRoot,
        dependencies,
        rerunContext,
        requestHash,
        operationReceiptPath,
        receipt: existingOperation
      })
    }
    validateTemplateData(request.template, request.data)
    validateReproducibleStatisticalClaims(request)
    assertVersionedSourcesForFormalReproducibleSave(
      request,
      request.dataSources ?? [],
      dependencies
    )
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
    const outputRoot = await resolveOutputDir(workspaceRoot, request.outputDir)

    const matplotlib = await checkMatplotlib(workspaceRoot)
    if (!matplotlib.available) {
      return {
        ok: false,
        status: 'renderer_unavailable',
        message: matplotlib.message ?? 'Matplotlib is unavailable.',
        warnings
      }
    }

    const environment = await captureScientificPlotEnvironment(workspaceRoot)
    const figureId = slugForFigureId(request.figureId ?? `${request.template}-${new Date().toISOString()}`)
    const dataSources = await resolveAndVerifyDataSourceRefs(request, workspaceRoot)
    const autoRepair = normalizeAutoRepairOptions(request.autoRepair)
    let finalMatplotlib = resolveMatplotlibRenderParameters(request, styleSpec)
    const codeBytes = rerunContext?.codeSnapshot.bytes ?? Buffer.from(PYTHON_RENDERER_SOURCE, 'utf8')
    const codeSha256 = createHash('sha256').update(codeBytes).digest('hex')
    if (rerunContext && codeSha256 !== rerunContext.codeSnapshot.ref.contentDigest) {
      throw new Error('Pinned scientific plot code ArtifactVersion digest does not match its snapshot bytes.')
    }
    let recipe = buildScientificPlotRecipe({
      request,
      workspaceRoot,
      figureId,
      styleSpec,
      matplotlib: finalMatplotlib,
      outputScale,
      autoRepair,
      environment,
      dataSources,
      rendererCodeSha256: codeSha256
    })
    const plotVersionId = `plot-${hashStableJson({ operationId }).slice(0, 28)}`
    const outputDir = join(outputRoot, figureId, 'versions', plotVersionId)
    await mkdir(outputDir, { recursive: true })
    const recipePath = join(outputDir, `${figureId}.recipe.json`)
    // Keep the exact executable renderer beside every new version. This makes
    // the Code route inspectable and replayable after package upgrades.
    const codePath = join(outputDir, `${figureId}.render.py`)
    await writeFile(codePath, codeBytes)
    await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8')
    const baseOutputPath = join(outputDir, `${figureId}.png`)
    const referencePath = request.referencePath ?? request.reviewReferencePath
    const attempts: ScientificPlottingAttempt[] = []
    const first = await renderAttempt({
      request,
      workspaceRoot,
      styleSpec,
      matplotlib: finalMatplotlib,
      outputPath: baseOutputPath,
      codePath
    })
    if (!first.ok) return first.error

    let finalOutputPath = baseOutputPath
    let finalReview: ScientificPlottingReviewResult | undefined
    let status: 'rendered' | 'repaired' | 'review_failed' = 'rendered'
    const firstOutputHash = await hashFile(baseOutputPath)

    let firstReview: VisualStyleReviewResult | undefined
    if (referencePath) {
      firstReview = await reviewVisualStyleSimilarity({
        workspaceRoot,
        referencePath,
        outputPath: baseOutputPath
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
      outputHash: firstOutputHash,
      executedAt: new Date().toISOString(),
      repaired: false,
      ...(finalReview ? { review: finalReview } : {}),
      ...(first.rendererDiagnostics ? { rendererDiagnostics: first.rendererDiagnostics } : {}),
      warnings: [...warnings]
    })

    if (
      referencePath &&
      firstReview?.ok &&
      firstReview.repairSuggestion.shouldRerender &&
      autoRepair.enabled &&
      autoRepair.maxAttempts > 0 &&
      // Pinned parameters represent an exact replay contract. Adaptive
      // mutation would no longer be a rerun of that recorded recipe.
      !request.matplotlib
    ) {
      const repairedOutputPath = join(outputDir, `${figureId}-repaired.png`)
      finalMatplotlib = resolveMatplotlibRenderParameters(
        request,
        styleSpec,
        firstReview.repairSuggestion.rcParamsPatch,
        firstReview.repairSuggestion.palette
      )
      const repair = await renderAttempt({
        request,
        workspaceRoot,
        styleSpec,
        matplotlib: finalMatplotlib,
        outputPath: repairedOutputPath,
        codePath
      })
      if (!repair.ok) return repair.error
      const repairedReview = await reviewVisualStyleSimilarity({
        workspaceRoot,
        referencePath,
        outputPath: repairedOutputPath
      })
      finalOutputPath = repairedOutputPath
      finalReview = decorateReviewWithPlottingContext(repairedReview, request.template, referenceProfile)
      status = repairedReview.ok ? 'repaired' : 'review_failed'
      if (!repairedReview.ok) warnings.push(repairedReview.message)
      const repairedOutputHash = await hashFile(repairedOutputPath)
      attempts.push({
        attempt: 2,
        outputPath: repairedOutputPath,
        outputHash: repairedOutputHash,
        executedAt: new Date().toISOString(),
        repaired: true,
        review: finalReview,
        rcParamsPatch: firstReview.repairSuggestion.rcParamsPatch,
        ...(repair.rendererDiagnostics ? { rendererDiagnostics: repair.rendererDiagnostics } : {}),
        warnings: repairedReview.ok ? repairedReview.metric.warnings : [repairedReview.message]
      })
    }

    // Auto-repair can change the concrete rcParams and palette. Rebuild the
    // immutable recipe after the final attempt so it records what produced the
    // committed bytes rather than only the pre-review rendering intent.
    recipe = buildScientificPlotRecipe({
      request,
      workspaceRoot,
      figureId,
      styleSpec,
      matplotlib: finalMatplotlib,
      outputScale,
      autoRepair,
      environment,
      dataSources,
      codePath,
      rendererCodeSha256: codeSha256
    })
    await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8')

    if (!dependencies.artifactVersionCommitPort) {
      warnings.push('Artifact version commit capability is unavailable; the render remains unversioned and cannot claim complete Evidence provenance.')
    } else if (status === 'review_failed') {
      warnings.push('Visual review failed; the render attempt was retained locally but no formal Figure ArtifactVersion was committed.')
    }

    const manifestPath = join(outputDir, `${figureId}.manifest.json`)
    const outputHash = createHash('sha256').update(await readFile(finalOutputPath)).digest('hex')
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
      operationId,
      plotVersionId,
      requestHash,
      recipePath,
      codePath,
      recipe,
      outputPath: finalOutputPath,
      outputHash,
      visualPlan: request.visualPlan,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.runtimeId ? { runtimeId: request.runtimeId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(outputScale > 1 ? { outputScale } : {}),
      ...(request.styleSpecPath ? { styleSpecPath: request.styleSpecPath } : {}),
      ...(referencePath ? { referencePath } : {}),
      attempts,
      ...(finalReview ? { finalReview } : {}),
      warnings
    }
    const preCommitManifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const preCommitManifestPath = `${manifestPath}.precommit`
    await writeFile(preCommitManifestPath, preCommitManifestBytes)
    await writeFile(manifestPath, preCommitManifestBytes)
    if (dependencies.artifactVersionCommitPort && status !== 'review_failed') {
      const preparedDigests = await computeScientificPlotPreparedDigests(manifest, preCommitManifestBytes)
      await writeJsonAtomic(workspaceRoot, operationReceiptPath, {
        schemaVersion: 1,
        producer: 'scientific-plotting',
        operationId,
        requestHash,
        state: 'prepared',
        createdAt: manifest.createdAt,
        plotVersionId,
        manifestPath,
        preCommitManifestPath,
        preparedDigests
      } satisfies ScientificPlottingOperationReceiptV1)
      return await finalizePreparedScientificPlotOperation({
        request,
        workspaceRoot,
        dependencies,
        rerunContext,
        operationReceiptPath,
        manifest,
        preCommitManifestBytes
      })
    }
    const artifactManifestPath = await writeScientificPlottingArtifactManifest({
      workspaceRoot,
      figureId,
      plotVersionId,
      outputPath: finalOutputPath,
      manifestPath,
      recipePath,
      codePath,
      recipe,
      request,
      review: finalReview
    })
    manifest.artifactManifestPath = artifactManifestPath
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return {
      ok: true,
      status,
      outputPath: finalOutputPath,
      manifestPath,
      recipePath,
      codePath,
      operationId,
      plotVersionId,
      recipe,
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

export async function rerunScientificPlot(
  request: ScientificPlottingRerunRequest,
  dependencies: ScientificPlottingEngineDependencies = {}
): Promise<ScientificPlottingRerunResult> {
  try {
    scientificPlottingOperationIdSchema.parse(request.operationId)
    validateEvidenceRouting(request)
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    if (!dependencies.artifactVersionReadPort || !dependencies.artifactVersionCommitPort) {
      throw new Error('Exact plot rerun requires Artifact Versions read and commit capabilities.')
    }
    const baseline = await readVersionedPlotBaseline(
      request.baselineFigureVersionRef,
      request.recipeVersionRef,
      dependencies
    )
    await verifyPinnedRecipeInputs(baseline.recipe, dependencies)
    const recipe = baseline.recipe
    const render = await renderScientificPlot({
      workspaceRoot,
      operationId: request.operationId,
      visualPlan: recipe.visualPlan,
      template: recipe.template,
      data: recipe.data,
      reproducibilityMode: recipe.reproducibilityMode,
      dataSources: recipe.dataSources,
      derivedTableReceipts: recipe.derivedTables,
      transformations: recipe.transformations,
      ...(recipe.statistics ? { statistics: recipe.statistics } : {}),
      provenanceWarnings: recipe.provenanceWarnings,
      versioning: {
        artifactId: request.baselineFigureVersionRef.artifactId,
        expectedCurrentVersionId: request.expectedCurrentVersionId,
        intent: 'rerun'
      },
      ...(recipe.render.reviewTask ? { reviewTask: recipe.render.reviewTask } : {}),
      labels: recipe.labels,
      figureId: recipe.figureId,
      styleSpec: recipe.style.resolvedSpec,
      ...(recipe.style.styleProfileId ? { styleProfileId: recipe.style.styleProfileId } : {}),
      matplotlib: recipe.render.matplotlib ?? resolveLegacyMatplotlibRenderParameters(recipe),
      outputScale: recipe.render.outputScale,
      autoRepair: recipe.render.autoRepair,
      ...(request.runtimeId ? { runtimeId: request.runtimeId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {})
    }, dependencies, {
      baselineFigureVersionRef: request.baselineFigureVersionRef,
      codeSnapshot: baseline.codeSnapshot
    })
    if (!render.ok) {
      return {
        ok: false,
        status: 'rerun_failed',
        message: render.message,
        render,
        provenanceBreakpoints: [scientificPlotRerunBreakpoint(render.message, 'render')]
      }
    }
    const candidate = await readVerifiedScientificPlotManifest(workspaceRoot, render.manifestPath)
    const comparison = compareScientificPlotManifestValues({
      outputHash: request.baselineFigureVersionRef.contentDigest,
      recipe
    }, candidate)
    const reproductionRelation = comparison.exactOutput ? 'replicates' : 'fails_to_replicate'
    const evidenceLineage = render.evidenceLineage
    return {
      ok: true,
      status: 'rerun_complete',
      baselineFigureVersionRef: request.baselineFigureVersionRef,
      recipeVersionRef: request.recipeVersionRef,
      render,
      comparison,
      reproductionRelation,
      ...(evidenceLineage ? { evidenceLineage } : {}),
      ...(render.evidenceDelivery ? { evidenceDelivery: render.evidenceDelivery } : {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : 'version_read_failed',
      message,
      provenanceBreakpoints: [scientificPlotRerunBreakpoint(message, 'baseline', request.baselineFigureVersionRef)]
    }
  }
}

async function readVersionedPlotBaseline(
  figureRef: ArtifactVersionRefV1,
  recipeRef: ArtifactVersionRefV1,
  dependencies: ScientificPlottingEngineDependencies
): Promise<Readonly<{
  recipe: ScientificPlotRecipeV1
  codeSnapshot: Readonly<{
    ref: ArtifactVersionRefV1
    bytes: Uint8Array
  }>
}>> {
  const figure = await readExactArtifactVersion(figureRef, dependencies)
  if (figure.artifact.kind !== 'scientific-plot') {
    throw new Error(`Expected a scientific-plot ArtifactVersion, received ${figure.artifact.kind}.`)
  }
  const pinnedRecipe = figure.version.dependencies.find((dependency) => (
    dependency.role === 'recipe' && dependency.target.versionId === recipeRef.versionId
  ))
  if (!pinnedRecipe || canonicalJson(pinnedRecipe.target) !== canonicalJson(recipeRef)) {
    throw new Error('The Figure version does not pin the supplied recipe ArtifactVersionRef.')
  }
  const codeDependency = figure.version.dependencies.find((dependency) => dependency.role === 'code')
  if (!codeDependency) {
    throw new Error('The baseline Figure version does not pin an executable scientific plot code ArtifactVersion.')
  }
  const codeVersion = await readExactArtifactVersion(codeDependency.target, dependencies)
  if (codeVersion.artifact.kind !== 'scientific-plot-code') {
    throw new Error(`Expected a scientific-plot-code ArtifactVersion, received ${codeVersion.artifact.kind}.`)
  }
  const codeBytes = Buffer.from(codeVersion.dataBase64, 'base64')
  const codeDigest = createHash('sha256').update(codeBytes).digest('hex')
  if (codeDigest !== codeVersion.ref.contentDigest) {
    throw new Error('Pinned scientific plot code ArtifactVersion digest does not match its snapshot bytes.')
  }
  const recipeVersion = await readExactArtifactVersion(recipeRef, dependencies)
  if (recipeVersion.artifact.kind !== 'scientific-plot-recipe') {
    throw new Error(`Expected a scientific-plot-recipe ArtifactVersion, received ${recipeVersion.artifact.kind}.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(recipeVersion.dataBase64, 'base64').toString('utf8'))
  } catch (error) {
    throw new Error(`Could not parse versioned scientific plot recipe: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isScientificPlotRecipeV1(parsed)) {
    throw new Error('Versioned scientific plot recipe does not match ScientificPlotRecipeV1.')
  }
  if (hashStableJson(parsed.data) !== parsed.dataHash) {
    throw new Error('Versioned scientific plot recipe data hash mismatch.')
  }
  const { recipeId, ...recipeContent } = parsed
  if (recipeId !== `plot-recipe:${hashStableJson(recipeContent)}`) {
    throw new Error('Versioned scientific plot recipe identity mismatch.')
  }
  return {
    recipe: parsed,
    codeSnapshot: {
      ref: codeVersion.ref,
      bytes: codeBytes
    }
  }
}

async function verifyPinnedRecipeInputs(
  recipe: ScientificPlotRecipeV1,
  dependencies: ScientificPlottingEngineDependencies
): Promise<void> {
  for (const source of recipe.dataSources) {
    if (source.kind !== 'artifact-version') continue
    await readExactArtifactVersion(source.artifactVersion, dependencies)
  }
}

async function readExactArtifactVersion(
  expected: ArtifactVersionRefV1,
  dependencies: ScientificPlottingEngineDependencies
) {
  const port = dependencies.artifactVersionReadPort
  if (!port) throw new Error('Artifact Versions read capability is unavailable.')
  const result = artifactVersionReadResultV1Schema.parse(await port.read({
    versionId: expected.versionId
  }))
  if (!result.ok) {
    throw new Error(`ArtifactVersion ${expected.versionId} is unavailable: ${result.issue.message}`)
  }
  if (canonicalJson(result.value.ref) !== canonicalJson(expected)) {
    throw new Error(`ArtifactVersion ${expected.versionId} does not match its pinned reference.`)
  }
  return result.value
}

export async function compareScientificPlotVersions(
  request: ScientificPlottingCompareRequest,
  dependencies: ScientificPlottingEngineDependencies = {}
): Promise<ScientificPlottingCompareResult> {
  try {
    await resolveWorkspaceRoot(request.workspaceRoot)
    const [baseline, candidate] = await Promise.all([
      readVersionedScientificPlotManifest(request.baselineManifestVersionRef, dependencies),
      readVersionedScientificPlotManifest(request.candidateManifestVersionRef, dependencies)
    ])
    return {
      ok: true,
      status: 'compared',
      baselineManifestVersionRef: request.baselineManifestVersionRef,
      candidateManifestVersionRef: request.candidateManifestVersionRef,
      comparison: compareScientificPlotManifestValues(baseline, candidate)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace')
        ? 'invalid_workspace'
        : message.includes('ArtifactVersion') || message.includes('Artifact Versions')
          ? 'version_read_failed'
          : 'manifest_read_failed',
      message
    }
  }
}

async function readVersionedScientificPlotManifest(
  manifestRef: ArtifactVersionRefV1,
  dependencies: ScientificPlottingEngineDependencies
): Promise<ScientificPlottingManifest> {
  const manifestVersion = await readExactArtifactVersion(manifestRef, dependencies)
  if (manifestVersion.artifact.kind !== 'scientific-plot-render-manifest') {
    throw new Error(
      `Expected a scientific-plot-render-manifest ArtifactVersion, received ${manifestVersion.artifact.kind}.`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(manifestVersion.dataBase64, 'base64').toString('utf8'))
  } catch (error) {
    throw new Error(
      `Could not parse versioned scientific plot manifest: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const manifest = parseScientificPlottingManifest(parsed)
  if (!manifest) throw new Error('Versioned scientific plot manifest does not match ScientificPlottingManifest v1.')
  if (hashStableJson(manifest.recipe.data) !== manifest.recipe.dataHash) {
    throw new Error('Versioned scientific plot manifest recipe data identity mismatch.')
  }
  const { recipeId, ...recipeContent } = manifest.recipe
  if (recipeId !== `plot-recipe:${hashStableJson(recipeContent)}`) {
    throw new Error('Versioned scientific plot manifest recipe identity mismatch.')
  }

  const recipeDependency = manifestVersion.version.dependencies.find(({ role }) => role === 'recipe')
  const figureDependency = manifestVersion.version.dependencies.find(({ role }) => role === 'figure')
  if (!recipeDependency || !figureDependency) {
    throw new Error('Versioned scientific plot manifest must pin recipe and figure ArtifactVersions.')
  }
  const [recipeVersion, figureVersion] = await Promise.all([
    readExactArtifactVersion(recipeDependency.target, dependencies),
    readExactArtifactVersion(figureDependency.target, dependencies)
  ])
  if (recipeVersion.artifact.kind !== 'scientific-plot-recipe') {
    throw new Error(`Expected a scientific-plot-recipe ArtifactVersion, received ${recipeVersion.artifact.kind}.`)
  }
  if (figureVersion.artifact.kind !== 'scientific-plot') {
    throw new Error(`Expected a scientific-plot ArtifactVersion, received ${figureVersion.artifact.kind}.`)
  }
  const codeDependency = manifestVersion.version.dependencies.find(({ role }) => role === 'code')
  if (manifest.codePath && !codeDependency) {
    throw new Error('Versioned scientific plot manifest with a code copy must pin its code ArtifactVersion.')
  }
  if (codeDependency) {
    const codeVersion = await readExactArtifactVersion(codeDependency.target, dependencies)
    if (codeVersion.artifact.kind !== 'scientific-plot-code') {
      throw new Error(`Expected a scientific-plot-code ArtifactVersion, received ${codeVersion.artifact.kind}.`)
    }
    const codeBytes = Buffer.from(codeVersion.dataBase64, 'base64')
    const codeDigest = createHash('sha256').update(codeBytes).digest('hex')
    if (codeDigest !== codeVersion.ref.contentDigest) {
      throw new Error('Versioned scientific plot code ArtifactVersion digest does not match its snapshot bytes.')
    }
    if (codeDigest !== manifest.recipe.execution.rendererCodeSha256) {
      throw new Error('Versioned scientific plot code does not match the renderer digest recorded in its recipe.')
    }
  }
  if (figureDependency.target.contentDigest !== manifest.outputHash) {
    throw new Error('Versioned scientific plot manifest output identity does not match its pinned Figure version.')
  }
  let pinnedRecipe: unknown
  try {
    pinnedRecipe = JSON.parse(Buffer.from(recipeVersion.dataBase64, 'base64').toString('utf8'))
  } catch (error) {
    throw new Error(
      `Could not parse pinned scientific plot recipe: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!isScientificPlotRecipeV1(pinnedRecipe) || canonicalJson(pinnedRecipe) !== canonicalJson(manifest.recipe)) {
    throw new Error('Versioned scientific plot manifest recipe does not match its pinned Recipe version.')
  }
  return manifest
}

async function readVerifiedScientificPlotManifest(
  workspaceRoot: string,
  manifestPath: string
): Promise<ScientificPlottingManifest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read scientific plot manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  const manifest = parseScientificPlottingManifest(parsed)
  if (!manifest) throw new Error(`Invalid scientific plot manifest: ${manifestPath}`)
  const outputPath = await resolveTargetPathWithinWorkspace(manifest.outputPath, workspaceRoot)
  const actualHash = await hashFile(outputPath)
  if (actualHash !== manifest.outputHash) throw new Error(`Scientific plot output hash mismatch: ${manifestPath}`)
  if (hashStableJson(manifest.recipe.data) !== manifest.recipe.dataHash) {
    throw new Error(`Scientific plot recipe data hash mismatch: ${manifestPath}`)
  }
  const { recipeId, ...recipeContent } = manifest.recipe
  if (recipeId !== `plot-recipe:${hashStableJson(recipeContent)}`) {
    throw new Error(`Scientific plot recipe identity mismatch: ${manifestPath}`)
  }
  const recipePath = await resolveTargetPathWithinWorkspace(manifest.recipePath, workspaceRoot)
  let recipeFile: unknown
  try {
    recipeFile = JSON.parse(await readFile(recipePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read scientific plot recipe: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isScientificPlotRecipeV1(recipeFile) || hashStableJson(recipeFile) !== hashStableJson(manifest.recipe)) {
    throw new Error(`Scientific plot recipe file does not match the render manifest: ${manifestPath}`)
  }
  if (manifest.codePath) {
    const codePath = await resolveTargetPathWithinWorkspace(manifest.codePath, workspaceRoot)
    const actualCodeDigest = await hashFile(codePath)
    if (actualCodeDigest !== manifest.recipe.execution.rendererCodeSha256) {
      throw new Error(`Scientific plot code copy hash mismatch: ${manifestPath}`)
    }
  }
  return manifest
}

function compareScientificPlotManifestValues(
  baseline: Pick<ScientificPlottingManifest, 'outputHash' | 'recipe'>,
  candidate: Pick<ScientificPlottingManifest, 'outputHash' | 'recipe'>
): ScientificPlottingComparison {
  const equality = {
    exactOutput: baseline.outputHash === candidate.outputHash,
    recipeEquivalent: baseline.recipe.recipeId === candidate.recipe.recipeId,
    dataEquivalent: baseline.recipe.dataHash === candidate.recipe.dataHash,
    sourcesEquivalent: hashStableJson(baseline.recipe.dataSources) === hashStableJson(candidate.recipe.dataSources),
    transformationsEquivalent: hashStableJson({
      derivedTables: baseline.recipe.derivedTables,
      transformations: baseline.recipe.transformations
    }) === hashStableJson({
      derivedTables: candidate.recipe.derivedTables,
      transformations: candidate.recipe.transformations
    }),
    statisticsEquivalent: hashStableJson(baseline.recipe.statistics ?? null) === hashStableJson(candidate.recipe.statistics ?? null),
    styleEquivalent: hashStableJson(baseline.recipe.style) === hashStableJson(candidate.recipe.style),
    environmentEquivalent: baseline.recipe.environment.environmentDigest === candidate.recipe.environment.environmentDigest
  }
  const changedSections: ScientificPlottingComparison['changedSections'] = []
  if (!equality.exactOutput) changedSections.push('output')
  if (!equality.recipeEquivalent) changedSections.push('recipe')
  if (!equality.dataEquivalent) changedSections.push('data')
  if (!equality.sourcesEquivalent) changedSections.push('sources')
  if (!equality.transformationsEquivalent) changedSections.push('transformations')
  if (!equality.statisticsEquivalent) changedSections.push('statistics')
  if (!equality.styleEquivalent) changedSections.push('style')
  if (!equality.environmentEquivalent) changedSections.push('environment')
  return { ...equality, changedSections }
}

export async function compositeScientificPlotLayers(
  request: ScientificPlottingCompositeRequest
): Promise<ScientificPlottingCompositeResult> {
  const warnings: string[] = []
  try {
    if (!isControlledPlottingPlan(request.visualPlan) || request.visualPlan.route !== 'hybrid') {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'scientific_plotting_composite requires a route-locked hybrid handoff from visual_generate.',
        warnings
      }
    }
    if (request.layers.length < 2 || request.layers.length > 32) {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'scientific_plotting_composite requires 2-32 layers.',
        warnings
      }
    }
    if (!request.layers.some((layer) => layer.owner === 'model') || !request.layers.some((layer) => layer.owner === 'code')) {
      return {
        ok: false,
        status: 'invalid_request',
        message: 'A hybrid composite requires at least one model-owned layer and one code-owned truth layer.',
        warnings
      }
    }

    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const resolvedLayers = await Promise.all(request.layers.map(async (layer) => {
      const resolvedPath = await resolveOpenTargetPath(layer.path, workspaceRoot, { allowBasenameFallback: false })
      const info = await stat(resolvedPath)
      if (!info.isFile()) throw new Error(`Layer path is not a file: ${layer.path}`)
      const [image, bytes] = await Promise.all([loadImage(resolvedPath), readFile(resolvedPath)])
      return {
        ...layer,
        opacity: layer.owner === 'code' ? 1 : normalizeLayerOpacity(layer.opacity),
        resolvedPath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        image
      }
    }))
    const firstModelLayer = resolvedLayers.find((layer) => layer.owner === 'model')!
    const width = normalizeCompositeDimension(request.canvas?.width ?? firstModelLayer.image.width, 'width')
    const height = normalizeCompositeDimension(request.canvas?.height ?? firstModelLayer.image.height, 'height')
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    if (request.canvas?.background) {
      context.fillStyle = request.canvas.background
      context.fillRect(0, 0, width, height)
    }

    // Model-owned visual layers are always drawn first. Code-owned truth layers
    // are deterministically drawn last at full opacity so the image model can
    // never overwrite labels, data marks, geometry, or other locked content.
    const orderedLayers = [...resolvedLayers].sort((left, right) => (
      (left.owner === 'model' ? 0 : 1) - (right.owner === 'model' ? 0 : 1)
    ))
    for (const layer of orderedLayers) {
      const bounds = compositeLayerBounds(layer, width, height)
      context.save()
      context.globalAlpha = layer.opacity
      drawCompositeLayer(context, layer.image, bounds, layer.fit ?? 'contain')
      context.restore()
    }

    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const figureId = slugForFigureId(request.figureId ?? `hybrid-composite-${new Date().toISOString()}`)
    const outputPath = join(outputDir, `${figureId}.png`)
    await writeFile(outputPath, canvas.toBuffer('image/png'))
    const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
    const publicLayers = orderedLayers.map(({ image: _image, ...layer }) => layer)
    const manifestPath = join(outputDir, `${figureId}.manifest.json`)
    await writeFile(manifestPath, `${JSON.stringify({
      version: 1,
      renderer: 'sciforge-scientific-plotting-mcp',
      rendererVersion: RENDERER_VERSION,
      tool: 'scientific_plotting_composite',
      createdAt: new Date().toISOString(),
      requestHash: hashStableJson(request),
      workspaceRoot,
      outputPath,
      outputHash,
      canvas: { width, height, ...(request.canvas?.background ? { background: request.canvas.background } : {}) },
      visualPlan: request.visualPlan,
      layers: publicLayers,
      ...(request.visualDocumentId ? { visualDocumentId: request.visualDocumentId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      warnings
    }, null, 2)}\n`, 'utf8')
    const artifactManifestPath = await writeScientificCompositeArtifactManifest({
      workspaceRoot,
      figureId,
      outputPath,
      manifestPath,
      request,
      layers: publicLayers
    })
    return {
      ok: true,
      status: 'composed',
      outputPath,
      manifestPath,
      artifactManifestPath,
      layers: publicLayers,
      warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: compositeErrorStatus(message),
      message,
      warnings
    }
  }
}

type CompositeBounds = { x: number; y: number; width: number; height: number }

function normalizeCompositeDimension(value: number, label: 'width' | 'height'): number {
  if (!Number.isInteger(value) || value < MIN_COMPOSITE_SIZE || value > MAX_COMPOSITE_SIZE) {
    throw new Error(`Composite canvas ${label} must be an integer from ${MIN_COMPOSITE_SIZE} to ${MAX_COMPOSITE_SIZE}.`)
  }
  return value
}

function normalizeLayerOpacity(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Layer opacity must be between 0 and 1.')
  return value
}

function compositeLayerBounds(
  layer: ScientificPlottingCompositeLayer,
  canvasWidth: number,
  canvasHeight: number
): CompositeBounds {
  if (!layer.bounds) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  const scaleX = layer.bounds.unit === 'pixel' ? 1 : canvasWidth
  const scaleY = layer.bounds.unit === 'pixel' ? 1 : canvasHeight
  const bounds = {
    x: layer.bounds.x * scaleX,
    y: layer.bounds.y * scaleY,
    width: layer.bounds.width * scaleX,
    height: layer.bounds.height * scaleY
  }
  if (!Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Layer bounds must contain finite coordinates and positive dimensions.')
  }
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > canvasWidth || bounds.y + bounds.height > canvasHeight) {
    throw new Error('Layer bounds must stay within the composite canvas.')
  }
  return bounds
}

function drawCompositeLayer(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: CompositeBounds,
  fit: NonNullable<ScientificPlottingCompositeLayer['fit']>
): void {
  if (fit === 'stretch') {
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height)
    return
  }
  const scale = fit === 'cover'
    ? Math.max(bounds.width / image.width, bounds.height / image.height)
    : Math.min(bounds.width / image.width, bounds.height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const drawX = bounds.x + (bounds.width - drawWidth) / 2
  const drawY = bounds.y + (bounds.height - drawHeight) / 2
  context.save()
  context.beginPath()
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.clip()
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  context.restore()
}

function compositeErrorStatus(
  message: string
): Extract<ScientificPlottingCompositeResult, { ok: false }>['status'] {
  if (/workspace|stay within|file not found|not a file/i.test(message)) return 'invalid_workspace'
  if (/image|unsupported image|decode/i.test(message)) return 'image_unreadable'
  if (/write|permission|read-only|no space/i.test(message)) return 'write_failed'
  return 'invalid_request'
}

function isControlledPlottingPlan(value: ScientificPlottingRenderRequest['visualPlan'] | undefined): boolean {
  const sceneOwners = new Set(value?.scene?.layers.map((layer) => layer.owner) ?? [])
  return Boolean(
    value
    && typeof value.planId === 'string'
    && value.planId.trim()
    && value.routeLocked === true
    && value.fallbackPolicy === 'fail_closed'
    && (value.route === 'code' || value.route === 'hybrid')
    && Array.isArray(value.sourceArtifacts)
    && Array.isArray(value.reproducibleInputs)
    && (value.reproducibleInputs.length > 0 || Boolean(value.inlineSpecification?.trim()) || Boolean(value.scene))
    && Array.isArray(value.lockedElements)
    && (value.lockedElements.length > 0 || sceneOwners.has('code'))
    && Array.isArray(value.modelOwnedElements)
    && (value.route !== 'hybrid' || value.modelOwnedElements.length > 0 || sceneOwners.has('model'))
    && (value.contextStatus === 'ready' || value.contextStatus === 'budget_exhausted')
    && Array.isArray(value.contextEvidenceIds)
    && Array.isArray(value.unresolvedContext)
    && (value.releaseCeiling === 'publication_ready' || value.releaseCeiling === 'draft_ready')
  )
}

async function renderAttempt(input: {
  request: ScientificPlottingRenderRequest
  workspaceRoot: string
  styleSpec: FigureStyleSpec
  matplotlib: ScientificPlotMatplotlibParametersV1
  outputPath: string
  codePath: string
}): Promise<{ ok: true; rendererDiagnostics?: RendererDiagnostics } | { ok: false; error: ScientificPlottingRenderResult }> {
  const payload: RenderPayload = {
    template: input.request.template,
    data: input.request.data,
    labels: input.request.labels ?? {},
    outputPath: input.outputPath,
    styleSpec: input.styleSpec,
    rcParams: input.matplotlib.rcParams,
    palette: input.matplotlib.palette,
    ...(input.matplotlib.heatmapCmap?.kind === 'named'
      ? { heatmapCmapName: input.matplotlib.heatmapCmap.name }
      : input.matplotlib.heatmapCmap?.kind === 'linear-segmented'
        ? { heatmapCmapColors: input.matplotlib.heatmapCmap.colors }
        : {})
  }
  const run = await runPythonRenderer(payload, input.workspaceRoot, input.codePath)
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
    const schematicPrimitiveCount = typeof diagnostics.schematicPrimitiveCount === 'number' &&
      Number.isInteger(diagnostics.schematicPrimitiveCount) &&
      diagnostics.schematicPrimitiveCount >= 0
      ? diagnostics.schematicPrimitiveCount
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
        ...(schematicPrimitiveCount !== undefined ? { schematicPrimitiveCount } : {}),
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
  plotVersionId: string
  outputPath: string
  manifestPath: string
  recipePath: string
  codePath?: string
  recipe: ScientificPlotRecipeV1
  request: ScientificPlottingRenderRequest
  review?: ScientificPlottingReviewResult
  versionCommit?: ScientificPlotVersionCommitReceipt
}): Promise<string> {
  const artifactsDir = join(input.workspaceRoot, '.sciforge', 'artifacts', input.figureId, 'versions')
  await mkdir(artifactsDir, { recursive: true })
  const artifactManifestPath = join(artifactsDir, `${input.plotVersionId}.scientific-plot.artifact.json`)
  const artifactManifest = {
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: 'scientific_plotting',
    artifactKind: 'scientific_plot',
    operationId: input.request.operationId,
    plotVersionId: input.plotVersionId,
    path: input.outputPath,
    outputPath: input.outputPath,
    outputHash: createHash('sha256').update(await readFile(input.outputPath)).digest('hex'),
    manifestPath: input.manifestPath,
    recipePath: input.recipePath,
    ...(input.codePath ? { codePath: input.codePath } : {}),
    recipe: input.recipe,
    visualPlan: input.request.visualPlan,
    ...(input.versionCommit ? { versionCommit: input.versionCommit } : {}),
    ...(input.request.visualDocumentId ? { visualDocumentId: input.request.visualDocumentId } : {}),
    ...(input.request.runtimeId ? { runtimeId: input.request.runtimeId } : {}),
    ...(input.request.threadId ? { threadId: input.request.threadId } : {}),
    ...(input.request.outputScale ? { outputScale: normalizeOutputScale(input.request.outputScale) } : {}),
    ...(input.request.styleSpecPath ? { styleSpecPath: input.request.styleSpecPath } : {}),
    ...(input.request.referencePath || input.request.reviewReferencePath
      ? { referencePath: input.request.reviewReferencePath ?? input.request.referencePath }
      : {}),
    title: input.request.labels?.title ?? input.request.figureId ?? input.figureId,
    ...(input.review?.ok ? { styleSimilarity: input.review.metric } : {})
  }
  await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8')
  return artifactManifestPath
}

async function writeScientificCompositeArtifactManifest(input: {
  workspaceRoot: string
  figureId: string
  outputPath: string
  manifestPath: string
  request: ScientificPlottingCompositeRequest
  layers: Array<ScientificPlottingCompositeLayer & { resolvedPath: string; sha256: string }>
}): Promise<string> {
  const artifactsDir = join(input.workspaceRoot, '.sciforge', 'artifacts')
  await mkdir(artifactsDir, { recursive: true })
  const artifactManifestPath = join(artifactsDir, `${input.figureId}.scientific-composite.artifact.json`)
  await writeFile(artifactManifestPath, `${JSON.stringify({
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: 'scientific_plotting',
    artifactKind: 'scientific_composite',
    path: input.outputPath,
    outputPath: input.outputPath,
    outputHash: createHash('sha256').update(await readFile(input.outputPath)).digest('hex'),
    manifestPath: input.manifestPath,
    visualPlan: input.request.visualPlan,
    sourceLayers: input.layers,
    ...(input.request.visualDocumentId ? { visualDocumentId: input.request.visualDocumentId } : {}),
    ...(input.request.threadId ? { threadId: input.request.threadId } : {}),
    title: input.request.figureId ?? input.figureId
  }, null, 2)}\n`, 'utf8')
  return artifactManifestPath
}

function parseScientificPlottingManifest(value: unknown): ScientificPlottingManifest | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (value.renderer !== 'sciforge-scientific-plotting-mcp') return null
  if (value.tool !== 'scientific_plotting_render') return null
  if (!SCIENTIFIC_PLOTTING_TEMPLATES.includes(value.template as ScientificPlottingTemplate)) return null
  if (typeof value.outputPath !== 'string' || !value.outputPath.trim()) return null
  if (typeof value.outputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.outputHash)) return null
  if (
    value.operationId !== undefined
    && !scientificPlottingOperationIdSchema.safeParse(value.operationId).success
  ) return null
  if (typeof value.plotVersionId !== 'string' || !value.plotVersionId.trim()) return null
  if (typeof value.recipePath !== 'string' || !value.recipePath.trim()) return null
  if (!isScientificPlotRecipeV1(value.recipe)) return null
  if (!isControlledPlottingPlan(value.visualPlan as ScientificPlottingRenderRequest['visualPlan'] | undefined)) return null
  if (!Array.isArray(value.attempts)) return null
  return value as ScientificPlottingManifest
}

function isScientificPlotRecipeV1(value: unknown): value is ScientificPlotRecipeV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) return false
  if (typeof value.recipeId !== 'string' || !value.recipeId.startsWith('plot-recipe:')) return false
  if (!SCIENTIFIC_PLOTTING_TEMPLATES.includes(value.template as ScientificPlottingTemplate)) return false
  if (typeof value.dataHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.dataHash)) return false
  if (!Array.isArray(value.dataSources) || !Array.isArray(value.derivedTables) || !Array.isArray(value.transformations)) return false
  if (!isRecord(value.environment) || !isRecord(value.execution) || !isRecord(value.style) || !isRecord(value.render)) return false
  if (value.render.matplotlib !== undefined && !isScientificPlotMatplotlibParametersV1(value.render.matplotlib)) return false
  return true
}

function buildReviewPacketItem(input: {
  manifestPath: string
  outputPath: string
  manifest: ScientificPlottingManifest
}): ScientificPlottingReviewPacketItem {
  const lastAttempt = input.manifest.attempts.at(-1)
  const review = okReview(input.manifest.finalReview) || okReview(lastAttempt?.review)
  const styleSimilarity = review?.metric
  const status = inferManifestRenderStatus(input.manifest)
  const layoutQuality = lastAttempt?.rendererDiagnostics?.layoutQuality
  const typography = lastAttempt?.rendererDiagnostics?.typography
  const warnings = uniqueReviewStrings([
    ...stringItems(input.manifest.warnings),
    ...stringItems(styleSimilarity?.warnings),
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
    ...(styleSimilarity ? { styleSimilarity } : {}),
    styleRepairSuggested: review?.repairSuggestion.shouldRerender === true,
    repairAttempted,
    attempts: input.manifest.attempts.length,
    warnings,
    ...(layoutQuality ? { layoutQuality } : {}),
    ...(typography ? { typography } : {}),
    notes,
    recommendedActions: buildReviewPacketRecommendedActions({
      status,
      styleSimilarity,
      styleRepairSuggested: review?.repairSuggestion.shouldRerender === true,
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
    .map((item) => item.styleSimilarity?.overall)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
  const total = scores.reduce((sum, score) => sum + score, 0)
  const needsAttention = items.filter((item) => reviewPacketItemNeedsAttention(item)).length
  return {
    rendered: items.filter((item) => item.status === 'rendered').length,
    repaired: items.filter((item) => item.status === 'repaired').length,
    reviewFailed: items.filter((item) => item.status === 'review_failed').length,
    needsAttention,
    styleRepairSuggested: items.filter((item) => item.styleRepairSuggested).length,
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
    if (item.styleSimilarity) {
      lines.push(`- Style similarity: overall ${formatScore(item.styleSimilarity.overall)}, palette ${formatScore(item.styleSimilarity.palette)}, axes ${formatScore(item.styleSimilarity.axes)}, grid ${formatScore(item.styleSimilarity.grid)}, layout ${formatScore(item.styleSimilarity.layout)}, marks ${formatScore(item.styleSimilarity.marks)}, typography ${formatScore(item.styleSimilarity.typography)}`)
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

function okReview(review: unknown): Extract<VisualStyleReviewResult, { ok: true }> | undefined {
  return isRecord(review) && review.ok === true && isRecord(review.metric)
    ? review as Extract<VisualStyleReviewResult, { ok: true }>
    : undefined
}

function reviewPacketItemNeedsAttention(item: ScientificPlottingReviewPacketItem): boolean {
  if (item.status === 'review_failed') return true
  if (item.styleRepairSuggested) return true
  if (item.styleSimilarity && item.styleSimilarity.overall < 0.72) return true
  if (item.layoutQuality?.legendOverlapRisk === 'medium' || item.layoutQuality?.legendOverlapRisk === 'high') return true
  if (item.layoutQuality?.textOverflowRisk === 'medium' || item.layoutQuality?.textOverflowRisk === 'high') return true
  return item.warnings.length > 0
}

function buildReviewPacketRecommendedActions(input: {
  status: ScientificPlottingReviewPacketItem['status']
  styleSimilarity?: VisualStyleSimilarityMetric
  styleRepairSuggested: boolean
  repairAttempted: boolean
  layoutQuality?: ScientificPlottingReviewPacketItem['layoutQuality']
  warnings: string[]
}): string[] {
  const actions: string[] = []
  if (!input.styleSimilarity) {
    actions.push('Use image_generation_review_candidate with the task, truth locks, and reference image before staging or releasing this generated candidate.')
  } else {
    if (input.styleSimilarity.overall < 0.72) {
      actions.push('Inspect reference similarity before acceptance; style match is currently weak.')
    }
    if (input.styleSimilarity.palette < 0.72) {
      actions.push('Tune palette mapping or use a closer StyleSpec palette.')
    }
    if (input.styleSimilarity.axes < 0.72 || input.styleSimilarity.grid < 0.72) {
      actions.push('Compare axes, spine, and grid visibility against the reference.')
    }
    if ((input.styleSimilarity.typography ?? 1) < 0.72) {
      actions.push('Review typography weight and label density at final figure size.')
    }
  }
  if (input.status === 'review_failed') {
    actions.push('Repair the missing or invalid review reference before relying on the score.')
  }
  if (input.styleRepairSuggested) {
    actions.push('Allow one bounded style repair or inspect the repair history before final approval.')
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
    MATPLOTLIB_PROBE_TIMEOUT_MS
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

async function runPythonRenderer(payload: RenderPayload, workspaceRoot: string, codePath: string): Promise<PythonRunResult> {
  return runPython([codePath], JSON.stringify(payload), workspaceRoot, RENDER_TIMEOUT_MS)
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
      ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
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
    const extracted = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: request.referencePath,
      sourceType: 'image',
      figureId: 'scientific-plotting-plan-reference'
    })
    if (!extracted.ok) {
      warnings.push(`Could not inspect referencePath: ${extracted.message}`)
      return undefined
    }
    return figureStyleSpecFromVisualStyleProfile(extracted.profile)
  }
  return undefined
}

async function inferReferenceProfileFromReferencePath(
  request: ScientificPlottingReviewRequest
): Promise<ScientificPlottingReferenceProfile | undefined> {
  const extracted = await extractVisualStyleProfile({
    workspaceRoot: request.workspaceRoot,
    sourcePath: request.referencePath,
    sourceType: 'image',
    figureId: 'scientific-plotting-review-reference'
  })
  if (!extracted.ok) return undefined
  return inferReferenceProfileFromStyle(figureStyleSpecFromVisualStyleProfile(extracted.profile), {})
}

function decorateReviewWithPlottingContext(
  review: VisualStyleReviewResult,
  template: ScientificPlottingTemplate,
  referenceProfile: ScientificPlottingReferenceProfile | undefined
): ScientificPlottingReviewResult {
  if (!review.ok) return review
  const templateAdvice = buildTemplateAdvice(template, referenceProfile, review.metric)
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

function requiredInputsForFigureNeed(
  primaryNeed: ScientificFigureNeed
): string[] {
  if (primaryNeed === 'quantitative_chart') return ['structured data or tabular rows', 'x/y labels', 'main comparison or trend']
  if (primaryNeed === 'statistical_comparison') return ['raw values or summary plus uncertainty', 'groups/conditions', 'statistical claim to show']
  if (primaryNeed === 'heatmap_matrix') return ['numeric matrix', 'row/column labels', 'normalization or color scale meaning']
  if (primaryNeed === 'multi_panel_figure') return ['panel list', 'per-panel evidence/data', 'shared conclusion and panel order']
  if (primaryNeed === 'image_panel') return ['image paths or panel descriptions', 'annotation targets', 'scale/crop requirements']
  return ['figure conclusion', 'key entities/nodes', 'causal or temporal relationships', 'preferred paper/venue style']
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

function buildTemplateAdvice(
  selectedTemplate: ScientificPlottingTemplate | undefined,
  referenceProfile: ScientificPlottingReferenceProfile | undefined,
  score: VisualStyleSimilarityMetric | undefined
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
    nextActions.push(`Invoke capability scientific-plotting.render with template=${referenceProfile.recommendedTemplate} before manual style tuning.`)
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

function resolveMatplotlibRenderParameters(
  request: ScientificPlottingRenderRequest,
  styleSpec: FigureStyleSpec,
  rcParamsPatch: Record<string, string | number | boolean> = {},
  paletteOverride?: string[]
): ScientificPlotMatplotlibParametersV1 {
  if (request.matplotlib) {
    return canonicalClone(request.matplotlib) as ScientificPlotMatplotlibParametersV1
  }
  const styleAdapter = buildMatplotlibStyleAdapterFromFigureStyleSpec(styleSpec)
  const palette = paletteOverride?.length
    ? [...paletteOverride]
    : styleAdapter.palette.length
      ? [...styleAdapter.palette]
      : ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000']
  const rcParams = enforceReadableTextColors(enforcePublicationTypography({
    ...styleAdapter.rcParams,
    ...rcParamsPatch
  }))
  return {
    schemaVersion: 1,
    rcParams,
    palette,
    ...resolveHeatmapCmap({
      template: request.template,
      data: request.data,
      styleSpec,
      palette,
      useStylePalette: Boolean(
        request.styleSpec
        || request.styleSpecPath
        || request.referencePath
        || request.reviewReferencePath
      )
    })
  }
}

function resolveLegacyMatplotlibRenderParameters(
  recipe: ScientificPlotRecipeV1
): ScientificPlotMatplotlibParametersV1 {
  const styleAdapter = buildMatplotlibStyleAdapterFromFigureStyleSpec(recipe.style.resolvedSpec)
  const palette = styleAdapter.palette.length
    ? [...styleAdapter.palette]
    : ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000']
  const sourcePath = recipe.style.resolvedSpec.source?.path
  const likelyInlineStyle = !recipe.style.styleProfileId
    && !recipe.style.styleSpecPath
    && sourcePath !== undefined
    && sourcePath !== 'sciforge-default'
  return {
    schemaVersion: 1,
    rcParams: enforceReadableTextColors(enforcePublicationTypography(styleAdapter.rcParams)),
    palette,
    ...resolveHeatmapCmap({
      template: recipe.template,
      data: recipe.data,
      styleSpec: recipe.style.resolvedSpec,
      palette,
      // Older recipes did not retain the inline-style bit. The source marker
      // recovers the common case while default/profile renders keep their
      // historical named colormap behavior.
      useStylePalette: Boolean(recipe.style.styleSpecPath || recipe.style.referencePath || likelyInlineStyle)
    })
  }
}

function resolveHeatmapCmap(input: {
  template: ScientificPlottingTemplate
  data: unknown
  styleSpec: FigureStyleSpec
  palette: string[]
  useStylePalette: boolean
}): { heatmapCmap?: NonNullable<ScientificPlotMatplotlibParametersV1['heatmapCmap']> } {
  if (input.template !== 'heatmap' && input.template !== 'attention-map') return {}
  const data = isRecord(input.data) ? input.data : {}
  const requestedCmap = typeof data.cmap === 'string' && data.cmap.trim()
    ? data.cmap.trim()
    : input.template === 'attention-map'
      ? 'magma'
      : 'cividis'
  if (!input.useStylePalette || !['viridis', 'cividis', 'plasma', 'magma'].includes(requestedCmap.toLowerCase())) {
    return { heatmapCmap: { kind: 'named', name: requestedCmap } }
  }
  const background = input.styleSpec.canvas.background
  const accents = uniqueHexStrings(input.palette)
    .filter((color) => color.toLowerCase() !== background.toLowerCase())
    .filter((color) => hexDistance(color, background) > 34)
    .slice(0, 5)
  if (accents.length === 0) return { heatmapCmap: { kind: 'named', name: requestedCmap } }
  const colors = hexLuminance(background) < 88
    ? uniqueHexStrings([background, ...accents])
    : uniqueHexStrings(['#ffffff', ...accents])
  return colors.length >= 2
    ? {
        heatmapCmap: {
          kind: 'linear-segmented',
          name: input.template === 'attention-map' ? 'sciforge_attention_map' : 'sciforge_style_heatmap',
          colors
        }
      }
    : { heatmapCmap: { kind: 'named', name: requestedCmap } }
}

function buildDataMappingCandidates(
  data: unknown,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
    templateHint?: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
    reproducibilityMode: 'standard' | 'reproducible'
    statistics?: StatisticalDefinitionV1
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
    reproducibilityMode?: 'standard' | 'reproducible'
    statistics?: StatisticalDefinitionV1
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
  const inferredUncertainty = errorKey
    ? { kind: uncertaintyKindForColumn(errorKey), sourceColumn: errorKey }
    : undefined
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
        ...(bar.aggregationApplied ? { aggregationApplied: bar.aggregationApplied } : {}),
        ...(inferredUncertainty ? { inferredUncertainty } : {}),
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
): {
  data: { categories: string[]; series: Array<{ name?: string; values: number[]; error?: number[] }> }
  seriesCount: number
  categoryCount: number
  warnings: string[]
  aggregationApplied?: { method: 'mean'; groupBy: string[] }
} | null {
  const warnings: string[] = []
  let aggregated = false
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
      if (finite.length > 1) {
        aggregated = true
        warnings.push(`Averaged ${finite.length} rows for ${seriesName}/${category}; this aggregation must be declared for reproducible rendering.`)
      }
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
    warnings: uniqueStrings(warnings).slice(0, 8),
    ...(aggregated ? {
      aggregationApplied: {
        method: 'mean' as const,
        groupBy: input.seriesKey ? [input.seriesKey, input.categoryKey] : [input.categoryKey]
      }
    } : {})
  }
}

function uncertaintyKindForColumn(column: string): 'sd' | 'sem' | 'ci' | 'ambiguous' {
  const normalized = column.trim().toLowerCase()
  if (/^(sd|std|standard[_\s-]?deviation)$/.test(normalized)) return 'sd'
  if (/^(sem|stderr|standard[_\s-]?error)$/.test(normalized)) return 'sem'
  if (/^(ci|confidence[_\s-]?interval)$/.test(normalized)) return 'ci'
  return 'ambiguous'
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

function declaresAggregation(
  statistics: StatisticalDefinitionV1 | undefined,
  applied: NonNullable<DataMappingCandidate['aggregationApplied']>
): boolean {
  if (statistics?.aggregation?.method !== applied.method) return false
  const declared = new Set(statistics.aggregation.groupBy.map((item) => item.trim()).filter(Boolean))
  const actual = new Set(applied.groupBy)
  return declared.size === actual.size && [...actual].every((item) => declared.has(item))
}

function inlineDataSourceRef(sha256: string, locator: string): DataSourceRef {
  return {
    schemaVersion: 1,
    sourceId: `inline-${sha256.slice(0, 16)}`,
    kind: 'inline',
    locator: `inline:${locator}`,
    sha256,
    mediaType: 'application/json'
  }
}

function buildMappingTransformation(input: {
  inputHash: string
  outputHash: string
  selected: DataMappingCandidate
  selectedBy: 'templateHint' | 'dataShape' | 'task' | 'referenceProfile'
}): ScientificPlotTransformationV1 {
  const kind: ScientificPlotTransformationV1['kind'] = input.selected.aggregationApplied
    ? 'group-aggregate'
    : input.selected.inputShape === 'tabular'
      ? 'tabular-map'
      : input.selected.inputShape === 'matrix'
        ? 'matrix-map'
        : input.selected.inputShape === 'vector'
          ? 'vector-map'
          : input.selected.inputShape === 'network'
            ? 'scene-map'
            : 'identity'
  const parameters = {
    template: input.selected.template,
    selectedBy: input.selectedBy,
    reasons: input.selected.reasons,
    ...(input.selected.aggregationApplied ? { aggregation: input.selected.aggregationApplied } : {})
  }
  return {
    schemaVersion: 1,
    transformationId: `transform-${hashStableJson({
      kind,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      parameters
    }).slice(0, 20)}`,
    kind,
    description: input.selected.aggregationApplied
      ? `Map tabular data to ${input.selected.template} and apply the explicitly declared group aggregation.`
      : `Map input data to the controlled ${input.selected.template} schema.`,
    parameters,
    inputHash: input.inputHash,
    outputHash: input.outputHash
  }
}

function buildDerivedTableReceipt(input: {
  selected: DataMappingCandidate
  sourceIds: string[]
  transformation: ScientificPlotTransformationV1
}): DerivedTableReceipt {
  const summary = input.selected.summary
  return {
    schemaVersion: 1,
    receiptId: `derived-${hashStableJson({
      sources: input.sourceIds,
      transformationId: input.transformation.transformationId
    }).slice(0, 20)}`,
    inputSourceIds: input.sourceIds,
    operation: input.transformation.kind,
    inputHash: input.transformation.inputHash,
    outputHash: input.transformation.outputHash,
    transformationIds: [input.transformation.transformationId],
    ...(summary.rowCount !== undefined ? { rowCount: summary.rowCount } : {}),
    ...(summary.columnCount !== undefined ? { columnCount: summary.columnCount } : {}),
    ...(summary.numericColumns || summary.categoricalColumns
      ? { columns: uniqueStrings([...(summary.numericColumns ?? []), ...(summary.categoricalColumns ?? [])]) }
      : {}),
    warnings: [...input.selected.warnings]
  }
}

function inferredStatisticsForCandidate(candidate: DataMappingCandidate): StatisticalDefinitionV1 | undefined {
  const statisticalTemplate = candidate.template === 'box-violin'
    || candidate.template === 'histogram-density'
    || candidate.template === 'errorbar-bar'
  if (!statisticalTemplate && !candidate.aggregationApplied && !candidate.inferredUncertainty) return undefined
  const estimator: StatisticalDefinitionV1['estimator'] = candidate.template === 'histogram-density'
    ? 'density'
    : candidate.aggregationApplied
      ? 'mean'
      : 'raw'
  return {
    schemaVersion: 1,
    estimator,
    ...(candidate.aggregationApplied ? {
      aggregation: {
        method: candidate.aggregationApplied.method,
        groupBy: [...candidate.aggregationApplied.groupBy]
      }
    } : {}),
    ...(candidate.inferredUncertainty?.kind && candidate.inferredUncertainty.kind !== 'ambiguous' ? {
      uncertainty: {
        kind: candidate.inferredUncertainty.kind,
        sourceColumn: candidate.inferredUncertainty.sourceColumn,
        suppliedBy: 'source' as const
      }
    } : {}),
    missingValues: 'reject',
    notes: ['Inferred from the controlled data mapping; provide an explicit definition to override.']
  }
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
  if (request.matplotlib && !isScientificPlotMatplotlibParametersV1(request.matplotlib)) {
    throw new Error('matplotlib must contain finite rcParams, a non-empty palette, and a valid heatmap cmap.')
  }
  if (request.matplotlib) validatePinnedMatplotlibForTemplate(request.template, request.matplotlib)
  normalizeOutputScale(request.outputScale)
}

function validatePinnedMatplotlibForTemplate(
  template: ScientificPlottingTemplate,
  matplotlib: ScientificPlotMatplotlibParametersV1
): void {
  const isHeatmap = template === 'heatmap' || template === 'attention-map'
  if (isHeatmap && !matplotlib.heatmapCmap) {
    throw new Error(`Pinned Matplotlib parameters for ${template} require heatmapCmap.`)
  }
  if (!isHeatmap && matplotlib.heatmapCmap) {
    throw new Error(`Pinned Matplotlib parameters for ${template} cannot declare heatmapCmap.`)
  }
  if (matplotlib.heatmapCmap?.kind === 'linear-segmented') {
    const expected = template === 'attention-map' ? 'sciforge_attention_map' : 'sciforge_style_heatmap'
    if (matplotlib.heatmapCmap.name !== expected) {
      throw new Error(`Pinned Matplotlib heatmap cmap name must be ${expected} for ${template}.`)
    }
  }
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
    const nodes = data.nodes === undefined ? [] : data.nodes
    const primitives = template === 'schematic-grid' && data.primitives !== undefined
      ? data.primitives
      : []
    const maxNodes = template === 'flowchart' ? MAX_FLOWCHART_NODES : MAX_SCHEMATIC_NODES
    if (!Array.isArray(nodes) || nodes.length > maxNodes) {
      throw new Error(`${template} data.nodes must be an array with at most ${maxNodes} entries for the locked code route.`)
    }
    if (template === 'flowchart' && nodes.length === 0) {
      throw new Error(`flowchart data.nodes must include 1-${MAX_FLOWCHART_NODES} compact nodes for the locked code route.`)
    }
    if (template === 'schematic-grid') {
      if (!Array.isArray(primitives) || primitives.length > MAX_SCHEMATIC_PRIMITIVES) {
        throw new Error(`schematic-grid data.primitives must be an array with at most ${MAX_SCHEMATIC_PRIMITIVES} entries.`)
      }
      if (nodes.length === 0 && primitives.length === 0) {
        throw new Error('schematic-grid requires at least one node or vector primitive.')
      }
      validateSchematicPrimitives(primitives)
    }
    const labels: string[] = []
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) {
        throw new Error(`${template} nodes must include labels.`)
      }
      labels.push(node.label.trim())
    }
    if (template === 'flowchart' && labels.join(' ').length > MAX_FLOWCHART_LABEL_CHARS) {
      throw new Error(`flowchart node labels must be compact and total at most ${MAX_FLOWCHART_LABEL_CHARS} characters for the locked code route.`)
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

function validateSchematicPrimitives(primitives: unknown[]): void {
  const shapes = new Set(['circle', 'ellipse', 'rectangle', 'rect', 'triangle', 'polygon'])
  const linear = new Set(['line', 'arrow'])
  const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
  for (const primitive of primitives) {
    if (!isRecord(primitive)) throw new Error('schematic-grid primitives must be objects.')
    const type = typeof primitive.type === 'string'
      ? primitive.type.trim().toLowerCase()
      : typeof primitive.kind === 'string'
        ? primitive.kind.trim().toLowerCase()
        : ''
    if (type === 'text') {
      if (typeof primitive.text !== 'string' || !finite(primitive.x) || !finite(primitive.y)) {
        throw new Error('Text primitives require text and finite x/y coordinates.')
      }
      continue
    }
    if (linear.has(type)) {
      if (![primitive.x1, primitive.y1, primitive.x2, primitive.y2].every(finite)) {
        throw new Error(`${type} primitives require finite x1/y1/x2/y2 coordinates.`)
      }
      continue
    }
    if (!shapes.has(type) || !finite(primitive.x) || !finite(primitive.y)) {
      throw new Error('Shape primitives require a supported type and finite x/y coordinates.')
    }
    if (type === 'polygon') {
      if (!Array.isArray(primitive.points) || primitive.points.length < 3 || primitive.points.length > 256) {
        throw new Error('Polygon primitives require 3-256 points.')
      }
      if (!primitive.points.every((point) => isRecord(point) && finite(point.x) && finite(point.y))) {
        throw new Error('Polygon primitive points require finite x/y coordinates.')
      }
      continue
    }
    const hasPositiveSize = [primitive.radius, primitive.diameter, primitive.width, primitive.w]
      .some((value) => finite(value) && Number(value) > 0)
    if (!hasPositiveSize) {
      throw new Error(`${type} primitives require a positive radius, diameter, width, or w value.`)
    }
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
    const extracted = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: request.referencePath,
      sourceType: 'image',
      figureId: 'scientific-plotting-style-profile-reference'
    })
    if (!extracted.ok) {
      warnings.push(`Could not inspect referencePath for profile matching: ${extracted.message}`)
      return undefined
    }
    return figureStyleSpecFromVisualStyleProfile(extracted.profile)
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

function isScientificPlotMatplotlibParametersV1(
  value: unknown
): value is ScientificPlotMatplotlibParametersV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.rcParams)) return false
  if (!Object.entries(value.rcParams).every(([key, item]) =>
    key.trim().length > 0
    && (typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
  )) return false
  if (!isStringArray(value.palette, 1, 256)) return false
  if (value.heatmapCmap === undefined) return true
  if (!isRecord(value.heatmapCmap)) return false
  if (value.heatmapCmap.kind === 'named') {
    return typeof value.heatmapCmap.name === 'string' && value.heatmapCmap.name.trim().length > 0
  }
  return value.heatmapCmap.kind === 'linear-segmented'
    && (value.heatmapCmap.name === 'sciforge_style_heatmap' || value.heatmapCmap.name === 'sciforge_attention_map')
    && isStringArray(value.heatmapCmap.colors, 2, 256)
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

function validateReproducibleStatisticalClaims(request: ScientificPlottingRenderRequest): void {
  if ((request.reproducibilityMode ?? 'standard') !== 'reproducible') return
  if (!request.dataSources?.length) {
    throw new Error('reproducible mode requires at least one content-bound dataSources entry.')
  }
  const statisticsRequired = request.template === 'box-violin'
    || request.template === 'histogram-density'
    || request.template === 'errorbar-bar'
    || dataContainsErrorBars(request.data)
    || collectRenderedComparisons(request.data).length > 0
  if (statisticsRequired && !request.statistics) {
    throw new Error(`reproducible ${request.template} rendering requires statistics.`)
  }
  if (dataContainsErrorBars(request.data) && !request.statistics?.uncertainty) {
    throw new Error('reproducible error bars require statistics.uncertainty.kind=sd|sem|ci.')
  }
  if (request.statistics?.uncertainty?.kind === 'ci') {
    const level = request.statistics.uncertainty.confidenceLevel
    if (level === undefined || !Number.isFinite(level) || level <= 0 || level >= 1) {
      throw new Error('CI uncertainty requires a confidenceLevel between 0 and 1.')
    }
  }
  const renderedComparisons = collectRenderedComparisons(request.data)
  for (const comparison of renderedComparisons) {
    if (!isSignificanceLabel(comparison.label)) continue
    const definition = request.statistics?.comparisons?.find((candidate) => {
      const expected = new Set(candidate.groups.map(normalizeComparisonGroup))
      return expected.has(normalizeComparisonGroup(comparison.from))
        && expected.has(normalizeComparisonGroup(comparison.to))
    })
    if (!definition?.resultRef) {
      throw new Error(`Significance label ${comparison.label} for ${comparison.from}/${comparison.to} requires a statistics.comparisons resultRef.`)
    }
    const resultSource = request.dataSources.find((source) => source.sourceId === definition.resultRef.sourceId)
    if (!resultSource) {
      throw new Error(`Statistical result source ${definition.resultRef.sourceId} is not declared in dataSources.`)
    }
    if (resultSource.sha256 !== definition.resultRef.sha256) {
      throw new Error(`Statistical result ${definition.resultRef.sourceId} digest does not match its declared data source.`)
    }
    if (resultSource.locator !== definition.resultRef.locator) {
      throw new Error(`Statistical result ${definition.resultRef.sourceId} locator does not match its declared data source.`)
    }
  }
}

function dataContainsErrorBars(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (Array.isArray(data.series) && data.series.some((series) => (
    isRecord(series) && (Array.isArray(series.error) || Array.isArray(series.xerr) || Array.isArray(series.yerr))
  ))) return true
  if (Array.isArray(data.panels)) {
    return data.panels.some((panel) => isRecord(panel) && dataContainsErrorBars(panel.data))
  }
  return false
}

function collectRenderedComparisons(data: unknown): Array<{ from: string; to: string; label: string }> {
  if (!isRecord(data)) return []
  const comparisons = Array.isArray(data.comparisons)
    ? data.comparisons.flatMap((value) => {
        if (!isRecord(value)) return []
        const from = comparisonGroupValue(value.from ?? value.a ?? value.left ?? value.groupA)
        const to = comparisonGroupValue(value.to ?? value.b ?? value.right ?? value.groupB)
        const label = typeof (value.label ?? value.text ?? value.p) === 'string'
          ? String(value.label ?? value.text ?? value.p).trim()
          : ''
        return from && to ? [{ from, to, label }] : []
      })
    : []
  if (!Array.isArray(data.panels)) return comparisons
  return [
    ...comparisons,
    ...data.panels.flatMap((panel) => isRecord(panel) ? collectRenderedComparisons(panel.data) : [])
  ]
}

function comparisonGroupValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function normalizeComparisonGroup(value: string): string {
  return value.trim().toLowerCase()
}

function isSignificanceLabel(value: string): boolean {
  return /\*|\bp\s*(?:[<=>]|≤|≥)|significant/i.test(value)
}

async function resolveAndVerifyDataSourceRefs(
  request: ScientificPlottingRenderRequest,
  workspaceRoot: string
): Promise<DataSourceRef[]> {
  const requested = request.dataSources?.length
    ? request.dataSources
    : [inlineDataSourceRef(hashStableJson(request.data), 'scientific-plotting.render.data')]
  const seen = new Set<string>()
  const resolved: DataSourceRef[] = []
  for (const source of requested) {
    if (source.schemaVersion !== 1 || !source.sourceId.trim()) throw new Error('DataSourceRef v1 requires sourceId.')
    if (seen.has(source.sourceId)) throw new Error(`Duplicate data source id: ${source.sourceId}`)
    seen.add(source.sourceId)
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error(`Data source ${source.sourceId} requires a lowercase SHA-256 digest.`)
    if (source.kind === 'artifact-version') {
      const artifactVersion = artifactVersionRefV1Schema.parse(source.artifactVersion)
      if (artifactVersion.contentDigest !== source.sha256) {
        throw new Error(`Artifact-version data source ${source.sourceId} digest does not match its immutable version ref.`)
      }
      if (source.mediaType && artifactVersion.mediaType && source.mediaType !== artifactVersion.mediaType) {
        throw new Error(`Artifact-version data source ${source.sourceId} media type does not match its immutable version ref.`)
      }
      resolved.push({ ...structuredClone(source), artifactVersion })
      continue
    }
    if (source.kind === 'workspace-file') {
      const sourcePath = await resolveOpenTargetPath(source.locator, workspaceRoot, { allowBasenameFallback: false })
      const actualHash = await hashFile(sourcePath)
      if (actualHash !== source.sha256) {
        throw new Error(`Data source hash mismatch for ${source.sourceId}.`)
      }
      resolved.push({ ...source, locator: sourcePath })
      continue
    }
    resolved.push(structuredClone(source))
  }
  validateProvenanceChain(request, resolved)
  return resolved
}

function validateProvenanceChain(request: ScientificPlottingRenderRequest, sources: DataSourceRef[]): void {
  const sourceIds = new Set(sources.map((source) => source.sourceId))
  const receiptIds = new Set<string>()
  for (const receipt of request.derivedTableReceipts ?? []) {
    if (receiptIds.has(receipt.receiptId)) throw new Error(`Duplicate derived table receipt id: ${receipt.receiptId}`)
    receiptIds.add(receipt.receiptId)
    for (const sourceId of receipt.inputSourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Derived table receipt references undeclared source ${sourceId}.`)
    }
  }
  const transformationsById = new Map<string, ScientificPlotTransformationV1>()
  for (const transformation of request.transformations ?? []) {
    if (transformationsById.has(transformation.transformationId)) {
      throw new Error(`Duplicate transformation id: ${transformation.transformationId}`)
    }
    if (!/^[a-f0-9]{64}$/.test(transformation.inputHash) || !/^[a-f0-9]{64}$/.test(transformation.outputHash)) {
      throw new Error(`Transformation ${transformation.transformationId} requires lowercase SHA-256 input/output hashes.`)
    }
    transformationsById.set(transformation.transformationId, transformation)
  }
  for (const receipt of request.derivedTableReceipts ?? []) {
    if (receipt.transformationIds.length === 0) {
      throw new Error(`Derived table receipt ${receipt.receiptId} requires at least one transformation.`)
    }
    const receiptTransformations: ScientificPlotTransformationV1[] = []
    for (const transformationId of receipt.transformationIds) {
      const transformation = transformationsById.get(transformationId)
      if (!transformation) {
        throw new Error(`Derived table receipt references unknown transformation ${transformationId}.`)
      }
      receiptTransformations.push(transformation)
    }
    for (let index = 1; index < receiptTransformations.length; index += 1) {
      if (receiptTransformations[index - 1]!.outputHash !== receiptTransformations[index]!.inputHash) {
        throw new Error(`Derived table receipt ${receipt.receiptId} contains a disconnected transformation chain.`)
      }
    }
    if (receiptTransformations[0]!.inputHash !== receipt.inputHash) {
      throw new Error(`Derived table receipt ${receipt.receiptId} input hash does not match its first transformation.`)
    }
    if (receiptTransformations.at(-1)!.outputHash !== receipt.outputHash) {
      throw new Error(`Derived table receipt ${receipt.receiptId} output hash does not match its final transformation.`)
    }
  }
  if ((request.reproducibilityMode ?? 'standard') !== 'reproducible') return
  const dataHash = hashStableJson(request.data)
  const terminalOutputs = new Set([
    ...(request.transformations ?? []).map((item) => item.outputHash),
    ...(request.derivedTableReceipts ?? []).map((item) => item.outputHash),
    ...sources.map((source) => source.sha256)
  ])
  if (!terminalOutputs.has(dataHash)) {
    throw new Error('Reproducible data does not match any declared source or transformation output hash.')
  }
}

async function captureScientificPlotEnvironment(workspaceRoot: string): Promise<ScientificPlotEnvironmentV1> {
  const probe = await runPython(
    ['-c', PYTHON_ENVIRONMENT_PROBE_SOURCE],
    '',
    workspaceRoot,
    MATPLOTLIB_PROBE_TIMEOUT_MS
  )
  if (!probe.ok) throw new Error(`Could not capture plotting environment: ${probe.message}`)
  const lastLine = probe.stdout.trim().split('\n').at(-1)
  let parsed: unknown
  try {
    parsed = JSON.parse(lastLine ?? '')
  } catch {
    throw new Error('Could not parse plotting environment probe output.')
  }
  if (!isRecord(parsed)) throw new Error('Plotting environment probe returned an invalid record.')
  const pythonExecutable = typeof parsed.pythonExecutable === 'string' ? parsed.pythonExecutable : PYTHON_COMMAND
  const pythonVersion = typeof parsed.pythonVersion === 'string' ? parsed.pythonVersion : 'unknown'
  const platform = typeof parsed.platform === 'string' ? parsed.platform : 'unknown'
  const fontFingerprint = typeof parsed.fontFingerprint === 'string' ? parsed.fontFingerprint : hashStableJson([])
  const packages = isRecord(parsed.packages)
    ? Object.fromEntries(Object.entries(parsed.packages).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}
  const content = {
    schemaVersion: 1 as const,
    pythonCommand: PYTHON_COMMAND,
    pythonExecutable,
    pythonVersion,
    platform,
    packages,
    fontFingerprint
  }
  return {
    ...content,
    environmentDigest: hashStableJson(content)
  }
}

function buildScientificPlotRecipe(input: {
  request: ScientificPlottingRenderRequest
  workspaceRoot: string
  figureId: string
  styleSpec: FigureStyleSpec
  matplotlib: ScientificPlotMatplotlibParametersV1
  outputScale: number
  autoRepair: ReturnType<typeof normalizeAutoRepairOptions>
  environment: ScientificPlotEnvironmentV1
  dataSources: DataSourceRef[]
  codePath?: string
  rendererCodeSha256?: string
}): ScientificPlotRecipeV1 {
  const dataHash = hashStableJson(input.request.data)
  const transformations = input.request.transformations?.length
    ? structuredClone(input.request.transformations)
    : [{
        schemaVersion: 1 as const,
        transformationId: `transform-${dataHash.slice(0, 20)}`,
        kind: 'identity' as const,
        description: 'Use caller-supplied template-ready plotting data without transformation.',
        parameters: {},
        inputHash: dataHash,
        outputHash: dataHash
      }]
  const derivedTables = input.request.derivedTableReceipts?.length
    ? structuredClone(input.request.derivedTableReceipts)
    : [{
        schemaVersion: 1 as const,
        receiptId: `derived-${dataHash.slice(0, 20)}`,
        inputSourceIds: input.dataSources.map((source) => source.sourceId),
        operation: transformations[0]?.kind ?? 'identity',
        inputHash: transformations[0]?.inputHash ?? dataHash,
        outputHash: dataHash,
        transformationIds: transformations.map((item) => item.transformationId),
        warnings: []
      }]
  const execution: ScientificPlotExecutionV1 = {
    schemaVersion: 1,
    renderer: 'sciforge-scientific-plotting-mcp',
    rendererVersion: RENDERER_VERSION,
    rendererCodeSha256: input.rendererCodeSha256
      ?? createHash('sha256').update(PYTHON_RENDERER_SOURCE).digest('hex'),
    // Keep the recipe portable across reruns; the exact absolute codePath is
    // carried by the manifest and code Artifact, not baked into equivalence.
    command: input.codePath
      ? [PYTHON_COMMAND, '<sciforge-scientific-plot-code-artifact>']
      : [PYTHON_COMMAND, '-c', '<sciforge-scientific-plotting-renderer>'],
    cwd: input.workspaceRoot,
    timeoutMs: RENDER_TIMEOUT_MS
  }
  const content = {
    schemaVersion: 1 as const,
    figureId: input.figureId,
    template: input.request.template,
    data: canonicalClone(input.request.data),
    dataHash,
    labels: canonicalClone(input.request.labels ?? {}) as ScientificPlottingLabels,
    visualPlan: canonicalClone(input.request.visualPlan) as ScientificPlotRecipeV1['visualPlan'],
    dataSources: canonicalClone(input.dataSources) as DataSourceRef[],
    derivedTables: canonicalClone(derivedTables) as DerivedTableReceipt[],
    transformations: canonicalClone(transformations) as ScientificPlotTransformationV1[],
    ...(input.request.statistics ? { statistics: canonicalClone(input.request.statistics) as StatisticalDefinitionV1 } : {}),
    style: {
      resolvedSpec: canonicalClone(input.styleSpec) as FigureStyleSpec,
      resolvedSpecHash: hashStableJson(input.styleSpec),
      ...(input.request.styleProfileId ? { styleProfileId: input.request.styleProfileId } : {}),
      ...(input.request.styleSpecPath ? { styleSpecPath: input.request.styleSpecPath } : {}),
      ...(input.request.referencePath || input.request.reviewReferencePath
        ? { referencePath: input.request.reviewReferencePath ?? input.request.referencePath }
        : {})
    },
    render: {
      outputScale: input.outputScale,
      matplotlib: canonicalClone(input.matplotlib) as ScientificPlotMatplotlibParametersV1,
      autoRepair: canonicalClone(input.autoRepair) as ReturnType<typeof normalizeAutoRepairOptions>,
      ...(input.request.reviewTask ? { reviewTask: input.request.reviewTask } : {})
    },
    environment: input.environment,
    execution,
    reproducibilityMode: input.request.reproducibilityMode ?? 'standard',
    provenanceWarnings: uniqueStrings(input.request.provenanceWarnings ?? [])
  }
  return {
    ...content,
    recipeId: `plot-recipe:${hashStableJson(content)}`
  }
}

const MAX_PLOTTING_RECEIPT_BYTES = 16 * 1024 * 1024
const MAX_PRECOMMIT_MANIFEST_BYTES = 64 * 1024 * 1024

function validateEvidenceRouting(value: { runtimeId?: string; threadId?: string }): void {
  if (Boolean(value.runtimeId?.trim()) === Boolean(value.threadId?.trim())) return
  throw new Error('runtimeId and threadId must be supplied together for Evidence delivery.')
}

function assertVersionedSourcesForFormalReproducibleSave(
  request: ScientificPlottingRenderRequest,
  sources: DataSourceRef[],
  dependencies: ScientificPlottingEngineDependencies
): void {
  if ((request.reproducibilityMode ?? 'standard') !== 'reproducible') return
  if (!dependencies.artifactVersionCommitPort && !request.versioning) return
  const unversioned = sources.filter((source) => source.kind !== 'artifact-version')
  if (unversioned.length === 0) return
  throw new Error(
    `Formal reproducible saves require pinned ArtifactVersionRefV1 inputs; unversioned sources: ${unversioned.map((source) => source.sourceId).join(', ')}.`
  )
}

function scientificPlotRerunBreakpoint(
  message: string,
  fallbackStage: ScientificPlotProvenanceBreakpointV1['stage'],
  artifactVersionRef?: ArtifactVersionRefV1
): ScientificPlotProvenanceBreakpointV1 {
  const normalized = message.toLowerCase()
  let code: ScientificPlotProvenanceBreakpointV1['code'] = 'exact-rerun-failed'
  let stage = fallbackStage
  let retryable = false
  if (normalized.includes('capabilit')) {
    code = 'artifact-version-capability-unavailable'
    stage = 'baseline'
    retryable = true
  } else if (normalized.includes('access') || normalized.includes('denied') || normalized.includes('restricted')) {
    code = 'artifact-version-access-denied'
    stage = 'input'
  } else if (normalized.includes('digest') || normalized.includes('hash mismatch')) {
    code = 'artifact-version-digest-mismatch'
    stage = 'input'
  } else if (normalized.includes('does not pin') || normalized.includes('recipe') && normalized.includes('mismatch')) {
    code = 'recipe-link-mismatch'
    stage = 'baseline'
  } else if (normalized.includes('unavailable') || normalized.includes('missing')) {
    code = 'artifact-version-unavailable'
    stage = 'input'
    retryable = true
  } else if (normalized.includes('environment') || normalized.includes('python') || normalized.includes('matplotlib')) {
    code = 'environment-unavailable'
    stage = 'environment'
    retryable = true
  } else if (normalized.includes('artifact version commit') || normalized.includes('artifactversion commit')) {
    code = 'artifact-version-commit-failed'
    stage = 'commit'
    retryable = true
  } else if (fallbackStage === 'render') {
    code = 'render-failed'
    stage = 'render'
    retryable = true
  }
  return {
    schemaVersion: 1,
    code,
    stage,
    message,
    retryable,
    ...(artifactVersionRef ? { artifactVersionRef } : {})
  }
}

function operationFileName(operationId: string): string {
  return `${createHash('sha256').update(operationId, 'utf8').digest('hex')}.json`
}

function scientificPlotOperationReceiptPath(workspaceRoot: string, operationId: string): string {
  return join(workspaceRoot, PLOTTING_OPERATION_RECEIPT_RELATIVE_DIR, operationFileName(operationId))
}

function scientificPlotEvidenceOutboxPath(workspaceRoot: string, operationId: string): string {
  return join(workspaceRoot, EVIDENCE_OUTBOX_RELATIVE_DIR, operationFileName(operationId))
}

function scientificPlotEvidenceDeliveryReceiptPath(workspaceRoot: string, operationId: string): string {
  return join(workspaceRoot, EVIDENCE_DELIVERY_RECEIPT_RELATIVE_DIR, operationFileName(operationId))
}

async function readBoundedWorkspaceFile(
  workspaceRoot: string,
  path: string,
  maxBytes: number
): Promise<Buffer | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular receipt file: ${path}`)
    if (info.size > maxBytes) throw new Error(`Receipt exceeds ${maxBytes} bytes: ${path}`)
    const [workspaceReal, fileReal] = await Promise.all([
      realpath(resolve(workspaceRoot)),
      realpath(path)
    ])
    if (!isWithinWorkspace(workspaceReal, fileReal)) {
      throw new Error(`Receipt path escapes the workspace: ${path}`)
    }
    return await readFile(fileReal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertSafeWorkspaceWritePath(workspaceRoot: string, path: string): Promise<void> {
  const resolvedWorkspace = resolve(workspaceRoot)
  const resolvedTarget = resolve(path)
  if (!isWithinWorkspace(resolvedWorkspace, resolvedTarget)) {
    throw new Error(`Scientific Plotting receipt path escapes the workspace: ${path}`)
  }
  const workspaceReal = await realpath(resolvedWorkspace)
  let ancestor = dirname(resolvedTarget)
  while (true) {
    try {
      await lstat(ancestor)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw new Error(`No safe ancestor exists for receipt path: ${path}`)
      ancestor = parent
    }
  }
  const ancestorReal = await realpath(ancestor)
  if (!isWithinWorkspace(workspaceReal, ancestorReal)) {
    throw new Error(`Scientific Plotting receipt directory escapes the workspace: ${path}`)
  }
}

async function writeJsonAtomic(
  workspaceRoot: string,
  path: string,
  value: unknown,
  maxBytes = MAX_PLOTTING_RECEIPT_BYTES
): Promise<Buffer> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  if (bytes.byteLength > maxBytes) throw new Error(`Receipt exceeds ${maxBytes} bytes: ${path}`)
  await assertSafeWorkspaceWritePath(workspaceRoot, path)
  await mkdir(dirname(path), { recursive: true })
  const [workspaceReal, directoryReal] = await Promise.all([
    realpath(resolve(workspaceRoot)),
    realpath(dirname(path))
  ])
  if (!isWithinWorkspace(workspaceReal, directoryReal)) {
    throw new Error(`Scientific Plotting receipt directory escapes the workspace: ${path}`)
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return bytes
}

async function readScientificPlotOperationReceipt(
  workspaceRoot: string,
  path: string
): Promise<ScientificPlottingOperationReceiptV1 | undefined> {
  const bytes = await readBoundedWorkspaceFile(workspaceRoot, path, MAX_PLOTTING_RECEIPT_BYTES)
  if (!bytes) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`Could not parse Scientific Plotting operation receipt: ${error instanceof Error ? error.message : String(error)}`)
  }
  return scientificPlottingOperationReceiptV1Schema.parse(parsed)
}

function scientificPlotAttemptLogBytes(
  plotVersionId: string,
  recipeId: string,
  attempts: ScientificPlottingAttempt[]
): Buffer {
  return Buffer.from(canonicalJson({
    schemaVersion: 1,
    plotVersionId,
    recipeId,
    renderer: 'sciforge-scientific-plotting-mcp',
    rendererVersion: RENDERER_VERSION,
    attempts
  }), 'utf8')
}

async function computeScientificPlotPreparedDigests(
  manifest: ScientificPlottingManifest,
  preCommitManifestBytes: Uint8Array
): Promise<ScientificPlottingOperationReceiptV1['preparedDigests']> {
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  return {
    derivedData: digest(Buffer.from(canonicalJson(manifest.recipe.data), 'utf8')),
    recipe: digest(Buffer.from(canonicalJson(manifest.recipe), 'utf8')),
    ...(manifest.codePath ? { code: digest(await readFile(manifest.codePath)) } : {}),
    figure: digest(await readFile(manifest.outputPath)),
    renderManifest: digest(preCommitManifestBytes),
    attemptLog: digest(scientificPlotAttemptLogBytes(
      manifest.plotVersionId,
      manifest.recipe.recipeId,
      manifest.attempts
    ))
  }
}

function assertPreparedDigests(
  expected: ScientificPlottingOperationReceiptV1['preparedDigests'],
  actual: ScientificPlottingOperationReceiptV1['preparedDigests']
): void {
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (expected[key] !== actual[key]) {
      throw new Error(`Prepared Scientific Plotting ${key} bytes were changed before idempotent commit recovery.`)
    }
  }
}

function scientificPlotEvidenceCommitRefs(
  commit: ScientificPlotVersionCommitReceipt
): ScientificPlotEvidenceCommitRefsV1 {
  if (!commit.result.ok) throw new Error('A failed ArtifactVersion commit has no Evidence references.')
  const committed = new Map(commit.result.value.versions.map((item) => [item.candidateId, item.ref]))
  const ref = (candidateId: string): ArtifactVersionRefV1 => {
    const value = committed.get(candidateId)
    if (!value) throw new Error(`ArtifactVersion commit is missing Evidence reference ${candidateId}.`)
    return artifactVersionRefV1Schema.parse(value)
  }
  return {
    derivedData: ref(commit.candidateIds.derivedData),
    recipe: ref(commit.candidateIds.recipe),
    ...(commit.candidateIds.code ? { code: ref(commit.candidateIds.code) } : {}),
    figure: ref(commit.candidateIds.figure),
    renderManifest: ref(commit.candidateIds.renderManifest),
    attemptLog: ref(commit.candidateIds.attemptLog)
  }
}

async function writeScientificPlotEvidenceOutbox(input: {
  workspaceRoot: string
  request: ScientificPlottingRenderRequest
  createdAt: string
  commit: ScientificPlotVersionCommitReceipt
  evidenceLineage: ScientificPlotEvidenceLineageV1
}): Promise<ScientificPlotEvidenceDeliveryV1> {
  const outboxPath = scientificPlotEvidenceOutboxPath(input.workspaceRoot, input.request.operationId)
  const receipt = scientificPlotEvidenceOutboxReceiptV1Schema.parse({
    schemaVersion: 1,
    producer: 'scientific-plotting',
    operationId: input.request.operationId,
    state: 'pending',
    createdAt: input.createdAt,
    ...(input.request.runtimeId && input.request.threadId
      ? { runtimeId: input.request.runtimeId, threadId: input.request.threadId }
      : {}),
    commitRefs: scientificPlotEvidenceCommitRefs(input.commit),
    evidenceLineage: input.evidenceLineage
  }) as ScientificPlotEvidenceOutboxReceiptV1
  let sourceBytes = await readBoundedWorkspaceFile(
    input.workspaceRoot,
    outboxPath,
    MAX_PLOTTING_RECEIPT_BYTES
  )
  if (sourceBytes) {
    let existing: ScientificPlotEvidenceOutboxReceiptV1
    try {
      existing = scientificPlotEvidenceOutboxReceiptV1Schema.parse(JSON.parse(sourceBytes.toString('utf8')))
    } catch (error) {
      throw new Error(`Invalid existing Scientific Plotting Evidence outbox receipt: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw new Error(`Evidence outbox operation ${input.request.operationId} conflicts with an existing immutable receipt.`)
    }
  } else {
    sourceBytes = await writeJsonAtomic(input.workspaceRoot, outboxPath, receipt)
  }

  const deliveryPath = scientificPlotEvidenceDeliveryReceiptPath(input.workspaceRoot, input.request.operationId)
  const deliveryBytes = await readBoundedWorkspaceFile(
    input.workspaceRoot,
    deliveryPath,
    MAX_PLOTTING_RECEIPT_BYTES
  )
  if (!deliveryBytes) return { state: 'pending', receiptPath: outboxPath }
  try {
    const delivery = scientificPlotEvidenceEnqueueReceiptV1Schema.parse(
      JSON.parse(deliveryBytes.toString('utf8'))
    ) as ScientificPlotEvidenceEnqueueReceiptV1
    const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex')
    if (
      delivery.operationId !== receipt.operationId
      || delivery.sourceDigest !== sourceDigest
      || delivery.runtimeId !== receipt.runtimeId
      || delivery.threadId !== receipt.threadId
    ) {
      throw new Error('Evidence enqueue receipt does not match the immutable producer receipt.')
    }
    return { state: 'enqueued', receiptPath: deliveryPath }
  } catch (error) {
    return {
      state: 'failed',
      receiptPath: deliveryPath,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function manifestRenderStatus(
  manifest: ScientificPlottingManifest
): Extract<ScientificPlottingRenderResult, { ok: true }>['status'] {
  const status = inferManifestRenderStatus(manifest)
  if (status === 'unknown') throw new Error('Prepared Scientific Plotting manifest has no render status.')
  return status
}

function renderResultFromManifest(
  manifestPath: string,
  manifest: ScientificPlottingManifest,
  evidenceDelivery = manifest.evidenceDelivery
): Extract<ScientificPlottingRenderResult, { ok: true }> {
  const operationId = scientificPlottingOperationIdSchema.parse(manifest.operationId)
  return {
    ok: true,
    status: manifestRenderStatus(manifest),
    outputPath: manifest.outputPath,
    manifestPath,
    recipePath: manifest.recipePath,
    ...(manifest.codePath ? { codePath: manifest.codePath } : {}),
    operationId,
    plotVersionId: manifest.plotVersionId,
    recipe: manifest.recipe,
    ...(manifest.artifactManifestPath ? { artifactManifestPath: manifest.artifactManifestPath } : {}),
    ...(manifest.versionCommit ? { versionCommit: manifest.versionCommit } : {}),
    ...(manifest.evidenceLineage ? { evidenceLineage: manifest.evidenceLineage } : {}),
    ...(evidenceDelivery ? { evidenceDelivery } : {}),
    attempts: manifest.attempts,
    ...(manifest.finalReview ? { review: manifest.finalReview } : {}),
    ...(manifest.referenceProfile ? { referenceProfile: manifest.referenceProfile } : {}),
    ...(manifest.templateAdvice ? { templateAdvice: manifest.templateAdvice } : {}),
    ...(manifest.styleProfileId ? { styleProfileId: manifest.styleProfileId } : {}),
    ...(manifest.styleProfile ? { styleProfile: manifest.styleProfile } : {}),
    warnings: manifest.warnings
  }
}

async function finalizePreparedScientificPlotOperation(input: {
  request: ScientificPlottingRenderRequest
  workspaceRoot: string
  dependencies: ScientificPlottingEngineDependencies
  rerunContext?: ScientificPlotRerunContext
  operationReceiptPath: string
  manifest: ScientificPlottingManifest
  preCommitManifestBytes: Uint8Array
}): Promise<Extract<ScientificPlottingRenderResult, { ok: true }>> {
  const port = input.dependencies.artifactVersionCommitPort
  if (!port) throw new Error('Prepared Scientific Plotting commit requires Artifact Versions commit capability.')
  if (!input.manifest.codePath) {
    throw new Error('New Scientific Plotting versions require a persisted executable code artifact.')
  }
  const operationReceipt = await readScientificPlotOperationReceipt(
    input.workspaceRoot,
    input.operationReceiptPath
  )
  if (!operationReceipt || operationReceipt.state !== 'prepared') {
    throw new Error('Prepared Scientific Plotting operation receipt is missing or is not recoverable.')
  }
  const actualDigests = await computeScientificPlotPreparedDigests(input.manifest, input.preCommitManifestBytes)
  assertPreparedDigests(operationReceipt.preparedDigests, actualDigests)
  const versionCommit = await commitScientificPlotVersion({
    port,
    request: input.request,
    figureId: input.manifest.recipe.figureId,
    plotVersionId: input.manifest.plotVersionId,
    recipe: input.manifest.recipe,
    recipePath: input.manifest.recipePath,
    codePath: input.manifest.codePath,
    manifestPath: operationReceipt.manifestPath,
    preCommitManifestBytes: input.preCommitManifestBytes,
    attempts: input.manifest.attempts,
    outputPath: input.manifest.outputPath,
    outputHash: input.manifest.outputHash
  })
  const evidenceLineage = buildScientificPlotEvidenceLineage(input.manifest.recipe, versionCommit)
  if (input.rerunContext) {
    evidenceLineage.relations.push({
      src: evidenceLineage.activity.id,
      dst: `plot-run:${input.rerunContext.baselineFigureVersionRef.versionId.slice('artifact-version:'.length)}`,
      rel: input.manifest.outputHash === input.rerunContext.baselineFigureVersionRef.contentDigest
        ? 'replicates'
        : 'fails_to_replicate'
    })
  }
  const evidenceDelivery = await writeScientificPlotEvidenceOutbox({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    createdAt: input.manifest.createdAt,
    commit: versionCommit,
    evidenceLineage
  })
  input.manifest.versionCommit = versionCommit
  input.manifest.evidenceLineage = evidenceLineage
  input.manifest.evidenceDelivery = evidenceDelivery
  input.manifest.warnings = uniqueStrings([
    ...input.manifest.warnings,
    evidenceDelivery.state === 'enqueued'
      ? 'Evidence lineage is durably enqueued; this does not by itself establish an Evidence Snapshot or L4 completion.'
      : evidenceDelivery.state === 'failed'
        ? `Evidence delivery receipt failed validation: ${evidenceDelivery.message ?? 'unknown error'}`
        : 'Artifact versions are saved; Evidence lineage is pending durable Evidence DAG ingestion.'
  ])
  const artifactManifestPath = await writeScientificPlottingArtifactManifest({
    workspaceRoot: input.workspaceRoot,
    figureId: input.manifest.recipe.figureId,
    plotVersionId: input.manifest.plotVersionId,
    outputPath: input.manifest.outputPath,
    manifestPath: operationReceipt.manifestPath,
    recipePath: input.manifest.recipePath,
    codePath: input.manifest.codePath,
    recipe: input.manifest.recipe,
    request: input.request,
    review: input.manifest.finalReview,
    versionCommit
  })
  input.manifest.artifactManifestPath = artifactManifestPath
  await writeJsonAtomic(
    input.workspaceRoot,
    operationReceipt.manifestPath,
    input.manifest,
    MAX_PRECOMMIT_MANIFEST_BYTES
  )
  await writeJsonAtomic(input.workspaceRoot, input.operationReceiptPath, {
    ...operationReceipt,
    state: 'complete'
  } satisfies ScientificPlottingOperationReceiptV1)
  return renderResultFromManifest(operationReceipt.manifestPath, input.manifest)
}

async function resumeScientificPlotOperation(input: {
  request: ScientificPlottingRenderRequest
  workspaceRoot: string
  dependencies: ScientificPlottingEngineDependencies
  rerunContext?: ScientificPlotRerunContext
  requestHash: string
  operationReceiptPath: string
  receipt: ScientificPlottingOperationReceiptV1
}): Promise<ScientificPlottingRenderResult> {
  if (input.receipt.operationId !== input.request.operationId) {
    throw new Error('Scientific Plotting operation receipt identity does not match operationId.')
  }
  if (input.receipt.requestHash !== input.requestHash) {
    throw new Error(`operationId ${input.request.operationId} was already used for a different plotting request.`)
  }
  const manifestPath = await resolveTargetPathWithinWorkspace(input.receipt.manifestPath, input.workspaceRoot)
  const preCommitManifestPath = await resolveTargetPathWithinWorkspace(
    input.receipt.preCommitManifestPath,
    input.workspaceRoot
  )
  const preCommitManifestBytes = await readBoundedWorkspaceFile(
    input.workspaceRoot,
    preCommitManifestPath,
    MAX_PRECOMMIT_MANIFEST_BYTES
  )
  if (!preCommitManifestBytes) throw new Error('Prepared Scientific Plotting manifest bytes are missing.')
  let preparedManifest: ScientificPlottingManifest | null = null
  try {
    preparedManifest = parseScientificPlottingManifest(
      JSON.parse(preCommitManifestBytes.toString('utf8'))
    )
  } catch (error) {
    throw new Error(`Could not parse prepared Scientific Plotting manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!preparedManifest) throw new Error('Prepared Scientific Plotting manifest is invalid.')
  if (
    preparedManifest.operationId !== input.receipt.operationId
    || preparedManifest.requestHash !== input.receipt.requestHash
    || preparedManifest.plotVersionId !== input.receipt.plotVersionId
  ) {
    throw new Error('Prepared Scientific Plotting manifest does not match its operation receipt.')
  }
  const actualDigests = await computeScientificPlotPreparedDigests(preparedManifest, preCommitManifestBytes)
  assertPreparedDigests(input.receipt.preparedDigests, actualDigests)
  await readVerifiedScientificPlotManifest(input.workspaceRoot, preCommitManifestPath)
  if (input.receipt.state === 'prepared') {
    return await finalizePreparedScientificPlotOperation({
      request: input.request,
      workspaceRoot: input.workspaceRoot,
      dependencies: input.dependencies,
      rerunContext: input.rerunContext,
      operationReceiptPath: input.operationReceiptPath,
      manifest: preparedManifest,
      preCommitManifestBytes
    })
  }
  const manifest = await readVerifiedScientificPlotManifest(input.workspaceRoot, manifestPath)
  if (
    manifest.operationId !== input.receipt.operationId
    || manifest.requestHash !== input.receipt.requestHash
    || manifest.plotVersionId !== input.receipt.plotVersionId
    || !manifest.versionCommit
    || !manifest.evidenceLineage
  ) {
    throw new Error('Completed Scientific Plotting manifest does not match its operation receipt.')
  }
  const evidenceDelivery = await writeScientificPlotEvidenceOutbox({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    createdAt: manifest.createdAt,
    commit: manifest.versionCommit,
    evidenceLineage: manifest.evidenceLineage
  })
  return renderResultFromManifest(manifestPath, manifest, evidenceDelivery)
}

async function commitScientificPlotVersion(input: {
  port: NonNullable<ScientificPlottingEngineDependencies['artifactVersionCommitPort']>
  request: ScientificPlottingRenderRequest
  figureId: string
  plotVersionId: string
  recipe: ScientificPlotRecipeV1
  recipePath: string
  codePath: string
  manifestPath: string
  preCommitManifestBytes: Uint8Array
  attempts: ScientificPlottingAttempt[]
  outputPath: string
  outputHash: string
}): Promise<ScientificPlotVersionCommitReceipt> {
  const artifactId = input.request.versioning?.artifactId?.trim()
  const expectedCurrentVersionId = input.request.versioning?.expectedCurrentVersionId
  if (artifactId && expectedCurrentVersionId === undefined) {
    throw new Error('Committing an existing plot artifact requires versioning.expectedCurrentVersionId.')
  }
  const candidateStem = `${input.figureId}:${input.plotVersionId}`
  const candidateIds = {
    derivedData: `derived-data:${candidateStem}`,
    recipe: `plot-recipe:${candidateStem}`,
    code: `plot-code:${candidateStem}`,
    figure: `plot-figure:${candidateStem}`,
    renderManifest: `render-manifest:${candidateStem}`,
    attemptLog: `render-log:${candidateStem}`
  }
  const intent = input.request.versioning?.intent ?? 'save'
  const generatedAccessPolicyWithMaterialization = {
    visibility: 'workspace' as const,
    principals: [],
    allowExport: true,
    allowMaterialize: true
  }
  const generatedAccessPolicy = artifactVersionAccessPolicyV1Schema.safeParse(
    generatedAccessPolicyWithMaterialization
  ).success
    ? generatedAccessPolicyWithMaterialization
    : {
        visibility: 'workspace' as const,
        principals: [],
        allowExport: true
      }
  const derivedDataBytes = Buffer.from(canonicalJson(input.recipe.data), 'utf8')
  const recipeBytes = Buffer.from(canonicalJson(input.recipe), 'utf8')
  const codeBytes = await readFile(input.codePath)
  const figureBytes = await readFile(input.outputPath)
  const manifestBytes = Buffer.from(input.preCommitManifestBytes)
  const attemptLogBytes = scientificPlotAttemptLogBytes(
    input.plotVersionId,
    input.recipe.recipeId,
    input.attempts
  )
  const upstreamDependencies = input.recipe.dataSources.flatMap((source, index) => (
    source.kind === 'artifact-version'
      ? [{
          role: `input-${index + 1}`,
          required: true,
          target: {
            kind: 'version' as const,
            ref: source.artifactVersion
          }
        }]
      : []
  ))
  const candidateDependency = (role: string, candidateId: string) => ({
    role,
    required: true,
    target: {
      kind: 'candidate' as const,
      candidateId
    }
  })
  const snapshotContent = (bytes: Uint8Array, mediaType: string) => ({
    mode: 'snapshot' as const,
    dataBase64: Buffer.from(bytes).toString('base64'),
    mediaType
  })
  const commitInput = artifactVersionCommitInputV1Schema.parse({
    idempotencyKey: `scientific-plot:${input.request.operationId}`,
    candidates: [
      {
        candidateId: candidateIds.derivedData,
        expectedCurrentVersionId: null,
        kind: 'scientific-plot-derived-data',
        label: `${input.request.labels?.title ?? input.figureId} — derived data`,
        intent,
        content: snapshotContent(derivedDataBytes, 'application/json'),
        dependencies: upstreamDependencies,
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          dataHash: input.recipe.dataHash,
          sourceIds: input.recipe.dataSources.map((source) => source.sourceId)
        })
      },
      {
        candidateId: candidateIds.recipe,
        expectedCurrentVersionId: null,
        kind: 'scientific-plot-recipe',
        label: `${input.request.labels?.title ?? input.figureId} — recipe`,
        intent,
        content: snapshotContent(recipeBytes, 'application/json'),
        dependencies: [candidateDependency('derived-data', candidateIds.derivedData)],
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          recipeId: input.recipe.recipeId,
          recipePath: input.recipePath,
          dataHash: input.recipe.dataHash,
          environmentDigest: input.recipe.environment.environmentDigest,
          rendererCodeSha256: input.recipe.execution.rendererCodeSha256
        })
      },
      {
        candidateId: candidateIds.code,
        expectedCurrentVersionId: null,
        kind: 'scientific-plot-code',
        label: `${input.request.labels?.title ?? input.figureId} — executable renderer`,
        intent,
        content: snapshotContent(codeBytes, 'text/x-python'),
        dependencies: [candidateDependency('recipe', candidateIds.recipe)],
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          codePath: input.codePath,
          codeSha256: createHash('sha256').update(codeBytes).digest('hex')
        })
      },
      {
        candidateId: candidateIds.figure,
        ...(artifactId ? { artifactId } : {}),
        expectedCurrentVersionId: artifactId ? expectedCurrentVersionId : null,
        kind: 'scientific-plot',
        label: input.request.labels?.title ?? input.figureId,
        intent,
        content: snapshotContent(figureBytes, 'image/png'),
        dependencies: [candidateDependency('recipe', candidateIds.recipe), candidateDependency('code', candidateIds.code)],
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          recipeId: input.recipe.recipeId,
          outputPath: input.outputPath,
          outputHash: input.outputHash
        })
      },
      {
        candidateId: candidateIds.renderManifest,
        expectedCurrentVersionId: null,
        kind: 'scientific-plot-render-manifest',
        label: `${input.request.labels?.title ?? input.figureId} — render manifest`,
        intent,
        content: snapshotContent(manifestBytes, 'application/json'),
        dependencies: [
          candidateDependency('recipe', candidateIds.recipe),
          candidateDependency('figure', candidateIds.figure),
          candidateDependency('code', candidateIds.code)
        ],
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          manifestPath: input.manifestPath,
          preCommitManifestSha256: createHash('sha256').update(manifestBytes).digest('hex')
        })
      },
      {
        candidateId: candidateIds.attemptLog,
        expectedCurrentVersionId: null,
        kind: 'scientific-plot-render-log',
        label: `${input.request.labels?.title ?? input.figureId} — render log`,
        intent,
        content: snapshotContent(attemptLogBytes, 'application/json'),
        dependencies: [
          candidateDependency('recipe', candidateIds.recipe),
          candidateDependency('figure', candidateIds.figure),
          candidateDependency('code', candidateIds.code)
        ],
        accessPolicy: generatedAccessPolicy,
        metadata: canonicalClone({
          plotVersionId: input.plotVersionId,
          attemptCount: input.attempts.length,
          attemptLogSha256: createHash('sha256').update(attemptLogBytes).digest('hex')
        })
      }
    ]
  })
  const result = artifactVersionCommitResultV1Schema.parse(await input.port.commit(commitInput))
  if (!result.ok) throw new Error(`Artifact version commit failed: ${result.issue.message}`)
  const committedCandidateIds = new Set(result.value.versions.map((item) => item.candidateId))
  for (const candidateId of Object.values(candidateIds)) {
    if (!committedCandidateIds.has(candidateId)) {
      throw new Error(`Artifact version commit receipt is missing candidate ${candidateId}.`)
    }
  }
  return {
    contract: ARTIFACT_VERSION_COMMIT_CONTRACT.actionId as 'artifact-versions.commit',
    candidateIds,
    result
  }
}

function buildScientificPlotEvidenceLineage(
  recipe: ScientificPlotRecipeV1,
  commit: ScientificPlotVersionCommitReceipt
): ScientificPlotEvidenceLineageV1 {
  if (!commit.result.ok) {
    throw new Error('A failed ArtifactVersion commit cannot produce Evidence lineage.')
  }
  const committed = new Map(
    commit.result.value.versions.map((item) => [item.candidateId, item])
  )
  const artifactForCandidate = (candidateId: string): ScientificPlotEvidenceArtifactV1 => {
    const item = committed.get(candidateId)
    if (!item) throw new Error(`Evidence lineage is missing committed candidate ${candidateId}.`)
    return evidenceArtifact(item.artifact.kind, `snapshot:${item.ref.versionId}`, item.ref)
  }
  const inputs: ScientificPlotEvidenceLineageV1['inputs'] = recipe.dataSources.map((source) => ({
    id: `plot-input:${source.sourceId}`,
    type: 'dataset_version',
    name: source.sourceId,
    ...(source.kind === 'artifact-version'
      ? {
          artifact: evidenceArtifact(
            'dataset',
            source.locator,
            source.artifactVersion
          )
        }
      : {
          provenanceBreakpoint: 'Input is content-bound but has no pinned ArtifactVersionRefV1.'
        })
  }))
  const derivedDataId = `plot-output:${commit.candidateIds.derivedData}`
  const recipeId = `plot-output:${commit.candidateIds.recipe}`
  const codeId = commit.candidateIds.code
    ? `plot-output:${commit.candidateIds.code}`
    : undefined
  const figureId = `plot-output:${commit.candidateIds.figure}`
  const manifestId = `plot-output:${commit.candidateIds.renderManifest}`
  const figureCommit = committed.get(commit.candidateIds.figure)
  if (!figureCommit) {
    throw new Error(`Evidence lineage is missing committed candidate ${commit.candidateIds.figure}.`)
  }
  const activityId = `plot-run:${figureCommit.ref.versionId.slice('artifact-version:'.length)}`
  const randomSeed = recipe.statistics?.seed
  return {
    activity: {
      id: activityId,
      type: 'analysis_run',
      name: `Render ${recipe.figureId}`,
      status: 'completed',
      parameters: canonicalClone({
        recipeId: recipe.recipeId,
        template: recipe.template,
        dataHash: recipe.dataHash,
        statistics: recipe.statistics ?? null,
        transformations: recipe.transformations,
        resolvedStyleHash: recipe.style.resolvedSpecHash,
        matplotlib: recipe.render.matplotlib ?? null,
        rendererCodeSha256: recipe.execution.rendererCodeSha256
      }) as Record<string, unknown>,
      ...(randomSeed !== undefined ? { stochastic: true, randomSeed } : {})
    },
    inputs,
    software: [{
      id: `software:sciforge-scientific-plotting:${recipe.execution.rendererVersion}`,
      type: 'software_version',
      name: 'SciForge Scientific Plotting',
      version: recipe.execution.rendererVersion,
      contentDigest: recipe.execution.rendererCodeSha256
    }, {
      id: `software:matplotlib:${recipe.environment.packages.matplotlib ?? 'unknown'}`,
      type: 'software_version',
      name: 'Matplotlib',
      ...(recipe.environment.packages.matplotlib
        ? { version: recipe.environment.packages.matplotlib }
        : {}),
      contentDigest: recipe.execution.rendererCodeSha256
    }],
    environment: {
      id: `environment:${recipe.environment.environmentDigest}`,
      type: 'environment',
      name: 'Pinned scientific plotting environment',
      contentDigest: recipe.environment.environmentDigest,
      pythonVersion: recipe.environment.pythonVersion,
      packages: { ...recipe.environment.packages },
      fontFingerprint: recipe.environment.fontFingerprint
    },
    logs: [{
      id: `plot-log:${commit.candidateIds.attemptLog}`,
      type: 'artifact',
      name: 'Scientific plot render attempts',
      artifact: artifactForCandidate(commit.candidateIds.attemptLog)
    }],
    outputs: [{
      id: derivedDataId,
      type: 'dataset_version',
      name: 'Plot-ready derived data',
      artifact: artifactForCandidate(commit.candidateIds.derivedData)
    }, {
      id: recipeId,
      type: 'artifact',
      name: 'Scientific plot recipe',
      artifact: artifactForCandidate(commit.candidateIds.recipe)
    }, ...(commit.candidateIds.code ? [{
      id: codeId!,
      type: 'artifact' as const,
      name: 'Executable scientific plot renderer',
      artifact: artifactForCandidate(commit.candidateIds.code)
    }] : []), {
      id: figureId,
      type: 'artifact',
      name: 'Scientific figure',
      artifact: artifactForCandidate(commit.candidateIds.figure)
    }, {
      id: manifestId,
      type: 'artifact',
      name: 'Scientific plot render manifest',
      artifact: artifactForCandidate(commit.candidateIds.renderManifest)
    }],
    relations: [
      ...inputs.map((input) => ({
        src: derivedDataId,
        dst: input.id,
        rel: 'derived_from' as const
      })),
      {
        src: figureId,
        dst: recipeId,
        rel: 'derived_from'
      },
      ...(codeId ? [{
        src: figureId,
        dst: codeId,
        rel: 'derived_from' as const
      }] : [])
    ]
  }
}

function evidenceArtifact(
  kind: string,
  locator: string,
  ref: ArtifactVersionRefV1
): ScientificPlotEvidenceArtifactV1 {
  return {
    kind,
    locator,
    contentDigest: ref.contentDigest,
    size: ref.byteLength,
    ...(ref.mediaType ? { mediaType: ref.mediaType } : {}),
    retention: ref.retention,
    accessPolicy: ref.accessPolicy,
    artifactVersionRef: ref
  }
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function hashRequest(
  request: ScientificPlottingRenderRequest,
  rerunContext?: ScientificPlotRerunContext
): string {
  return hashStableJson({
    operationId: request.operationId,
    visualPlan: request.visualPlan,
    template: request.template,
    data: request.data,
    reproducibilityMode: request.reproducibilityMode,
    dataSources: request.dataSources,
    derivedTableReceipts: request.derivedTableReceipts,
    transformations: request.transformations,
    statistics: request.statistics,
    provenanceWarnings: request.provenanceWarnings,
    versioning: request.versioning,
    reviewTask: request.reviewTask,
    labels: request.labels,
    figureId: request.figureId,
    styleSpec: request.styleSpec,
    styleSpecPath: request.styleSpecPath,
    styleProfileId: request.styleProfileId,
    matplotlib: request.matplotlib,
    referencePath: request.referencePath ?? request.reviewReferencePath,
    outputDir: request.outputDir,
    outputScale: request.outputScale,
    visualDocumentId: request.visualDocumentId,
    runtimeId: request.runtimeId,
    threadId: request.threadId,
    autoRepair: request.autoRepair,
    rerunBaselineFigureVersionRef: rerunContext?.baselineFigureVersionRef,
    rerunCodeArtifactVersionRef: rerunContext?.codeSnapshot.ref
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

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalClone<T>(value: T): unknown {
  return JSON.parse(canonicalJson(value)) as unknown
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Scientific plotting provenance only accepts finite JSON numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  throw new Error(`Scientific plotting provenance cannot serialize ${typeof value}.`)
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

const PYTHON_ENVIRONMENT_PROBE_SOURCE = String.raw`
import hashlib
import json
import platform
import sys

import matplotlib
from matplotlib import font_manager

try:
    import numpy
    numpy_version = numpy.__version__
except Exception:
    numpy_version = "unavailable"

fonts = sorted(
    f"{getattr(item, 'name', '')}|{getattr(item, 'fname', '')}"
    for item in font_manager.fontManager.ttflist
)
font_fingerprint = hashlib.sha256("\n".join(fonts).encode("utf-8")).hexdigest()
print(json.dumps({
    "pythonExecutable": sys.executable,
    "pythonVersion": platform.python_version(),
    "platform": platform.platform(),
    "packages": {
        "matplotlib": matplotlib.__version__,
        "numpy": numpy_version,
    },
    "fontFingerprint": font_fingerprint,
}, sort_keys=True))
`

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
from matplotlib.patches import Rectangle, FancyArrowPatch, Ellipse, Polygon

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
    # The TypeScript side applies the VisualStyleProfile plotting adapter; this Python side
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
        cmap = payload.get("heatmapCmapName") or data.get("cmap") or "cividis"
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
        cmap = payload.get("heatmapCmapName") or data.get("cmap") or "magma"
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
    primitives = data.get("primitives") or []
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
    if primitives or any(str(node.get("shape") or "rectangle").lower() not in ("rectangle", "rect") for node in nodes):
        ax.set_aspect("equal", adjustable="box")
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
    def add_shape(shape, center_x, center_y, width, height, facecolor, edgecolor, linewidth, alpha, zorder, points=None):
        kind = str(shape or "rectangle").strip().lower()
        if kind in ("circle", "ellipse"):
            if kind == "circle":
                width = height = min(width, height)
            patch = Ellipse((center_x, center_y), width=width, height=height, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind == "triangle":
            patch = Polygon([
                (center_x, center_y + height / 2),
                (center_x - width / 2, center_y - height / 2),
                (center_x + width / 2, center_y - height / 2),
            ], closed=True, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind == "polygon" and isinstance(points, list) and len(points) >= 3:
            vertices = [
                (as_float(point.get("x"), 0), as_float(point.get("y"), 0))
                for point in points
                if isinstance(point, dict)
            ]
            if len(vertices) < 3:
                raise ValueError("Polygon primitives require at least three valid points.")
            patch = Polygon(vertices, closed=True, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind in ("rectangle", "rect"):
            patch = Rectangle((center_x - width / 2, center_y - height / 2), width, height, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        else:
            raise ValueError("Unsupported vector primitive shape: " + kind)
        ax.add_patch(patch)
    for primitive in primitives:
        if not isinstance(primitive, dict):
            continue
        primitive_type = str(primitive.get("type") or primitive.get("kind") or "").strip().lower()
        color = primitive.get("fill") or primitive.get("color") or "none"
        edgecolor = primitive.get("stroke") or mpl.rcParams.get("axes.edgecolor", "#222222")
        linewidth = clamp(as_float(primitive.get("strokeWidth"), 1.0), 0.0, 12.0)
        alpha = clamp(as_float(primitive.get("opacity"), 1.0), 0.0, 1.0)
        zorder = as_float(primitive.get("z"), 2)
        if primitive_type in ("line", "arrow"):
            x1 = as_float(first_present(primitive, "x1", "x"), 0)
            y1 = as_float(first_present(primitive, "y1", "y"), 0)
            x2 = as_float(primitive.get("x2"), x1)
            y2 = as_float(primitive.get("y2"), y1)
            if primitive_type == "arrow":
                ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=11, linewidth=linewidth, color=edgecolor, alpha=alpha, zorder=zorder))
            else:
                ax.plot([x1, x2], [y1, y2], color=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif primitive_type == "text":
            ax.text(
                as_float(primitive.get("x"), 0.5),
                as_float(primitive.get("y"), 0.5),
                str(primitive.get("text") or ""),
                ha=str(primitive.get("horizontalAlign") or "center"),
                va=str(primitive.get("verticalAlign") or "center"),
                fontsize=clamp(as_float(primitive.get("fontSize"), mpl.rcParams.get("font.size", 8)), 4, 72),
                color=primitive.get("textColor") or edgecolor,
                alpha=alpha,
                zorder=zorder,
            )
        else:
            width = clamp(as_float(first_present(primitive, "width", "w", "diameter"), 0.18), 0.001, 2.0)
            height = clamp(as_float(first_present(primitive, "height", "h", "diameter"), width), 0.001, 2.0)
            if primitive_type == "circle" and isinstance(primitive.get("radius"), (int, float)):
                width = height = clamp(float(primitive.get("radius")) * 2, 0.001, 2.0)
            add_shape(
                primitive_type,
                as_float(primitive.get("x"), 0.5),
                as_float(primitive.get("y"), 0.5),
                width,
                height,
                color,
                edgecolor,
                linewidth,
                alpha,
                zorder,
                primitive.get("points"),
            )
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
        add_shape(
            node.get("shape") or "rectangle",
            center_x,
            center_y,
            width,
            height,
            color,
            node.get("stroke") or mpl.rcParams.get("axes.edgecolor", "#222222"),
            clamp(as_float(node.get("strokeWidth"), 0.9), 0.0, 12.0),
            alpha,
            2,
            node.get("points"),
        )
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
    renderer_diagnostics["schematicPrimitiveCount"] = len(primitives)
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
