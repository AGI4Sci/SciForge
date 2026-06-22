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
} from '../shared/figure-style'
import {
  SCIENTIFIC_PLOTTING_TEMPLATES,
  type ScientificPlottingAttempt,
  type ScientificPlottingAutoRepairOptions,
  type ScientificPlottingCropBox,
  type ScientificPlottingDataMappingRequest,
  type ScientificPlottingDataMappingResult,
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
  type ScientificPlottingStyleProfilesRequest,
  type ScientificPlottingStyleProfilesResult,
  type ScientificPlottingStyleTransferManifest,
  type ScientificPlottingStyleTransferRequest,
  type ScientificPlottingStyleTransferResult,
  type ScientificPlottingTemplateAdvice,
  type ScientificPlottingTemplate
} from '../shared/scientific-plotting'
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
} from './services/workspace-paths'

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
  const template = request.templateHint ?? referenceProfile?.recommendedTemplate ?? taskTemplate
  const isStyleTransfer = /style|paper|figure|nature|science|cell|neurips|iclr|论文|文献|风格|顶刊|顶会/i.test(task)
  const templateAdvice = buildTemplateAdvice(template, referenceProfile, undefined)
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
    templateAlternatives: buildTemplateAlternatives(template, taskTemplate, referenceProfile),
    requiredInputs: requiredInputsForTemplate(template),
    styleInputs: isStyleTransfer
      ? ['Optional styleProfileId, FigureStyleSpec, or reference image path for post-render review.']
      : ['Optional styleProfileId or FigureStyleSpec for publication styling.'],
    controlledTool: 'scientific_plotting_render',
    planningWarnings: [...warnings, ...(templateAdvice?.messages ?? [])],
    guardrails: [
      'Do not emit executable shell or Python commands.',
      'Use K-Dense skills only as read-only plotting guidance.',
      'Render with SciForge controlled templates and review the output before presenting it.',
      'Do not alter data values during style repair.'
    ],
    skillHints: {
      recommendedSkills: [
        'scientific-visualization',
        'matplotlib',
        template === 'schematic-grid' ? 'scientific-schematics' : 'seaborn'
      ],
      recommendedLibraries: template === 'schematic-grid'
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
      ...(referenceImagePath ? { referenceImagePath } : {}),
      ...(effectiveStyleSpecPath ? { styleSpecPath: effectiveStyleSpecPath } : {}),
      selectedTemplate: mapping.selectedTemplate,
      ...(render.styleProfileId ?? selectedStyleProfileId ? { selectedStyleProfileId: render.styleProfileId ?? selectedStyleProfileId } : {}),
      outputPath: render.outputPath,
      renderManifestPath: render.manifestPath,
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
    if (request.styleProfileId?.trim() && (request.styleSpec || request.styleSpecPath?.trim())) {
      warnings.push('styleProfileId was ignored because explicit styleSpec/styleSpecPath was provided.')
    }
    const styleProfile = styleProfileForRender(request)
    const styleSpec = await resolveRenderStyleSpec(request, workspaceRoot, styleProfile)
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
      ...(request.styleSpecPath ? { styleSpecPath: request.styleSpecPath } : {}),
      ...(referencePath ? { referencePath } : {}),
      attempts,
      ...(finalReview ? { finalReview } : {}),
      warnings
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return {
      ok: true,
      status,
      outputPath: finalOutputPath,
      manifestPath,
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
    const typography = isRecord(diagnostics.typography)
      ? parseRendererTypographyDiagnostics(diagnostics.typography)
      : undefined
    const layoutQuality = isRecord(diagnostics.layoutQuality)
      ? parseRendererLayoutQualityDiagnostics(diagnostics.layoutQuality)
      : undefined
    return {
      rendererDiagnostics: {
        ...(legendPlacement ? { legendPlacement } : {}),
        ...(categoryLabelRotation !== undefined ? { categoryLabelRotation } : {}),
        ...(savefigPadInches !== undefined ? { savefigPadInches } : {}),
        ...(multiPanelCount !== undefined ? { multiPanelCount } : {}),
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
  if (score && selectedTemplate === 'schematic-grid' && (score.axes < 0.62 || score.grid < 0.62)) {
    messages.push('Schematic panels may score low on axes/grid because reference diagrams contain structural gray marks.')
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
  if (selectedTemplate === 'schematic-grid') add('bar', 'Use when the schematic is actually categorical data.')
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
            : template === 'schematic-grid'
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
  if (isRecord(data) && template === 'schematic-grid' && Array.isArray(data.nodes)) {
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
  const nodes = data.nodes
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > MAX_SCHEMATIC_NODES) {
    throw new Error(`schematic-grid data.nodes must include 1-${MAX_SCHEMATIC_NODES} nodes.`)
  }
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) {
      throw new Error('schematic-grid nodes must include labels.')
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
  add('multi-panel', /multi[-\s]?panel|subplot|facet|figure panel|panel figure|组合图|多面板|多子图/i)
  add('box-violin', /violin|box\s*plot|boxplot|strip\s*plot|swarm|distribution comparison|distribution by (condition|group|category)|grouped distribution|箱线图|小提琴图|组间分布/i)
  add('histogram-density', /histogram|density|kde|residual distribution|value distribution|分布图|直方图|密度图/i)
  add('attention-map', /attention|token alignment|注意力/i)
  add('heatmap', /heatmap|matrix|correlation|表达矩阵|热图|矩阵/i)
  add('scatter', /scatter|embedding|umap|tsne|point cloud|散点|降维/i)
  add('errorbar-bar', /error\s*bar|confidence interval|ci\b|uncertainty|误差棒|置信区间|不确定性/i)
  add('bar', /bar|category|comparison|benchmark|柱状|条形|分类|基准/i)
  add('schematic-grid', /schematic|diagram|workflow|mechanism|array programming|numpy|示意|机制|流程/i)
  add('line', /line|curve|trend|time series|trajectory|折线|曲线|趋势|时间序列/i)
  return signals
}

function kindForTemplate(
  template: ScientificPlottingTemplate,
  score: number
): ScientificPlottingReferenceProfile['kind'] {
  if (score < 0.28) return 'unknown'
  if (template === 'heatmap' || template === 'attention-map') return 'matrix'
  if (template === 'schematic-grid') return 'schematic'
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
      recommendedTemplates: ['schematic-grid', 'multi-panel', 'bar'],
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

import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
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
                len(handles) > 3 or
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

def finite_list(values):
    result = []
    for value in values or []:
        number = as_float(value, None)
        if number is not None and math.isfinite(number):
            result.append(number)
    return result

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
        ax.scatter(x, y, label=name, s=max(10, mpl.rcParams.get("lines.markersize", 3) ** 2), alpha=0.86, linewidths=0.3)
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "bar" or template == "errorbar-bar":
    categories = data.get("categories") or []
    series = data.get("series") or []
    x = list(range(len(categories)))
    group_width = 0.68 if len(categories) >= 4 else 0.72
    width = clamp(group_width / max(1, len(series)), 0.08, 0.34)
    positive_baseline = True
    bar_tops = []
    for index, item in enumerate(series):
        offset = (index - (len(series) - 1) / 2) * width
        values = item.get("values") or []
        errors = item.get("error") if template == "errorbar-bar" else None
        name = item.get("name") or f"Series {index + 1}"
        positive_baseline = positive_baseline and all(as_float(value, 0) >= 0 for value in values)
        if values:
            for value_index, value in enumerate(values):
                error_value = 0
                if isinstance(errors, list) and value_index < len(errors):
                    error_value = abs(as_float(errors[value_index], 0))
                bar_tops.append(as_float(value, 0) + error_value)
        ax.bar(
            [v + offset for v in x],
            values,
            yerr=errors,
            width=width,
            label=name,
            linewidth=0,
            capsize=clamp(1.6 + width * 3.0, 1.7, 2.6) if errors else 0,
            error_kw={
                "elinewidth": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                "capthick": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                "ecolor": mpl.rcParams.get("text.color", "#222222"),
            } if errors else None,
        )
    max_category_len = max([len(str(value)) for value in categories] or [0])
    rotation = 28 if max_category_len > 12 else 18 if max_category_len > 8 or len(categories) > 4 else 0
    ax.set_xticks(x, categories, rotation=rotation, ha="right" if rotation else "center")
    ax.tick_params(axis="x", pad=1.5)
    ax.tick_params(axis="y", pad=1.5)
    renderer_diagnostics["categoryLabelRotation"] = rotation
    if positive_baseline:
        ax.set_ylim(bottom=0)
    if bar_tops:
        top = max(bar_tops)
        if top > 0:
            ax.set_ylim(top=top * 1.16)
            add_layout_note("Reserved extra y-axis headroom for error bars and panel labels.")
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
    if data.get("xLabels"):
        ax.set_xticks(list(range(len(data.get("xLabels")))), data.get("xLabels"), rotation=45, ha="right")
    if data.get("yLabels"):
        ax.set_yticks(list(range(len(data.get("yLabels")))), data.get("yLabels"))
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
    if data.get("xLabels"):
        ax.set_xticks(list(range(len(data.get("xLabels")))), data.get("xLabels"), rotation=45, ha="right")
    if data.get("yLabels"):
        ax.set_yticks(list(range(len(data.get("yLabels")))), data.get("yLabels"))
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
    def draw_small_panel(axis, panel, panel_index):
        panel_template = panel.get("template")
        panel_data = panel.get("data") or {}
        panel_labels = panel.get("labels") or {}
        if panel_template == "line":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or list(range(1, len(y) + 1))
                axis.plot(x, y, marker="o" if len(y) <= 24 else None, linewidth=mpl.rcParams.get("lines.linewidth", 1.0), markersize=2.4, label=name)
        elif panel_template == "scatter":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or list(range(1, len(y) + 1))
                axis.scatter(x, y, s=10, alpha=0.82, linewidths=0.25, label=name)
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
            if panel_data.get("xLabels"):
                axis.set_xticks(list(range(len(panel_data.get("xLabels")))), panel_data.get("xLabels"), rotation=45, ha="right")
            else:
                axis.set_xticks([])
            if panel_data.get("yLabels"):
                axis.set_yticks(list(range(len(panel_data.get("yLabels")))), panel_data.get("yLabels"))
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
            axis.violinplot(group_values, positions=positions, widths=0.65, showmeans=False, showmedians=True, showextrema=False)
            axis.set_xticks(positions, names, rotation=24 if len(names) > 3 else 0, ha="right" if len(names) > 3 else "center")
        elif panel_template == "histogram-density":
            for series_index, item in enumerate(panel_data.get("series") or []):
                values = finite_list(item.get("values") or [])
                axis.hist(values, bins=int(panel_data.get("bins") or 18), density=bool(panel_data.get("density", True)), alpha=0.25, label=item.get("name") or f"Series {series_index + 1}")
        elif panel_template == "schematic-grid":
            axis.axis("off")
            nodes = panel_data.get("nodes") or []
            for node_index, node in enumerate(nodes[:4]):
                axis.text(0.5, 0.84 - node_index * 0.22, str(node.get("label") or ""), ha="center", va="center", fontsize=min(label_size, 7.5), bbox={"boxstyle": "round,pad=0.18", "facecolor": palette[node_index % len(palette)], "alpha": 0.12, "edgecolor": mpl.rcParams.get("axes.edgecolor", "#222222")})
        set_labels_from(axis, panel_labels)
        if panel_labels.get("legend", False):
            handles, legend_labels = axis.get_legend_handles_labels()
            if handles:
                axis.legend(loc="best", fontsize=6.2, frameon=False)
        axis.text(-0.16, 1.08, panel.get("panel") or panel_letters[panel_index], transform=axis.transAxes, fontweight="bold", va="top", fontsize=9.2, clip_on=False)
    for panel_index, panel in enumerate(panels):
        row = panel_index // columns
        col = panel_index % columns
        draw_small_panel(axes_grid[row][col], panel, panel_index)
    for empty_index in range(len(panels), rows * columns):
        row = empty_index // columns
        col = empty_index % columns
        axes_grid[row][col].axis("off")
    if labels.get("title"):
        fig.suptitle(labels.get("title"), fontsize=title_size, y=1.02)
    renderer_diagnostics["multiPanelCount"] = len(panels)
    add_layout_note(f"Rendered {len(panels)} controlled subpanels in a {rows}x{columns} layout.")
elif template == "schematic-grid":
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    columns = int(math.ceil(math.sqrt(len(nodes))))
    rows = int(math.ceil(len(nodes) / max(1, columns)))
    positions = {}
    ax.set_xlim(0, columns)
    ax.set_ylim(0, rows)
    ax.axis("off")
    def wrap_node_label(value):
        text = str(value or "")
        if len(text) <= 14 or " " not in text:
            return text
        words = text.split()
        lines = []
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if len(candidate) <= 13:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return "\n".join(lines[:2])
    def node_font_size(label):
        base = as_float(mpl.rcParams.get("font.size", 8), 8)
        longest = max([len(part) for part in str(label).split("\n")] or [0])
        if longest > 13:
            return min(base, 6.8)
        if longest > 10:
            return min(base, 7.4)
        return min(base, 8.4)
    for index, node in enumerate(nodes):
        row_index = index // columns
        col_index = index % columns
        col = col_index if row_index % 2 == 0 else columns - 1 - col_index
        row = rows - 1 - row_index
        x = col + 0.12
        y = row + 0.25
        color = palette[index % len(palette)]
        rect = Rectangle((x, y), 0.76, 0.5, facecolor=color, edgecolor=mpl.rcParams.get("axes.edgecolor", "#222222"), linewidth=0.8, alpha=0.16, zorder=2)
        ax.add_patch(rect)
        label = wrap_node_label(node.get("label", ""))
        ax.text(x + 0.38, y + 0.25, label, ha="center", va="center", fontsize=node_font_size(label), color=mpl.rcParams.get("text.color", "#222222"), wrap=True, linespacing=0.95, zorder=3)
        positions[node.get("id") or str(index)] = (x + 0.38, y + 0.25)
    def edge_points(start, end):
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        if abs(dx) >= abs(dy):
            start_offset = (0.40 if dx > 0 else -0.40, 0)
            end_offset = (-0.40 if dx > 0 else 0.40, 0)
        else:
            start_offset = (0, 0.30 if dy > 0 else -0.30)
            end_offset = (0, -0.30 if dy > 0 else 0.30)
        return (sx + start_offset[0], sy + start_offset[1]), (ex + end_offset[0], ey + end_offset[1])
    for edge in edges:
        start = positions.get(str(edge.get("from")))
        end = positions.get(str(edge.get("to")))
        if start and end:
            start_edge, end_edge = edge_points(start, end)
            arrow = FancyArrowPatch(
                start_edge,
                end_edge,
                arrowstyle="-|>",
                mutation_scale=10,
                linewidth=0.7,
                color=mpl.rcParams.get("axes.edgecolor", "#222222"),
                alpha=0.72,
                connectionstyle="angle3,angleA=0,angleB=90",
                zorder=1,
            )
            ax.add_patch(arrow)
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

if template not in ("schematic-grid", "heatmap", "attention-map", "multi-panel"):
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
